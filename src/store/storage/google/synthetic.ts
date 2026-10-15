import type { BranchNode, ChatInterface, ContentInterface } from '@type/chat';
import { addContent, addContentDelta, type ContentStoreData } from '@utils/contentStore';
import type { Snapshot } from './records';

// Aggregate counts only, from export-size-2026-05-20.json. No personal content.
export const SYNTHETIC_PROFILE = {
  treeChats: 73, treeNodes: 3724, legacyChats: 722, legacyNodes: 9383,
  maxTreeNodes: 558, maxDepth: 38, maxFanout: 65,
  targetJsonBytes: 60_150_763,
};

export interface SyntheticOptions {
  scale?: number;
  seed?: number;
  bodyBytes?: number;
  sharedRatio?: number;
  editRatio?: number;
  incompressible?: boolean;
  profile?: typeof SYNTHETIC_PROFILE;
}

/** Deterministic fictional data. Tune bodyBytes against serialized bytes; the
 * export's byte count includes a different mixture of shared/inline bodies.
 * scale repeats independent cohorts, preserving the per-chat structural limits.
 */
export function createSyntheticSnapshot(options: SyntheticOptions = {}): Snapshot {
  const { scale = 1, seed = 1, bodyBytes = 5200, sharedRatio = 0.5,
    editRatio = 0, incompressible = false, profile = SYNTHETIC_PROFILE } = options;
  for (const value of [scale, bodyBytes, profile.treeChats, profile.treeNodes,
    profile.legacyChats, profile.legacyNodes, profile.maxTreeNodes, profile.maxDepth, profile.maxFanout]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid synthetic size.');
  }
  if (scale < 1 || bodyBytes < 32 || !Number.isSafeInteger(seed) ||
    ![sharedRatio, editRatio].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
    sharedRatio + editRatio > 1 ||
    (profile.treeChats === 0 ? profile.treeNodes !== 0 :
      profile.treeNodes < profile.treeChats || profile.treeNodes > profile.treeChats * profile.maxTreeNodes) ||
    (profile.legacyChats === 0 && profile.legacyNodes !== 0) ||
    (profile.treeNodes > 0 && (profile.maxDepth < 1 || profile.maxFanout < 1 ||
      (profile.maxDepth === 1 && profile.maxTreeNodes > 1) ||
      (profile.maxFanout === 1 && profile.maxTreeNodes > profile.maxDepth)))) {
    throw new Error('Invalid synthetic profile.');
  }
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const store: ContentStoreData = {};
  const chats: ChatInterface[] = [];
  const bodies: { text: string; hash?: string }[] = [];
  let bodyOrdinal = 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const nextBody = () => {
    const choice = random();
    const base = bodies.length ? bodies[Math.floor(random() * bodies.length)] : undefined;
    if (base && choice < sharedRatio) return { text: base.text, baseHash: undefined };
    bodyOrdinal++;
    let text: string;
    const edited = base && choice < sharedRatio + editRatio;
    if (edited) {
      const at = Math.floor(random() * (bodyBytes - 16));
      const edit = `edit${bodyOrdinal.toString(36).padStart(12, '0')}`;
      text = base.text.slice(0, at) + edit + base.text.slice(at + edit.length);
    } else if (incompressible) {
      const chars = new Array<string>(bodyBytes);
      for (let i = 0; i < bodyBytes; i++) chars[i] = alphabet[Math.floor(random() * alphabet.length)];
      text = chars.join('');
    } else {
      const marker = `Synthetic body ${seed} ${bodyOrdinal}. `;
      text = (marker + 'Fictional sample text for synchronization testing. '.repeat(Math.ceil(bodyBytes / 49))).slice(0, bodyBytes);
    }
    const body = { text, baseHash: edited ? base.hash : undefined };
    bodies.push(body);
    return body;
  };
  const content = (text: string): ContentInterface[] => [{ type: 'text', text }];
  const makeChat = (id: string): ChatInterface => ({
    id, title: `Synthetic chat ${id}`, messages: [], titleSet: true, imageDetail: 'auto',
    config: { model: 'synthetic', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  });
  for (let batch = 0; batch < scale; batch++) {
    bodies.length = 0;
    let remaining = profile.treeNodes;
    for (let c = 0; c < profile.treeChats; c++) {
      const count = c === 0 ? Math.min(profile.maxTreeNodes, remaining - (profile.treeChats - 1)) :
        Math.ceil(remaining / (profile.treeChats - c));
      remaining -= count;
      const chat = makeChat(`synthetic-${batch}-tree-${c}`);
      const nodes: Record<string, BranchNode> = {};
      const depths: number[] = [], children: number[] = [], activePath: string[] = [];
      const chain = Math.min(profile.maxDepth, count);
      let availableParent = 0;
      for (let n = 0; n < count; n++) {
        let parent = -1;
        if (n > 0) {
          if (n < chain) parent = n - 1;
          else {
            while (availableParent < n && (depths[availableParent] >= profile.maxDepth ||
              children[availableParent] >= profile.maxFanout)) availableParent++;
            if (availableParent === n) throw new Error('Synthetic tree exceeds depth/fanout capacity.');
            parent = availableParent;
          }
          children[parent]++;
        }
        depths.push(parent < 0 ? 1 : depths[parent] + 1);
        children.push(0);
        const body = nextBody();
        const parts = content(body.text);
        const hash = body.baseHash ? addContentDelta(store, parts, body.baseHash) : addContent(store, parts);
        // Cache this generated body's local identity for later delta candidates.
        const latest = bodies[bodies.length - 1];
        if (latest?.text === body.text) latest.hash = hash;
        const id = `node-${n}`;
        nodes[id] = { id, parentId: parent < 0 ? null : `node-${parent}`,
          role: n % 2 ? 'assistant' : 'user', contentHash: hash, createdAt: 1_700_000_000_000 + n };
        if (n < chain) activePath.push(id);
      }
      chat.branchTree = { nodes, rootId: 'node-0', activePath };
      chats.push(chat);
    }
    for (let c = 0; c < profile.legacyChats; c++) {
      const chat = makeChat(`synthetic-${batch}-legacy-${c}`);
      const count = Math.floor(profile.legacyNodes / profile.legacyChats) + (c < profile.legacyNodes % profile.legacyChats ? 1 : 0);
      for (let n = 0; n < count; n++) chat.messages.push({ role: n % 2 ? 'assistant' : 'user', content: content(nextBody().text) });
      chats.push(chat);
    }
  }
  return { version: 18, state: { chats, contentStore: store } };
}
