import { expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { File } from 'node:buffer';
import { readDriveImportSnapshot } from './driveImportService';
import { addContent } from '@utils/contentStore';
import { _defaultChatConfig, _defaultImageDetail } from '@constants/chat';

vi.mock('@store/store', () => ({
  default: { getState: () => { throw new Error('Drive-only import must not read local chats'); } },
  createPartializedState: vi.fn(),
}));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));

it('reads a V3 GZ export and preserves IDs, branches and content without touching local chats', async () => {
  const contentStore = {};
  const hash = addContent(contentStore, [{ type: 'text', text: 'Exported text' }]);
  const data = { version: 3, folders: {}, contentStore, chats: [{
    id: 'exported-chat', title: 'Export', titleSet: true, messages: [],
    config: _defaultChatConfig, imageDetail: _defaultImageDetail,
    branchTree: { rootId: 'node', activePath: ['node'], nodes: {
      node: { id: 'node', parentId: null, role: 'user', contentHash: hash, createdAt: 1 },
    } },
  }] };
  const file = new File([gzipSync(JSON.stringify(data))], 'export.json.gz');
  const result = await readDriveImportSnapshot(file as unknown as globalThis.File);
  expect(result.state.chats![0].id).toBe('exported-chat');
  const node = result.state.chats![0].branchTree!.nodes.node;
  expect(result.state.contentStore![node.contentHash].content).toEqual([{ type: 'text', text: 'Exported text' }]);
  data.chats[0].branchTree.nodes.node.contentHash = 'missing';
  const invalid = new File([gzipSync(JSON.stringify(data))], 'damaged.gz');
  await expect(readDriveImportSnapshot(invalid as unknown as globalThis.File)).rejects.toThrow('Missing');
});

it('rejects malformed or unsupported GZ exports before any remote upload', async () => {
  const file = new File([gzipSync(JSON.stringify({ version: 7, chats: [] }))], 'other.gz');
  await expect(readDriveImportSnapshot(file as unknown as globalThis.File)).rejects.toThrow('Weavelet');
  const damaged = new File(['bad gzip'], 'damaged.gz');
  await expect(readDriveImportSnapshot(damaged as unknown as globalThis.File)).rejects.toThrow();
});

it.each([1, 2])('converts a V%i GZ export with inline message content', async version => {
  const content = [{ type: 'text', text: 'Legacy text' }];
  const chat = {
    id: 'legacy-chat', title: 'Legacy', titleSet: true,
    config: _defaultChatConfig, imageDetail: _defaultImageDetail,
    messages: [{ role: 'user', content }],
    ...(version === 2 ? { branchTree: { rootId: 'node', activePath: ['node'], nodes: {
      node: { id: 'node', parentId: null, role: 'user', content, createdAt: 1 },
    } } } : {}),
  };
  const file = new File([gzipSync(JSON.stringify({ version, folders: {}, chats: [chat] }))], 'legacy.gz');
  const result = await readDriveImportSnapshot(file as unknown as globalThis.File);
  const tree = result.state.chats![0].branchTree!;
  const node = tree.nodes[tree.activePath[0]];
  expect(result.state.contentStore![node.contentHash].content).toEqual(content);
});
