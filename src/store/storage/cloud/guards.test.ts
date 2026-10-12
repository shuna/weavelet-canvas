import { describe, expect, it } from 'vitest';
import {
  computeCloudSyncMetrics,
  getCloudSyncGuardMessage,
} from './guards';

describe('cloud guards', () => {
  it('blocks invalid folder graphs while permitting preserved parent metadata', () => {
    const value = { state: { chats: [{ id: 'chat' }], folders: {
      root: { id: 'root', name: 'Root', expanded: false, order: 0 },
      child: { id: 'child', name: 'Child', expanded: false, order: 1, parentId: 'root' },
    } } };
    const metrics = computeCloudSyncMetrics(value);
    expect(getCloudSyncGuardMessage(value, metrics, null)).toBeNull();
    value.state.folders.child.parentId = 'child';
    expect(getCloudSyncGuardMessage(value, metrics, null)).toContain('folder hierarchy is invalid');
  });
  it('detects oversized snapshots and preserves guard messages', () => {
    const metrics = computeCloudSyncMetrics({
      chats: [{ id: 'chat-1', messages: [{ role: 'user', content: 'x'.repeat(10) }] }],
      contentStore: {},
    });

    expect(
      getCloudSyncGuardMessage(
        { chats: [], contentStore: {} },
        { ...metrics, jsonBytes: 2_000_001 },
        null
      )
    ).toBe('Cloud sync skipped because the snapshot is too large to upload safely.');
  });

  it('flags missing branch data when contentStore is empty', () => {
    const metrics = computeCloudSyncMetrics({
      chats: [{ id: 'chat-1', branchTree: { nodes: {} } }],
      contentStore: {},
    });

    expect(
      getCloudSyncGuardMessage(
        {
          chats: [{ id: 'chat-1', branchTree: { nodes: {} } }],
          contentStore: {},
        },
        metrics,
        null
      )
    ).toBe('Cloud sync skipped because branch data is missing from the snapshot.');
  });
});
