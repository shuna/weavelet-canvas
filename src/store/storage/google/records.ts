import type { StorageValue } from 'zustand/middleware';
import type { PersistedStoreState } from '@store/persistence';
import type { BranchNode, ContentInterface } from '@type/chat';
import { addContent, type ContentStoreData } from '@utils/contentStore';
import DiffMatchPatch from 'diff-match-patch';
import { digest } from './crypto';

export type Snapshot = StorageValue<Partial<PersistedStoreState>>;
export type Records = Record<string, string>;
export type Change = { key: string; before: string | null; after: string | null };
const dmp = new DiffMatchPatch();
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Fail closed: the local resolver deliberately repairs damaged chains; sync must not publish that repair as an empty message.
function resolveStrict(store: ContentStoreData, hash: string, visited = new Set<string>()): ContentInterface[] {
  const entry = store[hash];
  if (!entry || visited.has(hash) || visited.size >= 100) throw new Error('Missing or cyclic message content; sync stopped.');
  if (!entry.delta) return entry.content;
  visited.add(hash);
  const base = resolveStrict(store, entry.delta.baseHash, visited);
  const [text, applied] = dmp.patch_apply(dmp.patch_fromText(entry.delta.patches), JSON.stringify(base));
  if (applied.some((ok: boolean) => !ok)) throw new Error('Invalid message delta; sync stopped.');
  return JSON.parse(text);
}

export async function toRecords(snapshot: Snapshot): Promise<Records> {
  // JSON also removes undefined fields, exactly as the existing persistence format does.
  const copy = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
  const state = copy.state;
  const records: Records = Object.create(null);
  const source = state.contentStore ?? {};
  const contentIds = new Map<string, string>();
  const content: Record<string, unknown> = Object.create(null);
  const assets: Record<string, string> = Object.create(null);
  const externalize = async (parts: ContentInterface[]) => {
    const encoded = JSON.parse(JSON.stringify(parts));
    for (const part of encoded) {
      if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
        const url = part.image_url.url;
        const id = await digest(url);
        assets[id] = url;
        part.image_url.url = { asset: id };
      }
    }
    return encoded;
  };
  const translate = async (node: BranchNode) => {
    const old = node.contentHash;
    if (!contentIds.has(old)) {
      const parts = await externalize(resolveStrict(source, old));
      const id = await digest(canonical(parts));
      content[id] = parts;
      contentIds.set(old, id);
    }
    node.contentHash = contentIds.get(old)!;
  };
  const chats: Record<string, unknown> = Object.create(null);
  const order: string[] = [];
  for (const chat of state.chats ?? []) {
    if (!chat.id || chats[chat.id]) throw new Error('Missing or duplicate chat ID; sync stopped.');
    order.push(chat.id);
    if (chat.branchTree) {
      for (const node of Object.values(chat.branchTree.nodes)) await translate(node);
      delete chat.messages;
    } else if (chat.messages) {
      for (const message of chat.messages) message.content = await externalize(message.content);
    }
    chats[chat.id] = chat;
  }
  for (const node of Object.values(state.branchClipboard?.nodes ?? {})) await translate(node);
  delete state.contentStore;
  delete state.chats;

  // Arrays remain atomic (activePath, order, legacy messages); object fields and nodes are independent records.
  const flatten = (value: any, path: string[]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key)) throw new Error('Unsafe sync record key.');
        flatten(child, [...path, key]);
      }
    } else records[JSON.stringify(path)] = canonical(value);
  };
  flatten({ version: copy.version ?? 0, state, chats, order }, []);
  for (const [id, parts] of Object.entries(content)) records[JSON.stringify(['content', id])] = canonical(parts);
  for (const [id, url] of Object.entries(assets)) records[JSON.stringify(['assets', id])] = JSON.stringify(url);
  return records;
}

export async function fromRecords(records: Records): Promise<Snapshot> {
  const root: any = Object.create(null);
  for (const [encoded, value] of Object.entries(records)) {
    const path: unknown = JSON.parse(encoded);
    if (!Array.isArray(path) || path.length < 1 || path.length > 100 ||
        path.some((p) => typeof p !== 'string' || forbidden.has(p))) throw new Error('Invalid sync record path.');
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
  if (!root.state || !root.chats || !Array.isArray(root.order) || !Number.isInteger(root.version)) {
    throw new Error('Incomplete sync snapshot.');
  }
  const restoreAssets = async (parts: any[]) => {
    if (!Array.isArray(parts)) throw new Error('Invalid message content.');
    const restored = structuredClone(parts);
    for (const part of restored) {
      if (part.type === 'image_url' && typeof part.image_url?.url === 'object') {
        const id = part.image_url.url?.asset;
        const url = root.assets?.[id];
        if (typeof url !== 'string' || await digest(url) !== id) throw new Error('Missing or damaged image.');
        part.image_url.url = url;
      }
    }
    return restored as ContentInterface[];
  };
  const store: ContentStoreData = {};
  const restore = async (node: BranchNode) => {
    const parts = root.content?.[node.contentHash];
    if (!parts || await digest(canonical(parts)) !== node.contentHash) throw new Error('Missing or damaged message content.');
    node.contentHash = addContent(store, await restoreAssets(parts));
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
      }
      if (tree.activePath.some((nodeId: string) => !tree.nodes[nodeId])) throw new Error('Invalid active branch path.');
    } else if (chat.messages) {
      for (const message of chat.messages) message.content = await restoreAssets(message.content);
    }
    chats.push(chat);
  }
  for (const node of Object.values(root.state.branchClipboard?.nodes ?? {}) as BranchNode[]) await restore(node);
  return { version: root.version, state: { ...root.state, chats, contentStore: store } };
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
      throw new Error('Concurrent edits conflict. Sync stopped; both copies are preserved.');
    }
    if (change.after === null) delete result[change.key];
    else result[change.key] = change.after;
  }
  return result;
}
