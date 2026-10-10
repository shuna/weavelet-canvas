import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { savedFileSystemTarget } from './handleStore';

it('persists pending initialization and removes only the saved target on disconnect', async () => {
  globalThis.indexedDB = new IDBFactory();
  const target = { handle: { name: 'sync', kind: 'directory' } as FileSystemDirectoryHandle,
    dataset: 'dataset', initialized: false, downloadPending: true, headerId: 'header' };
  expect(await savedFileSystemTarget()).toBeUndefined();
  await savedFileSystemTarget(target);
  expect(await savedFileSystemTarget()).toEqual(target);
  await savedFileSystemTarget(null);
  expect(await savedFileSystemTarget()).toBeUndefined();
});
