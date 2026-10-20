import { validateFolderHierarchy } from '@utils/folderHierarchy';
import { recordMetric } from './metrics';
import { isBrowserLocalRecord, withoutBrowserLocalSettings } from './settings';
import type { StorageValue } from 'zustand/middleware';
import type { PersistedStoreState } from '@store/persistence';
import type { BranchNode, ContentInterface } from '@type/chat';
import { addContent, computeContentHash, retainContent, resolveContentStrict, type ContentStoreData } from '@utils/contentStore';
import { createContentProjector, cachedRecordDigest } from './recordCache';
import { digest } from './crypto';
import { captureProjectedMessageAttributes, readMessageAttributes } from '@utils/branchUtils';

export class SyncConflictError extends Error {
  constructor(readonly keys: string[]) { super('Concurrent edits conflict. Both copies are preserved.'); }
}

export type Snapshot = StorageValue<Partial<PersistedStoreState>>;
export type Records = Record<string, string>;
export type Change = { key: string; before: string | null; after: string | null };
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

const readNodeOrder = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string') || new Set(value).size !== value.length) {
    throw new Error('Invalid sync node order.');
  }
  return value;
};

export const isNodeOrderPath = (path: unknown): boolean => Array.isArray(path) && path[0] === 'nodeOrder' &&
  ((path.length === 3 && path[1] === 'chats' && typeof path[2] === 'string') || (path.length === 2 && path[1] === 'clipboard'));

export function isNodeOrderRecord(key: string): boolean {
  try { return isNodeOrderPath(JSON.parse(key)); } catch { return false; }
}

export function mergeNodeOrderValues(values: (string | null)[]): string | null {
  const orders = values.filter((value): value is string => value !== null).map(value => readNodeOrder(JSON.parse(value)));
  return orders.length ? JSON.stringify([...new Set(orders.flat())]) : null;
}

function orderNodes(nodes: Record<string, BranchNode>, value: unknown): Record<string, BranchNode> {
  if (value === undefined) return nodes;
  const ids = [...new Set([...readNodeOrder(value), ...Object.keys(nodes).sort()])];
  const ordered: Record<string, BranchNode> = Object.create(null);
  for (const id of ids) if (Object.hasOwn(nodes, id)) ordered[id] = nodes[id];
  return ordered;
}

export const contentEntryIdentity = (contentId: string, metadata: Record<string, unknown>) => digest(canonical({ contentId, metadata }));
export const contentEntryRefPath = (chatId: string, nodeId: string) => ['contentEntryRefs', 'chats', chatId, nodeId];
const checkSafeMetadata = (value: unknown): void => {
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error('Unsafe sync record key.');
    checkSafeMetadata(child);
  }
};

export async function sameSnapshot([a, b]: [Snapshot, Snapshot]): Promise<boolean> {
  const left = await toRecords(a), right = await toRecords(b);
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => left[key] === right[key]);
}

function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Fail closed: the local resolver deliberately repairs damaged chains; sync must not publish that repair as an empty message.
export const resolveStrict = resolveContentStrict;

export async function toRecords(snapshot: Snapshot): Promise<Records> {
  const started = performance.now();
  // Copy only mutable metadata; never stringify and parse the entire body store.
  const { chats: sourceChats, contentStore: source = {}, ...shared } = withoutBrowserLocalSettings(snapshot.state);
  const state = JSON.parse(JSON.stringify(shared)) as Snapshot['state'];
  if (state.folders !== undefined && !validateFolderHierarchy(state.folders)) throw new Error('Invalid folder hierarchy; sync stopped.');
  const records: Records = Object.create(null);
  const contentIds = new Map<string, string>();
  const content: Records = Object.create(null);
  const projector = createContentProjector(source);
  const assets: Record<string, string> = Object.create(null);
  const entryIds = new Map<string, string>();
  const entries: Record<string, { contentId: string; metadata: Record<string, unknown> }> = Object.create(null);
  const retained: Record<string, boolean> = Object.create(null);
  const entryRefs: { chats: Record<string, Record<string, string>>; clipboard?: Record<string, string> } = { chats: Object.create(null) };
  const externalize = async (parts: ContentInterface[]) => {
    const encoded = JSON.parse(JSON.stringify(parts));
    for (const part of encoded) {
      if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
        const url = part.image_url.url;
        const id = await cachedRecordDigest(url);
        assets[id] = url;
        part.image_url.url = { asset: id };
      }
    }
    return encoded;
  };
  // Entry identity includes unknown metadata; refCount and delta encoding are local optimizations.
  for (const [hash, entry] of Object.entries(source)) {
    const projected = await projector.project(hash, async parts => {
      // Keep dependencies with the projection so cache hits retain every asset.
      const found: Records = {};
      const encoded = JSON.parse(JSON.stringify(parts));
      for (const part of encoded) if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
        const url = part.image_url.url, id = await cachedRecordDigest(url);
        found[id] = url;
        part.image_url.url = { asset: id };
      }
      const value = canonical(encoded);
      return { id: await cachedRecordDigest(value), value, assets: found };
    });
    const contentId = projected.id;
    content[contentId] = projected.value;
    contentIds.set(hash, contentId);
    Object.assign(assets, projected.assets);
    const { content: _content, refCount: _refCount, delta: _delta, ...metadata } = entry;
    checkSafeMetadata(metadata);
    const record = { contentId, metadata: JSON.parse(JSON.stringify(metadata)) };
    const entryId = await cachedRecordDigest(canonical(record));
    entries[entryId] = record;
    entryIds.set(hash, entryId);
    retained[entryId] = true;
  }
  const translate = (node: BranchNode, refs: Record<string, string>) => {
    const old = node.contentHash;
    if (!contentIds.has(old)) throw new Error('Missing or cyclic message content; sync stopped.');
    node.contentHash = contentIds.get(old)!;
    refs[node.id] = entryIds.get(old)!;
  };
  const chats: Record<string, unknown> = Object.create(null);
  const order: string[] = [];
  const nodeOrder: { chats: Record<string, string[]>; clipboard?: string[] } = { chats: Object.create(null) };
  for (const original of sourceChats ?? []) {
    const projected = { ...original };
    captureProjectedMessageAttributes(projected, source);
    // Capture opaque projected attributes before omitting duplicated tree bodies.
    const chat = JSON.parse(JSON.stringify(projected.branchTree ? { ...projected, messages: undefined } : projected)) as NonNullable<typeof sourceChats>[number];
    if (!chat.id || chats[chat.id]) throw new Error('Missing or duplicate chat ID; sync stopped.');
    order.push(chat.id);
    if (chat.branchTree) {
      readMessageAttributes(chat.branchTree);
      nodeOrder.chats[chat.id] = Object.keys(chat.branchTree.nodes);
      entryRefs.chats[chat.id] = Object.create(null);
      for (const node of Object.values(chat.branchTree.nodes)) {
        const statsKey = `${chat.id}:::${node.id}`;
        const generationId = node.openRouterObservation?.generationId ?? snapshot.state.pendingVerifications?.[statsKey]?.generationId ?? snapshot.state.verifiedStats?.[statsKey]?.generationId;
        // Retain the lookup identity, not the device's verification queue/cache.
        if (generationId) node.openRouterObservation = { ...node.openRouterObservation, generationId };
        translate(node, entryRefs.chats[chat.id]);
      }
      delete chat.messages;
    } else if (chat.messages) {
      for (const message of chat.messages) message.content = await externalize(message.content);
    }
    chats[chat.id] = chat;
  }
  if (state.branchClipboard) {
    readMessageAttributes(state.branchClipboard);
    const refs: Record<string, string> = Object.create(null);
    entryRefs.clipboard = refs;
    for (const node of Object.values(state.branchClipboard.nodes)) translate(node, refs);
  }
  if (state.branchClipboard) nodeOrder.clipboard = Object.keys(state.branchClipboard.nodes);
  delete state.contentStore;
  delete state.chats;

  // Arrays remain atomic (activePath, order, legacy messages); object fields and nodes are independent records.
  const flatten = (value: any, path: string[]) => {
    const messageAttributes = (path[0] === 'chats' && path[2] === 'branchTree' && path[3] === 'messageAttributesV1' && path[4] === 'byNode' && path.length === 6) ||
      (path[0] === 'state' && path[1] === 'branchClipboard' && path[2] === 'messageAttributesV1' && path[3] === 'byNode' && path.length === 5);
    if (messageAttributes) { checkSafeMetadata(value); records[JSON.stringify(path)] = canonical(value); }
    else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key)) throw new Error('Unsafe sync record key.');
        flatten(child, [...path, key]);
      }
    } else records[JSON.stringify(path)] = canonical(value);
  };
  flatten({ version: snapshot.version ?? 0, state, chats, order, nodeOrder, contentEntryFormat: 1, contentEntryRefs: entryRefs, retainedContentEntries: retained }, []);
  for (const [id, entry] of Object.entries(entries)) records[JSON.stringify(['contentEntries', id])] = canonical(entry);
  for (const [id, value] of Object.entries(content)) records[JSON.stringify(['content', id])] = value;
  for (const [id, url] of Object.entries(assets)) records[JSON.stringify(['assets', id])] = JSON.stringify(url);
  const bytes = Object.values(records).reduce((n, value) => n + new TextEncoder().encode(value).length, 0);
  recordMetric('records', started, bytes, bytes);
  return records;
}

export async function fromRecords(records: Records, previous: ContentStoreData = {}): Promise<Snapshot> {
  const root: any = Object.create(null);
  let skippedLocalState = false;
  const generationIds = new Map<string, string>();
  for (const [encoded, value] of Object.entries(records)) {
    const path: unknown = JSON.parse(encoded);
    if (!Array.isArray(path) || path.length < 1 || path.length > 100 ||
        path.some((p) => typeof p !== 'string' || forbidden.has(p))) throw new Error('Invalid sync record path.');
    if (isBrowserLocalRecord(encoded)) {
      skippedLocalState = true;
      if (path.length === 4 && ['pendingVerifications', 'verifiedStats'].includes(path[1]) && path[3] === 'generationId') {
        const id = JSON.parse(value);
        if (typeof id === 'string' && !generationIds.has(path[2])) generationIds.set(path[2], id);
      }
      continue;
    }
    if (path[0] === 'chats' && path[2] === 'collapsedNodes' && path.length === 3 && value === '{}') continue;
    let current = root;
    for (const part of path.slice(0, -1)) {
      if (Object.hasOwn(current, part) && (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part]))) {
        throw new Error('Conflicting sync record paths.');
      }
      current = current[part] ??= Object.create(null);
    }
    const last = path[path.length - 1];
    if (Object.hasOwn(current, last)) throw new Error('Conflicting sync record paths.');
    current[last] = JSON.parse(value);
  }
  if (skippedLocalState && !root.state) root.state = Object.create(null);
  if (!root.state || !root.chats || !Array.isArray(root.order) || !Number.isInteger(root.version)) {
    throw new Error('Incomplete sync snapshot.');
  }
  if (root.nodeOrder !== undefined) {
    const orders = root.nodeOrder;
    if (!orders || typeof orders !== 'object' || Array.isArray(orders) ||
        (orders.chats !== undefined && (!orders.chats || typeof orders.chats !== 'object' || Array.isArray(orders.chats)))) {
      throw new Error('Invalid sync node order.');
    }
    for (const value of Object.values(orders.chats ?? {})) readNodeOrder(value);
    if (orders.clipboard !== undefined) readNodeOrder(orders.clipboard);
  }
  if (root.state.folders !== undefined && !validateFolderHierarchy(root.state.folders)) throw new Error('Invalid folder hierarchy; sync stopped.');
  const restoredImages = new Map<string, string>();
  const restoreAssets = async (parts: any[]) => {
    if (!Array.isArray(parts)) throw new Error('Invalid message content.');
    const restored = structuredClone(parts);
    for (const part of restored) {
      if (part.type === 'image_url' && typeof part.image_url?.url === 'object') {
        const id = part.image_url.url?.asset;
        let url = restoredImages.get(id);
        if (url === undefined) {
          url = root.assets?.[id];
          if (typeof url !== 'string' || await digest(url) !== id) throw new Error('Missing or damaged image.');
          restoredImages.set(id, url);
        }
        part.image_url.url = url;
      }
    }
    return restored as ContentInterface[];
  };
  const store: ContentStoreData = {};
  const restoredEntries = new Map<string, string>();
  const extended = root.contentEntryFormat !== undefined;
  if (!extended && ['contentEntries', 'contentEntryRefs', 'retainedContentEntries'].some(key => root[key] !== undefined)) throw new Error('Incomplete content entry extension.');
  if (extended && root.contentEntryFormat !== 1) throw new Error('Unsupported content entry format.');
  if (extended) {
    const refs = root.contentEntryRefs;
    if (!refs || typeof refs !== 'object' || Array.isArray(refs) || !refs.chats || typeof refs.chats !== 'object' || Array.isArray(refs.chats)) throw new Error('Invalid content entry references.');
    const checkRefs = (values: unknown, nodes: Record<string, BranchNode> | undefined) => {
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid content entry references.');
      for (const [id, entryId] of Object.entries(values)) if (typeof entryId !== 'string' || !nodes?.[id]) throw new Error('Inconsistent content entry reference.');
    };
    for (const [chatId, values] of Object.entries(refs.chats)) checkRefs(values, root.chats[chatId]?.branchTree?.nodes);
    if (refs.clipboard !== undefined) checkRefs(refs.clipboard, root.state.branchClipboard?.nodes);
  }
  const restoredBodies = new Map<string, ContentInterface[]>();
  const restoreBody = async (contentId: string): Promise<ContentInterface[]> => {
    const cached = restoredBodies.get(contentId);
    if (cached) return cached;
    const parts = root.content?.[contentId];
    if (!parts || await digest(canonical(parts)) !== contentId) throw new Error('Missing or damaged message content.');
    const body = await restoreAssets(parts);
    restoredBodies.set(contentId, body);
    return body;
  };
  const verifiedEntries = new Set<string>();
  const readEntry = async (entryId: string) => {
    const entry = root.contentEntries?.[entryId];
    if (!verifiedEntries.has(entryId)) {
      if (!entry || typeof entry.contentId !== 'string' || !entry.metadata || typeof entry.metadata !== 'object' || Array.isArray(entry.metadata) ||
          ['content', 'refCount', 'delta'].some(key => Object.hasOwn(entry.metadata, key)) || await digest(canonical(entry)) !== entryId) {
        throw new Error('Missing or damaged content entry.');
      }
      checkSafeMetadata(entry.metadata);
      await restoreBody(entry.contentId);
      verifiedEntries.add(entryId);
    }
    return entry;
  };
  const metadataOf = (entry: ContentStoreData[string]) => {
    const { content: _content, refCount: _refCount, delta: _delta, ...metadata } = entry;
    return JSON.parse(JSON.stringify(metadata));
  };
  const reuseKey = (parts: ContentInterface[], metadata?: Record<string, unknown>) =>
    canonical(extended ? { content: parts, metadata } : parts);
  let previousDeltas: Map<string, string> | undefined;
  let remoteContentIds: Map<string, string> | undefined;
  let remoteEntryIds: Map<string, string> | undefined;
  let remoteAssetIds: Map<string, string> | undefined;
  const reuseDelta = async (parts: ContentInterface[], metadata?: Record<string, unknown>): Promise<string | undefined> => {
    if (!previousDeltas) {
      previousDeltas = new Map();
      for (const [id, entry] of Object.entries(previous)) if (entry.delta) {
        try {
          const resolved: [string, string][] = [];
          let current = id;
          while (previous[current]) {
            resolved.push([reuseKey(resolveContentStrict(previous, current), metadataOf(previous[current])), current]);
            if (!previous[current].delta) break;
            current = previous[current].delta!.baseHash;
          }
          for (const [value, hash] of resolved) previousDeltas.set(value, hash);
        } catch { /* Damaged old representations cannot replace verified remote content. */ }
      }
    }
    const hash = previousDeltas.get(reuseKey(parts, metadata));
    if (hash === undefined) return;
    const chain: { hash: string; entryId?: string }[] = [];
    try {
      let current = hash;
      while (previous[current]) {
        const body = resolveContentStrict(previous, current);
        let entryId: string | undefined;
        if (extended) {
          // Reuse only entries retained by the remote snapshot, including every delta base.
          remoteContentIds ??= new Map(Object.entries(root.content ?? {}).map(([id, value]) => [canonical(value), id]));
          remoteEntryIds ??= new Map(Object.entries(root.contentEntries ?? {}).map(([id, value]) => [canonical(value), id]));
          remoteAssetIds ??= new Map(Object.entries(root.assets ?? {}).map(([id, value]) => [value as string, id]));
          const encoded = structuredClone(body) as any[];
          for (const part of encoded) if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
            const asset = remoteAssetIds.get(part.image_url.url);
            if (asset === undefined) return;
            part.image_url.url = { asset };
          }
          const contentId = remoteContentIds.get(canonical(encoded));
          entryId = remoteEntryIds.get(canonical({ contentId, metadata: metadataOf(previous[current]) }));
          if (!entryId || root.retainedContentEntries?.[entryId] !== true ||
              (restoredEntries.has(entryId) && restoredEntries.get(entryId) !== current)) return;
          chain.push({ hash: current, entryId });
        } else chain.push({ hash: current });
        if (store[current] && (canonical(resolveContentStrict(store, current)) !== canonical(body) ||
            (extended && canonical(metadataOf(store[current])) !== canonical(metadataOf(previous[current]))))) return;
        if (!previous[current].delta) break;
        current = previous[current].delta!.baseHash;
      }
    } catch { return; } // A damaged old delta uses the verified full-body fallback.
    // Remote validation errors must propagate, rather than be swallowed as local cache damage.
    for (const item of chain) if (item.entryId) await readEntry(item.entryId);
    for (const item of chain.reverse()) {
      store[item.hash] ??= { ...structuredClone(previous[item.hash]), refCount: 0 };
      if (item.entryId) restoredEntries.set(item.entryId, item.hash);
    }
    return hash;
  };
  const restoreEntry = async (entryId: string): Promise<string> => {
    if (typeof entryId !== 'string') throw new Error('Invalid content entry reference.');
    if (restoredEntries.has(entryId)) return restoredEntries.get(entryId)!;
    const entry = await readEntry(entryId);
    const body = await restoreBody(entry.contentId);
    const reused = await reuseDelta(body, entry.metadata);
    if (reused !== undefined) return reused;
    let hash = computeContentHash(body);
    while (Object.hasOwn(store, hash)) hash += '_';
    store[hash] = { ...entry.metadata, content: body, refCount: 0 };
    restoredEntries.set(entryId, hash);
    return hash;
  };
  const restoredContent = new Map<string, string>();
  const restore = async (node: BranchNode, refs?: Record<string, string>) => {
    if (extended) {
      const entryId = refs?.[node.id];
      if (!entryId || root.contentEntries?.[entryId]?.contentId !== node.contentHash) throw new Error('Inconsistent content entry reference.');
      const hash = await restoreEntry(entryId);
      retainContent(store, hash);
      node.contentHash = hash;
    } else {
      const cached = restoredContent.get(node.contentHash);
      if (cached !== undefined) {
        retainContent(store, cached);
        node.contentHash = cached;
        return;
      }
      const body = await restoreBody(node.contentHash);
      const reused = await reuseDelta(body);
      const localHash = reused ?? addContent(store, body);
      if (reused !== undefined) retainContent(store, reused);
      restoredContent.set(node.contentHash, localHash);
      node.contentHash = localHash;
    }
  };
  // New chats created concurrently may not appear in another writer's order array.
  const ids = [...new Set([...root.order, ...Object.keys(root.chats).sort()])];
  const chats = [];
  for (const id of ids) {
    const chat = root.chats[id];
    if (!chat) continue;
    if (chat.id !== id) throw new Error('Invalid chat identity.');
    if (chat.branchTree) {
      const tree = chat.branchTree;
      readMessageAttributes(tree);
      if (!tree.nodes || !Array.isArray(tree.activePath) || typeof tree.rootId !== 'string' || (tree.rootId && !tree.nodes[tree.rootId])) {
        throw new Error('Incomplete branch tree.');
      }
      tree.nodes = orderNodes(tree.nodes, root.nodeOrder?.chats?.[id]);
      for (const [nodeId, node] of Object.entries(tree.nodes) as [string, BranchNode][]) {
        // Pinned orphan branches are valid Web data; preserve their original parent ID.
        if (node.id !== nodeId || (node.parentId && !tree.nodes[node.parentId] && node.pinned !== true)) throw new Error('Orphaned branch node.');
        const seen = new Set<string>();
        let cursor: BranchNode | undefined = node;
        while (cursor) {
          if (seen.has(cursor.id)) throw new Error('Cyclic branch tree.');
          seen.add(cursor.id);
          cursor = cursor.parentId ? tree.nodes[cursor.parentId] : undefined;
        }
        await restore(node, root.contentEntryRefs?.chats?.[id]);
        const generationId = node.openRouterObservation?.generationId ?? generationIds.get(`${id}:::${nodeId}`);
        if (generationId) node.openRouterObservation = { ...node.openRouterObservation, generationId };
      }
      if (tree.activePath.some((nodeId: string) => !tree.nodes[nodeId])) throw new Error('Invalid active branch path.');
    } else if (chat.messages) {
      for (const message of chat.messages) message.content = await restoreAssets(message.content);
    }
    chats.push(chat);
  }
  if (root.state.branchClipboard) {
    readMessageAttributes(root.state.branchClipboard);
    root.state.branchClipboard.nodes = orderNodes(root.state.branchClipboard.nodes, root.nodeOrder?.clipboard);
  }
  for (const node of Object.values(root.state.branchClipboard?.nodes ?? {}) as BranchNode[]) await restore(node, root.contentEntryRefs?.clipboard);
  if (extended) {
    if (!root.retainedContentEntries || typeof root.retainedContentEntries !== 'object' || Array.isArray(root.retainedContentEntries)) throw new Error('Invalid retained content entries.');
    for (const [entryId, retained] of Object.entries(root.retainedContentEntries)) {
      if (retained !== true) throw new Error('Invalid retained content entry.');
      await restoreEntry(entryId);
    }
  }
  return { version: root.version, state: { ...withoutBrowserLocalSettings(root.state), chats, contentStore: store } };
}

// A pinned orphan that already existed is valid. Concurrently deleting its
// previous parent must not discard the other writer's new/edited subtree.
export async function assertNoConcurrentOrphans(base: Records, local: Records, cloud: Records, merged: Records): Promise<void> {
  const orphans = Object.entries(merged).filter(([key, value]) => {
    const path: string[] = JSON.parse(key);
    if (path.length !== 6 || path[0] !== 'chats' || path[2] !== 'branchTree' || path[3] !== 'nodes' || path[5] !== 'parentId') return false;
    const parent: string | null = JSON.parse(value);
    const parentKey = JSON.stringify([...path.slice(0, 4), parent, 'id']);
    return parent && base[parentKey] && !merged[parentKey];
  });
  if (!orphans.length) return;
  const affected = new Set(orphans.map(([key]) => JSON.parse(key)[1]));
  for (const source of [local, cloud]) {
    const changed = new Map<string, Set<string>>();
    for (const [key, value] of Object.entries(source)) {
      const path: string[] = JSON.parse(key);
      const node = path.length === 6 && path[0] === 'chats' && path[2] === 'branchTree' &&
        ((path[3] === 'nodes' && path[5] !== 'updatedAt') || (path[3] === 'messageAttributesV1' && path[4] === 'byNode')) ? [path[1], path[path[3] === 'nodes' ? 4 : 5]]
        : path.length === 4 && path[0] === 'contentEntryRefs' && path[1] === 'chats' ? [path[2], path[3]] : undefined;
      if (!node || !affected.has(node[0]) || await digest(value) === base[key]) continue;
      const [chat, id] = node;
      const ids = changed.get(chat) ?? new Set<string>(); changed.set(chat, ids);
      let cursor: string | null = id;
      while (cursor && !ids.has(cursor)) {
        ids.add(cursor);
        const parent: string | undefined = source[JSON.stringify(['chats', chat, 'branchTree', 'nodes', cursor, 'parentId'])];
        cursor = parent === undefined ? null : JSON.parse(parent);
      }
    }
    for (const [key, value] of orphans) {
      const path: string[] = JSON.parse(key);
      const parent: string | null = JSON.parse(value);
      const parentKey = JSON.stringify([...path.slice(0, 4), parent, 'id']);
      if (source[parentKey] && source[key] === value && changed.get(path[1])?.has(path[4])) throw new SyncConflictError([key]);
    }
  }
}

export async function diffRecords(before: Records, after: Records): Promise<Change[]> {
  const changes: Change[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === after[key]) continue;
    changes.push({ key, before: before[key] === undefined ? null : await digest(before[key]), after: after[key] ?? null });
  }
  return changes;
}

export async function applyChanges(records: Records, changes: Change[]): Promise<Records> {
  const result = { ...records };
  const keys = new Set<string>();
  for (const change of changes) {
    if (!change || typeof change.key !== 'string' || keys.has(change.key) ||
        !(change.before === null || typeof change.before === 'string') ||
        !(change.after === null || typeof change.after === 'string')) throw new Error('Invalid sync change.');
    keys.add(change.key);
    const current = result[change.key];
    if ((current ?? null) !== change.after &&
        (current === undefined ? null : await digest(current)) !== change.before) {
      if (isNodeOrderRecord(change.key)) {
        const value = mergeNodeOrderValues([current ?? null, change.after]);
        if (value === null) delete result[change.key]; else result[change.key] = value;
        continue;
      }
      throw new SyncConflictError([change.key]);
    }
    if (change.after === null) delete result[change.key];
    else result[change.key] = change.after;
  }
  return result;
}

// The baseline only needs equality/precondition hashes, not a second copy of every image/body.
export async function hashRecords(records: Records): Promise<Records> {
  const hashes: Records = {};
  for (const [key, value] of Object.entries(records)) hashes[key] = await cachedRecordDigest(value);
  return hashes;
}
export function diffHashedRecords(before: Records, after: Records, hashes: Records): Change[] {
  const changes: Change[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === hashes[key]) continue;
    changes.push({ key, before: before[key] ?? null, after: after[key] ?? null });
  }
  return changes;
}

export { canonical };
