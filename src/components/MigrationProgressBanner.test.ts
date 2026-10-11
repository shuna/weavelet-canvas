import { beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const fixture = vi.hoisted(() => ({ state: {} as any }));
vi.mock('@store/store', () => ({ default: Object.assign((selector: any) => selector(fixture.state), { getState: () => fixture.state }) }));
vi.mock('@store/persistence', () => ({ clearNeedsDataMigration: vi.fn() }));
vi.mock('@store/recoveryExport', () => ({ buildRecoveryExportPayload: vi.fn(), getRecoveryExportFilename: vi.fn() }));
vi.mock('@store/storage/IndexedDbStorage', () => ({ loadLegacyRemoteSnapshots: vi.fn() }));
vi.mock('@store/storage/storageErrors', () => ({ notifyStorageError: vi.fn() }));
vi.mock('@utils/downloadFile', () => ({ default: vi.fn() }));
import MigrationProgressBanner from './MigrationProgressBanner';

beforeEach(() => { fixture.state = { migrationUiState: { visible: true, status: 'remote-migration-required', legacyRemoteSnapshots: [{ id: 'raw-id', version: 17 }] } }; });
it('shows the raw export and existing import path for pending old remote snapshots', () => {
  const html = renderToStaticMarkup(React.createElement(MigrationProgressBanner));
  expect(html).toContain('同期データ1を保存 (v17)');
  expect(html).toContain('設定のデータインポート');
  expect(html).toContain('取り込みと保存が成功するまで');
  expect(html).not.toContain('閉じる');
});
it('keeps the existing storage recovery action alongside the raw remote export', () => {
  fixture.state.migrationUiState.status = 'storage-recovery-required';
  const html = renderToStaticMarkup(React.createElement(MigrationProgressBanner));
  expect(html).toContain('復旧用データを保存');
  expect(html).toContain('同期データ1を保存 (v17)');
});
it('explains that future schemas require a compatible version rather than the current importer', () => {
  fixture.state.migrationUiState.legacyRemoteSnapshots[0].version = 19;
  const html = renderToStaticMarkup(React.createElement(MigrationProgressBanner));
  expect(html).toContain('この版では取り込めません');
  expect(html).not.toContain('設定のデータインポート');
});
