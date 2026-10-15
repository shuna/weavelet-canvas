import { validateFolderHierarchy } from '@utils/folderHierarchy';
import { recordMetric } from './metrics';
import { isBrowserLocalRecord, withoutBrowserLocalSettings } from './settings';
import type { StorageValue } from 'zustand/middleware';
import type { PersistedStoreState } from '@store/persistence';
import type { BranchNode, ContentInterface } from '@type/chat';
import { addContent, retainContent, resolveContentStrict, type ContentStoreData } from '@utils/contentStore';
import { digest } from './crypto';
import { createContentProjector, cachedRecordDigest, cachedMetadataProjection, rememberProjectedDigest, type ProjectedMetadata } from './recordCache';

export class SyncConflictError extends Error {
  constructor(readonly keys: string[]) { super('Concurrent edits conflict. Both copies are preserved.'); }
}

export type Snapshot = StorageValue<Partial<PersistedStoreState>>;
export type Records = Record<string, string>;
export type Change = { key: string; before: string | null; after: string | null };
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

export function sameRecords(left: Records, right: Records): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && left[key] === right[key]);
}

export async function sameSnapshot([a, b]: [Snapshot, Snapshot]): Promise<boolean> {
  const leftProjection = await projectRecords(a), rightProjection = await projectRecords(b);
  if (leftProjection.rootHash !== rightProjection.rootHash) return false;
  // Keep exact comparison as the correctness fallback, including unknown future fields.
  const left = leftProjection.records, right = rightProjection.records;
  return sameRecords(left, right);
}

export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Fail closed: the local resolver deliberately repairs damaged chains; sync must not publish that repair as an empty message.
export interface RecordProjection {
  records: Records;
  nodeHashes: Record<string, Record<string, string>>;
  chatHashes: Records;
  rootHash: string;
}

export async function toRecords(snapshot: Snapshot): Promise<Records> {
  return (await projectRecords(snapshot)).records;
}

// The safe fallback disables caches without changing the projection or protocol.
// Value signatures, rather than object identity/dirty hints, validate every input.
export async function projectRecords(snapshot: Snapshot, { cache = true } = {}): Promise<RecordProjection> {
  const started = performance.now();
  // Copy only mutable metadata; never stringify and parse the entire body store.
  const { chats: sourceChats, contentStore: source = {}, ...shared } = withoutBrowserLocalSettings(snapshot.state);
  const state = JSON.parse(JSON.stringify(shared)) as Snapshot['state'];
  if (state.folders !== undefined && !validateFolderHierarchy(state.folders)) throw new Error('Invalid folder hierarchy; sync stopped.');
  const records: Records = Object.create(null);
  const contentIds = new Map<string, string>();
  const content: Records = Object.create(null);
  const contentBytes: Record<string, number> = Object.create(null);
  const assetBytes: Record<string, number> = Object.create(null);
  const assets: Record<string, string> = Object.create(null);
  const projector = createContentProjector(source, { cache });
  const nodeHashes: RecordProjection['nodeHashes'] = Object.create(null);
  const chatHashes: Records = Object.create(null);
  let bytes = 0;
  const flatten = (value: any, path: string[], target: Records = Object.create(null)): Records => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key)) throw new Error('Unsafe sync record key.');
        flatten(child, [...path, key], target);
      }
    } else target[JSON.stringify(path)] = canonical(value);
    return target;
  };
  const append = (fragment: ProjectedMetadata) => {
    for (const [key, value] of Object.entries(fragment.records)) {
      records[key] = value;
      if (cache) rememberProjectedDigest(value, fragment.hashes[key]);
    }
    bytes += Object.values(fragment.byteLengths).reduce((sum, size) => sum + size, 0);
  };
  const externalize = async (parts: ContentInterface[]) => {
    const encoded = parts;
    for (const part of encoded) {
      if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
        const url = part.image_url.url;
        const id = await cachedRecordDigest(url, { cache });
        assets[id] = url;
        assetBytes[id] = new TextEncoder().encode(JSON.stringify(url)).length;
        (part.image_url as any).url = { asset: id };
      }
    }
    return encoded;
  };
  const translate = async (node: BranchNode) => {
    const old = node.contentHash;
    if (!contentIds.has(old)) {
      const projected = await projector.project(old, async parts => {
        // Capture asset records with this projection so cache hits never omit dependencies.
        const found: Records = {};
        const encoded = JSON.parse(JSON.stringify(parts));
        for (const part of encoded) if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
          const url = part.image_url.url, id = await cachedRecordDigest(url, { cache });
          found[id] = url;
          part.image_url.url = { asset: id };
        }
        const value = canonical(encoded);
        const assetDigests: Records = Object.create(null);
        for (const [id, url] of Object.entries(found)) assetDigests[id] = await cachedRecordDigest(JSON.stringify(url), { cache });
        const assetByteLengths: Record<string, number> = Object.create(null);
        for (const [id, url] of Object.entries(found)) assetByteLengths[id] = new TextEncoder().encode(JSON.stringify(url)).length;
        return { id: await cachedRecordDigest(value, { cache }), value, assets: found, assetDigests,
          byteLength: new TextEncoder().encode(value).length, assetByteLengths };
      });
      content[projected.id] = projected.value;
      contentBytes[projected.id] = projected.byteLength ?? new TextEncoder().encode(projected.value).length;
      for (const [id, size] of Object.entries(projected.assetByteLengths ?? {})) assetBytes[id] = size;
      if (cache) {
        rememberProjectedDigest(projected.value, projected.id);
        for (const [id, hash] of Object.entries(projected.assetDigests ?? {})) rememberProjectedDigest(JSON.stringify(projected.assets[id]), hash);
      }
      for (const [id, url] of Object.entries(projected.assets)) assets[id] = url;
      contentIds.set(old, projected.id);
    }
    node.contentHash = contentIds.get(old)!;
  };
  const chatIds = new Set<string>();
  const order: string[] = [];
  for (const original of sourceChats ?? []) {
    // Clone nodes separately: unchanged nodes reuse their flattening and SHA result.
    const chat = JSON.parse(JSON.stringify(original.branchTree
      ? { ...original, messages: undefined, branchTree: { ...original.branchTree, nodes: {} } }
      : original)) as NonNullable<typeof sourceChats>[number];
    if (!chat.id || chatIds.has(chat.id)) throw new Error('Missing or duplicate chat ID; sync stopped.');
    if (forbidden.has(chat.id)) throw new Error('Unsafe sync record key.');
    chatIds.add(chat.id);
    order.push(chat.id);
    const hashes: Records = nodeHashes[chat.id] = Object.create(null);
    if (chat.branchTree) {
      for (const [id, originalNode] of Object.entries(original.branchTree!.nodes)) {
        if (forbidden.has(id)) throw new Error('Unsafe sync record key.');
        const node: BranchNode = JSON.parse(JSON.stringify(originalNode));
        const statsKey = `${chat.id}:::${node.id}`;
        const generationId = node.openRouterObservation?.generationId ?? snapshot.state.pendingVerifications?.[statsKey]?.generationId ?? snapshot.state.verifiedStats?.[statsKey]?.generationId;
        if (generationId) node.openRouterObservation = { ...node.openRouterObservation, generationId };
        await translate(node);
        const path = ['chats', chat.id, 'branchTree', 'nodes', id];
        const fragment = await cachedMetadataProjection('node', JSON.stringify(path), canonical(node), () => flatten(node, path), { cache });
        hashes[id] = fragment.hash;
        append(fragment);
      }
    } else if (chat.messages) {
      for (const message of chat.messages) message.content = await externalize(message.content);
    }
    const path = ['chats', chat.id];
    // The node roots include all normalized metadata and synchronized body IDs.
    const fragment = await cachedMetadataProjection('chat', JSON.stringify(path), canonical({ chat, nodes: hashes }), () => {
      const result = flatten(chat, path);
      if (Object.keys(hashes).length) delete result[JSON.stringify([...path, 'branchTree', 'nodes'])];
      return result;
    }, { cache });
    chatHashes[chat.id] = fragment.hash;
    append(fragment);
  }
  for (const node of Object.values(state.branchClipboard?.nodes ?? {})) await translate(node);
  delete state.contentStore;
  delete state.chats;

  const base = { version: snapshot.version ?? 0, state, ...(order.length ? {} : { chats: {} }), order };
  const root = await cachedMetadataProjection('root', '', canonical({ base, chats: chatHashes }), () => flatten(base, []), { cache });
  append(root);
  for (const [id, value] of Object.entries(content)) {
    records[JSON.stringify(['content', id])] = value;
    bytes += contentBytes[id];
  }
  for (const [id, url] of Object.entries(assets)) {
    const value = JSON.stringify(url);
    records[JSON.stringify(['assets', id])] = value;
    bytes += assetBytes[id] ?? new TextEncoder().encode(value).length;
  }
  recordMetric('records', started, bytes, bytes);
  return { records, nodeHashes, chatHashes, rootHash: root.hash };
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
  const restoredContent = new Map<string, string>();
  let previousDeltas: Map<string, string> | undefined;
  const reuseDelta = (parts: ContentInterface[]): string | undefined => {
    if (!previousDeltas) {
      previousDeltas = new Map();
      for (const [id, entry] of Object.entries(previous)) if (entry.delta) {
        try {
          const resolved: [string, string][] = [];
          let current = id;
          while (previous[current]) {
            resolved.push([canonical(resolveContentStrict(previous, current)), current]);
            if (!previous[current].delta) break;
            current = previous[current].delta!.baseHash;
          }
          for (const [value, hash] of resolved) previousDeltas.set(value, hash);
        }
        catch { /* Damaged old representations cannot replace verified remote content. */ }
      }
    }
    const hash = previousDeltas.get(canonical(parts));
    if (hash !== undefined) {
      try {
          const chain: string[] = [];
          let current = hash;
          while (previous[current]) {
            // A collision with content already restored uses the safe full-body fallback.
            if (store[current] && canonical(resolveContentStrict(store, current)) !==
                canonical(resolveContentStrict(previous, current))) return;
            chain.push(current);
            if (!previous[current].delta) break;
            current = previous[current].delta!.baseHash;
          }
          for (const id of chain.reverse()) store[id] ??= { ...structuredClone(previous[id]), refCount: 0 };
          retainContent(store, hash);
          return hash;
      } catch { return; } // Verified remote content remains authoritative if the old local delta is damaged.
    }
  };
  const restore = async (node: BranchNode) => {
    const cached = restoredContent.get(node.contentHash);
    if (cached !== undefined) {
      retainContent(store, cached);
      node.contentHash = cached;
      return;
    }
    const parts = root.content?.[node.contentHash];
    if (!parts || await digest(canonical(parts)) !== node.contentHash) throw new Error('Missing or damaged message content.');
    const restored = await restoreAssets(parts);
    const localHash = reuseDelta(restored) ?? addContent(store, restored);
    restoredContent.set(node.contentHash, localHash);
    node.contentHash = localHash;
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
      if (!tree.nodes || !Array.isArray(tree.activePath) || (tree.rootId && !tree.nodes[tree.rootId])) {
        throw new Error('Incomplete branch tree.');
      }
      for (const [nodeId, node] of Object.entries(tree.nodes) as [string, BranchNode][]) {
        if (node.id !== nodeId || (node.parentId && !tree.nodes[node.parentId])) throw new Error('Orphaned branch node.');
        const seen = new Set<string>();
        let cursor: BranchNode | undefined = node;
        while (cursor) {
          if (seen.has(cursor.id)) throw new Error('Cyclic branch tree.');
          seen.add(cursor.id);
          cursor = cursor.parentId ? tree.nodes[cursor.parentId] : undefined;
        }
        await restore(node);
        const generationId = node.openRouterObservation?.generationId ?? generationIds.get(`${id}:::${nodeId}`);
        if (generationId) node.openRouterObservation = { ...node.openRouterObservation, generationId };
      }
      if (tree.activePath.some((nodeId: string) => !tree.nodes[nodeId])) throw new Error('Invalid active branch path.');
    } else if (chat.messages) {
      for (const message of chat.messages) message.content = await restoreAssets(message.content);
    }
    chats.push(chat);
  }
  for (const node of Object.values(root.state.branchClipboard?.nodes ?? {}) as BranchNode[]) await restore(node);
  return { version: root.version, state: { ...withoutBrowserLocalSettings(root.state), chats, contentStore: store } };
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
