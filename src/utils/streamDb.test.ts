import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

// Polyfill IndexedDB for test environment
(globalThis as any).indexedDB = new IDBFactory();
(globalThis as any).IDBKeyRange = IDBKeyRange;

import {
  saveRequest,
  getRequest,
  appendText,
  setGenerationId,
  updateStatus,
  getAllPending,
  deleteRequest,
  saveProxyCheckpoint,
  cleanupStale,
  updateStreamCheckpoints,
  markStreamApplied,
  saveRecoveryRecord,
  type StreamRecord,
} from './streamDb';

function makeRecord(overrides: Partial<StreamRecord> = {}): StreamRecord {
  return {
    requestId: 'req-1',
    chatIndex: 0,
    messageIndex: 1,
    bufferedText: '',
    status: 'streaming',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    acknowledged: false,
    ...overrides,
  };
}

beforeEach(async () => {
  // Clear all records
  const all = await getAllPending();
  for (const r of all) {
    await deleteRequest(r.requestId);
  }
});

describe('streamDb CRUD', () => {
  it('saves and retrieves a record', async () => {
    const record = makeRecord({ requestId: 'crud-1', bufferedText: 'hello' });
    await saveRequest(record);
    const result = await getRequest('crud-1');
    expect(result).toBeDefined();
    expect(result!.requestId).toBe('crud-1');
    expect(result!.bufferedText).toBe('hello');
    expect(result!.status).toBe('streaming');
  });

  it('returns undefined for non-existent record', async () => {
    const result = await getRequest('nonexistent');
    expect(result).toBeUndefined();
  });

  it('deletes a record', async () => {
    await saveRequest(makeRecord({ requestId: 'del-1' }));
    await deleteRequest('del-1');
    const result = await getRequest('del-1');
    expect(result).toBeUndefined();
  });

  it('delete is no-op for non-existent record', async () => {
    await expect(deleteRequest('nonexistent')).resolves.toBeUndefined();
  });
});

describe('appendText', () => {
  it('appends text to existing record', async () => {
    await saveRequest(makeRecord({ requestId: 'append-1', bufferedText: 'Hello' }));
    await appendText('append-1', ' World');
    const result = await getRequest('append-1');
    expect(result!.bufferedText).toBe('Hello World');
  });

  it('updates updatedAt timestamp', async () => {
    const before = Date.now();
    await saveRequest(makeRecord({ requestId: 'append-ts', updatedAt: before - 5000 }));
    await appendText('append-ts', 'text');
    const result = await getRequest('append-ts');
    expect(result!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('is no-op for non-existent record', async () => {
    await expect(appendText('nonexistent', 'text')).resolves.toBeUndefined();
  });

  it('updates lastProxyEventId when provided', async () => {
    await saveRequest(makeRecord({ requestId: 'append-eid', lastProxyEventId: 0 }));
    await appendText('append-eid', 'chunk', 42);
    const result = await getRequest('append-eid');
    expect(result!.lastProxyEventId).toBe(42);
    expect(result!.bufferedText).toBe('chunk');
  });

  it('does not change lastProxyEventId when not provided', async () => {
    await saveRequest(makeRecord({ requestId: 'append-no-eid', lastProxyEventId: 10 }));
    await appendText('append-no-eid', 'chunk');
    const result = await getRequest('append-no-eid');
    expect(result!.lastProxyEventId).toBe(10);
  });

  it('stores generationId when provided', async () => {
    await saveRequest(makeRecord({ requestId: 'append-gen' }));
    await appendText('append-gen', 'chunk', 7, 'gen-123');
    const result = await getRequest('append-gen');
    expect(result!.generationId).toBe('gen-123');
  });

  it('accumulates text over multiple appends', async () => {
    await saveRequest(makeRecord({ requestId: 'append-multi' }));
    await appendText('append-multi', 'a');
    await appendText('append-multi', 'b');
    await appendText('append-multi', 'c');
    const result = await getRequest('append-multi');
    expect(result!.bufferedText).toBe('abc');
  });
});

describe('updateStatus', () => {
  it('updates status field', async () => {
    await saveRequest(makeRecord({ requestId: 'status-1', status: 'streaming' }));
    await updateStatus('status-1', 'completed');
    const result = await getRequest('status-1');
    expect(result!.status).toBe('completed');
  });

  it('sets error when provided', async () => {
    await saveRequest(makeRecord({ requestId: 'status-err' }));
    await updateStatus('status-err', 'failed', 'Network error');
    const result = await getRequest('status-err');
    expect(result!.status).toBe('failed');
    expect(result!.error).toBe('Network error');
  });

  it('is no-op for non-existent record', async () => {
    await expect(updateStatus('nonexistent', 'completed')).resolves.toBeUndefined();
  });
});

describe('getAllPending', () => {
  it('returns only non-acknowledged records', async () => {
    await saveRequest(makeRecord({ requestId: 'pending-1', acknowledged: false }));
    await saveRequest(makeRecord({ requestId: 'pending-2', acknowledged: true }));
    await saveRequest(makeRecord({ requestId: 'pending-3', acknowledged: false }));
    const results = await getAllPending();
    const ids = results.map((r) => r.requestId).sort();
    expect(ids).toEqual(['pending-1', 'pending-3']);
  });

  it('returns empty array when no records', async () => {
    const results = await getAllPending();
    expect(results).toEqual([]);
  });
});

describe('cleanupStale', () => {
  it('removes only acknowledged records older than maxAgeMs', async () => {
    const old = Date.now() - 7200000; // 2 hours ago
    await saveRequest(makeRecord({ requestId: 'stale-1', acknowledged: true, createdAt: old }));
    await saveRequest(makeRecord({ requestId: 'fresh-1', createdAt: Date.now() }));
    await cleanupStale(3600000); // 1 hour threshold
    expect(await getRequest('stale-1')).toBeUndefined();
    expect(await getRequest('fresh-1')).toBeDefined();
  });
});

describe('proxy recovery fields', () => {
  it('persists parser state and cursor in one checkpoint', async () => {
    await saveRequest(makeRecord({ requestId: 'checkpoint-1' }));
    await saveProxyCheckpoint('checkpoint-1', {
      bufferedText: 'visible', bufferedReasoning: 'thought', lastProxyEventId: 7,
      llmSsePartial: 'data: {"x"', thinkTagCheckpoint: { state: 'inside', pending: '</thi' },
    });
    expect(await getRequest('checkpoint-1')).toMatchObject({ bufferedText: 'visible', bufferedReasoning: 'thought', lastProxyEventId: 7, llmSsePartial: 'data: {"x"', thinkTagCheckpoint: { state: 'inside', pending: '</thi' } });
  });
  it('persists proxySessionId and lastProxyEventId', async () => {
    await saveRequest(
      makeRecord({
        requestId: 'proxy-1',
        proxySessionId: 'chat:uuid',
        lastProxyEventId: 150,
      })
    );
    const result = await getRequest('proxy-1');
    expect(result!.proxySessionId).toBe('chat:uuid');
    expect(result!.lastProxyEventId).toBe(150);
  });

  it('updates generationId independently', async () => {
    await saveRequest(makeRecord({ requestId: 'proxy-gen' }));
    await setGenerationId('proxy-gen', 'gen-xyz');
    const result = await getRequest('proxy-gen');
    expect(result!.generationId).toBe('gen-xyz');
  });
});


describe('saved checkpoints', () => {
  const snapshot = (hash: string) => ({ chats: [{ id: 'chat', branchTree: { rootId: 'node', activePath: ['node'], nodes: { node: { id: 'node', role: 'assistant' as const, parentId: null, contentHash: hash, createdAt: 1 } } } }] });
  it('updates the exact request target without using its old indexes', async () => {
    await saveRequest(makeRecord({ chatId: 'chat', nodeId: 'node', checkpointHash: 'old', chatIndex: 9, messageIndex: 9 }));
    await updateStreamCheckpoints(snapshot('saved'), [{ requestId: 'req-1', chatId: 'chat', nodeId: 'node' }]);
    expect((await getRequest('req-1'))?.checkpointHash).toBe('saved');
    await updateStreamCheckpoints(snapshot('wrong-request'), [{ requestId: 'other', chatId: 'chat', nodeId: 'node' }]);
    expect((await getRequest('req-1'))?.checkpointHash).toBe('saved');
  });
  it('retains legacy and mismatched recovery data, including stale unacknowledged records', async () => {
    await saveRequest(makeRecord({ requestId: 'legacy', createdAt: 1 }));
    await saveRequest(makeRecord({ requestId: 'mismatch', status: 'completed', chatId: 'chat', nodeId: 'node', checkpointHash: 'old', checkpointRole: 'assistant', appliedHash: 'recovered', createdAt: 1 }));
    await cleanupStale(1);
    await updateStreamCheckpoints(snapshot('edited'), []);
    expect(await getRequest('legacy')).toBeDefined();
    expect(await getRequest('mismatch')).toBeDefined();
    await updateStreamCheckpoints(snapshot('recovered'), []);
    expect(await getRequest('mismatch')).toBeUndefined();
    expect(await getRequest('legacy')).toBeDefined();
  });
  it('keeps finalized terminal output until the matching primary snapshot succeeds', async () => {
    await saveRequest(makeRecord({ chatId: 'chat', nodeId: 'node', status: 'completed', bufferedText: 'partial', proxySessionId: 'proxy', proxyComplete: true }));
    await markStreamApplied('req-1', 'final', 'assistant', 'partial', '');
    expect(await getRequest('req-1')).toMatchObject({ bufferedText: 'partial', status: 'completed', appliedHash: 'final' });
    expect(await updateStreamCheckpoints(snapshot('older'), [])).toEqual([]);
    expect(await getRequest('req-1')).toBeDefined();
    expect(await updateStreamCheckpoints(snapshot('final'), [])).toEqual([expect.objectContaining({ proxySessionId: 'proxy' })]);
    expect(await getRequest('req-1')).toBeUndefined();
    await markStreamApplied('req-1', 'final', 'assistant', 'partial', '');
    expect(await getRequest('req-1')).toBeUndefined();
  });

  it('retains a completed worker record when only the trailing reasoning was not delivered', async () => {
    await saveRequest(makeRecord({ chatId: 'chat', nodeId: 'node', status: 'completed', bufferedText: 'answer', bufferedReasoning: 'thought suffix', proxySessionId: 'proxy', proxyComplete: true }));
    await markStreamApplied('req-1', 'incomplete', 'assistant', 'answer', 'thought');
    expect((await getRequest('req-1'))?.appliedHash).toBeUndefined();
    expect(await updateStreamCheckpoints(snapshot('incomplete'), [])).toEqual([]);
    expect(await getRequest('req-1')).toMatchObject({ bufferedText: 'answer', bufferedReasoning: 'thought suffix' });
    await markStreamApplied('req-1', 'complete', 'assistant', 'answer', 'thought suffix');
    expect(await updateStreamCheckpoints(snapshot('complete'), [])).toEqual([expect.objectContaining({ proxySessionId: 'proxy' })]);
  });

  it('does not recreate a purged recovery record or update an invalidated target', async () => {
    const record = makeRecord({ bufferedText: 'recovered' });
    await saveRecoveryRecord(record, () => true);
    expect(await getRequest(record.requestId)).toBeUndefined();
    await saveRequest({ ...record, bufferedText: 'original' });
    await saveRecoveryRecord(record, () => false);
    expect(await getRequest(record.requestId)).toMatchObject({ bufferedText: 'original' });
  });

  it('does not acknowledge heartbeat partials before the worker commits terminal status', async () => {
    await saveRequest(makeRecord({ chatId: 'chat', nodeId: 'node', checkpointRole: 'assistant', bufferedText: 'partial', proxySessionId: 'proxy' }));
    await markStreamApplied('req-1', 'partial-hash', 'assistant', 'partial', '');
    expect((await getRequest('req-1'))?.appliedHash).toBeUndefined();
    expect(await updateStreamCheckpoints(snapshot('partial-hash'), [])).toEqual([]);
    await appendText('req-1', ' later worker output');
    await updateStatus('req-1', 'interrupted');
    await markStreamApplied('req-1', 'partial-hash', 'assistant', 'partial', '');
    expect(await updateStreamCheckpoints(snapshot('partial-hash'), [])).toEqual([]);
    expect(await getRequest('req-1')).toMatchObject({ bufferedText: 'partial later worker output', status: 'interrupted' });
    await markStreamApplied('req-1', 'terminal-hash', 'assistant', 'partial later worker output', '');
    expect(await updateStreamCheckpoints(snapshot('terminal-hash'), [])).toEqual([]);
    expect(await getRequest('req-1')).toMatchObject({ checkpointHash: 'terminal-hash', appliedHash: undefined, acknowledged: false });
  });
  it('retains a streaming record even if it has an old applied hash', async () => {
    await saveRequest(makeRecord({ chatId: 'chat', nodeId: 'node', checkpointRole: 'assistant', appliedHash: 'partial-hash' }));
    expect(await updateStreamCheckpoints(snapshot('partial-hash'), [])).toEqual([]);
    expect(await getRequest('req-1')).toBeDefined();
  });

});
