import { describe, expect, it } from 'vitest';
import { proxyRecoveryTarget } from '../../shared/google-sync/proxy';
import { resolveRecoveryTarget } from './streamRecovery';
import { _defaultChatConfig } from '../constants/chatDefaults';
import type { ChatInterface } from '../types/chat';
import type { StreamRecord } from './streamDb';
import type { ContentStoreData } from './contentStore';

const chat: ChatInterface = {
  id: 'chat', title: 'Recovery', titleSet: true, imageDetail: 'auto', config: _defaultChatConfig, messages: [{ role: 'user', content: [{ type: 'text', text: 'parent' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'active' }] }],
  branchTree: { rootId: 'root', activePath: ['root', 'active'], nodes: {
    root: { id: 'root', parentId: null, role: 'user', contentHash: 'root', createdAt: 0 },
    active: { id: 'active', parentId: 'root', role: 'assistant', contentHash: 'active', createdAt: 0 },
    hidden: { id: 'hidden', parentId: 'root', role: 'assistant', contentHash: 'hidden', createdAt: 0 },
  } },
};
const contentStore: ContentStoreData = Object.fromEntries(['root', 'active', 'hidden'].map(id =>
  [id, { content: [{ type: 'text' as const, text: id }], refCount: 1 }]));
const record = { requestId: 'request', chatId: 'chat', nodeId: 'active', checkpointRole: 'assistant', checkpointHash: 'active',
  chatIndex: 99, messageIndex: 99, bufferedText: '', status: 'interrupted', createdAt: 0, updatedAt: 0, acknowledged: false } as StreamRecord;
const bridge = (chatValue: ChatInterface, recordValue: StreamRecord, expectedHash?: string) =>
  JSON.parse(proxyRecoveryTarget(JSON.stringify({ chat: chatValue, contentStore, record: recordValue, expectedHash })));

describe('shared recovery target', () => {
  it('uses IDs and hashes instead of stale indexes and permits inactive nodes', () => {
    expect(bridge(chat, record)).toEqual({ status: 'ready', messageIndex: 1, nodeID: 'active' });
    expect(bridge(chat, { ...record, nodeId: 'hidden', checkpointHash: 'hidden' }))
      .toEqual({ status: 'ready', messageIndex: -1, nodeID: 'hidden' });
    expect(resolveRecoveryTarget([chat], contentStore, record)?.messageIndex).toBe(1);
  });

  it('rejects deleted or edited targets, role changes, and missing identity; accepts the current expected hash', () => {
    expect(bridge(chat, { ...record, chatId: 'other' })).toEqual({ status: 'stale' });
    expect(bridge(chat, { ...record, nodeId: 'deleted' })).toEqual({ status: 'stale' });
    expect(bridge(chat, { ...record, checkpointRole: 'user' })).toEqual({ status: 'stale' });
    expect(bridge(chat, { ...record, checkpointHash: 'old' })).toEqual({ status: 'stale' });
    expect(bridge(chat, { ...record, checkpointHash: 'old', appliedHash: 'active' })).toEqual({ status: 'ready', messageIndex: 1, nodeID: 'active' });
    expect(bridge(chat, { ...record, checkpointHash: 'old' }, 'active')).toEqual({ status: 'ready', messageIndex: 1, nodeID: 'active' });
    expect(bridge(chat, { ...record, nodeId: undefined })).toEqual({ status: 'stale' });
  });
});
