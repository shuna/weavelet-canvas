import { expect, it } from 'vitest';
import { addContent } from '@utils/contentStore';
import { fromRecords, toRecords, type Snapshot } from './records';
import { summarizeSyncSnapshot } from './overview';

it('counts every branch once and measures the same normalized data on both sides', async () => {
  const contentStore = {};
  const hash = addContent(contentStore, [{ type: 'text', text: '日本語の本文' }]);
  const snapshot: Snapshot = { version: 18, state: { contentStore, chats: [{
    id: 'tree', title: 'branched', titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    branchTree: { rootId: 'root', activePath: ['root', 'left'], nodes: {
      root: { id: 'root', parentId: null, role: 'user', contentHash: hash, createdAt: 1 },
      left: { id: 'left', parentId: 'root', role: 'assistant', contentHash: hash, createdAt: 2 },
      right: { id: 'right', parentId: 'root', role: 'assistant', contentHash: hash, createdAt: 3 },
    } },
  }, {
    id: 'legacy', title: 'legacy', titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  }] } };
  const records = await toRecords(snapshot);
  const summary = await summarizeSyncSnapshot(snapshot);
  expect(summary).toEqual({ chats: 2, messages: 4, bytes: new TextEncoder().encode(JSON.stringify(records)).length });
  expect(await summarizeSyncSnapshot(await fromRecords(records))).toEqual(summary);
  const empty = await summarizeSyncSnapshot({ version: 18, state: { chats: [] } });
  expect(empty.chats).toBe(0);
  expect(empty.messages).toBe(0);
});
