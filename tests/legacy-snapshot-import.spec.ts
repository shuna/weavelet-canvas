import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ headless: true });
test('actual old Swift compressed snapshot enters the Web import preview without data loss', async ({ page }) => {
  const bytes = Array.from(readFileSync(new URL('./fixtures/web-native/legacy-ios-sync-snapshot.wvlt', import.meta.url)));
  const expected = JSON.parse(readFileSync(new URL('./fixtures/web-native/legacy-ios-sync-snapshot.json', import.meta.url), 'utf8'));
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const path = '/src/components/ImportExportChat/importService.ts';
    const { readImportFile, prepareImportPreview } = await import(path);
    const file = new File([new Uint8Array(bytes)], 'weavelet-canvas-sync.wvlt');
    const decoded = JSON.parse(await readImportFile(file));
    const source = await prepareImportPreview(file, (key: string) => key);
    const bad = new Uint8Array(bytes); bad[20] = 0;
    let rejected = false;
    try { await prepareImportPreview(new File([bad], 'damaged.wvlt'), (key: string) => key); } catch { rejected = true; }
    return { decoded, source, rejected, preserved: Array.from(new Uint8Array(await file.arrayBuffer())) };
  }, bytes);
  expect(result.decoded).toEqual(expected);
  expect(result.source.chats).toHaveLength(2);
  expect(result.source.contentStore).toMatchObject(expected.contentStore);
  expect(result.source.folders).toEqual(expected.folders);
  expect(result.source.extensions).toMatchObject({ snapshotVersion: 1, deviceId: expected.deviceId, currentChatID: expected.currentChatID });
  expect(result.rejected).toBe(true);
  expect(result.preserved).toEqual(bytes);
});
