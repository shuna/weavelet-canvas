import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatInterface, ContentInterface, Role } from '@type/chat';
import type { ContentStoreData } from './contentStore';
import { resolveContent } from './contentStore';
import { appendNodeToActivePathState, createBranchState, ensureBranchTreeState, updateNodeRoleState, upsertWithAutoBranchState } from '@store/branch-domain';

const uuid = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('uuid', () => ({ v4: () => { const id = uuid.ids.shift(); if (!id) throw new Error('Fixture ID exhausted'); return id; } }));
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/message-editing.json', import.meta.url), 'utf8'));
type Source = { chats: ChatInterface[]; contentStore: ContentStoreData; [key: string]: unknown };
function snapshot(source: Source) {
  const result = structuredClone(source) as any;
  delete result.contentStore;
  for (const chat of result.chats) if (chat.branchTree) {
    for (const node of Object.values(chat.branchTree.nodes) as any[]) {
      node.content = resolveContent(source.contentStore, node.contentHash);
      delete node.contentHash;
    }
  }
  return JSON.parse(JSON.stringify(result));
}
afterEach(() => vi.restoreAllMocks());
describe('shared expanded message editing contract', () => {
  it('uses manually frozen semantic expectations', () => {
    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.cases).toHaveLength(15);
  });
  for (const test of fixture.cases) it(test.name, () => {
    const input: Source = structuredClone(test.input);
    uuid.ids = [...test.newIDs];
    vi.spyOn(Date, 'now').mockReturnValue(test.now);
    const chatIndex = input.chats.findIndex(chat => chat.id === 'target');
    const ready = ensureBranchTreeState(input.chats, chatIndex, input.contentStore);
    const tree = ready.chats[chatIndex].branchTree!;
    const index = test.nodeID?.startsWith('message-') ? Number(test.nodeID.slice(8)) : tree.activePath.indexOf(test.nodeID);
    let changed: { chats: ChatInterface[]; contentStore: ContentStoreData };
    if (test.mode === 'append') {
      changed = appendNodeToActivePathState(ready.chats, chatIndex, test.role as Role, test.parts as ContentInterface[], ready.contentStore);
    } else if (test.mode === 'branch') {
      const branch = createBranchState(ready.chats, chatIndex, tree.activePath[index], test.parts, ready.contentStore);
      // Native stages the draft role. This explicit domain sequence leaves the old node unchanged;
      // it is not the Web UI's immediate original-node RoleSelector operation sequence.
      changed = { ...branch, chats: updateNodeRoleState(branch.chats, chatIndex, branch.newId, test.role, branch.contentStore) };
    } else {
      changed = upsertWithAutoBranchState(ready.chats, chatIndex, index, { role: test.role, content: test.parts }, ready.contentStore);
    }
    const output = { ...input, chats: changed.chats, contentStore: changed.contentStore };
    expect(snapshot(output)).toEqual(test.expected);
    expect(Object.keys(changed.chats[chatIndex].branchTree!.nodes)).toEqual(Object.keys(test.expected.chats[chatIndex].branchTree.nodes));
  });
});
