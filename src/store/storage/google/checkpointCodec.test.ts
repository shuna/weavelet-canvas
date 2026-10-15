import { afterEach, expect, it, vi } from 'vitest';
import { createEncodedCheckpoint, decodeVerifyCheckpoint, recordRoot } from './checkpoint';
import { decodeNativeParts, encodeNativeWire } from './nativeWireCodec';
import type { Commit } from './replay';
import type { Checkpoint } from './checkpoint';

const commits: Record<string, Commit> = { root: { version: 1, parents: [], changes: [
  { key: JSON.stringify(['state', 'defaultSystemMessage']), before: null, after: JSON.stringify('synthetic 日本語 😀') },
] } };
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('encodes without returning records, and verifies only the checkpoint source subset', async () => {
  const progress = vi.fn();
  const encoded = await createEncodedCheckpoint({ commits, tips: ['root'] }, progress);
  expect(Object.keys(encoded).sort()).toEqual(['commits', 'payload', 'stateRoot']);
  expect(encoded.commits).toEqual(['root']);
  expect(encoded.payload).toBeInstanceOf(Uint8Array);
  expect(progress).toHaveBeenCalled();
  const chunks = [encoded.payload.slice(0, 7), encoded.payload.slice(7)];
  const verified = await decodeVerifyCheckpoint({ chunks, stateRoot: encoded.stateRoot,
    commits: { ...commits, later: { version: 1, parents: ['root'], changes: [] } }, expectedCommitIds: ['root'] });
  expect(verified.records[JSON.stringify(['state', 'defaultSystemMessage'])]).toBe(JSON.stringify('synthetic 日本語 😀'));
  expect(Object.keys(verified.commits)).toEqual(['root']);
  expect(chunks[0]).toEqual(encoded.payload.slice(0, 7));
  await expect(decodeVerifyCheckpoint({ chunks, stateRoot: '0'.repeat(64), commits })).rejects.toThrow('publication mismatch');
  await expect(decodeVerifyCheckpoint({ chunks, stateRoot: encoded.stateRoot, commits: {} })).rejects.toThrow('Unknown checkpoint source');
  await expect(decodeVerifyCheckpoint({ chunks, stateRoot: encoded.stateRoot, commits, expectedCommitIds: ['root', 'later'] }))
    .rejects.toThrow('source set mismatch');
  await expect(decodeVerifyCheckpoint({ chunks, stateRoot: encoded.stateRoot, commits, expectedCommitIds: ['root', 'root'] }))
    .rejects.toThrow('source set mismatch');
});

it('still rejects a false snapshot with a recomputed root and damaged native bytes', async () => {
  const encoded = await createEncodedCheckpoint({ commits, tips: ['root'] });
  const { value } = await decodeNativeParts<Checkpoint>([encoded.payload]);
  value.records[JSON.stringify(['state', 'defaultSystemMessage'])] = JSON.stringify('false synthetic state');
  value.stateRoot = await recordRoot(value.records, value.conflicts);
  await expect(decodeVerifyCheckpoint({ chunks: [await encodeNativeWire(value)], stateRoot: value.stateRoot, commits }))
    .rejects.toThrow('differs from replayed history');
  const corrupt = encoded.payload.slice(); corrupt[corrupt.length - 1] ^= 255;
  await expect(decodeVerifyCheckpoint({ chunks: [corrupt], stateRoot: encoded.stateRoot, commits })).rejects.toThrow('Invalid native sync gzip');
});

it('runs combined worker operations with progress and transfers only the encoded payload', async () => {
  const scope: any = { postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('./processing.worker');
  scope.onmessage({ data: { id: 401, operation: 'createEncodedCheckpoint', value: { commits, tips: ['root'] } } });
  await vi.waitFor(() => expect(scope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ id: 401,
    value: { stateRoot: expect.any(String), payload: expect.any(Uint8Array), commits: ['root'] } }));
  const [reply, options] = scope.postMessage.mock.calls.at(-1)!;
  expect(options.transfer).toEqual([reply.value.payload.buffer]);
  expect(scope.postMessage.mock.calls.some(([message]: any[]) => message.progress?.step === 'replaying')).toBe(true);
  scope.postMessage.mockClear();
  scope.onmessage({ data: { id: 402, operation: 'decodeVerifyCheckpoint', value: {
    chunks: [reply.value.payload], commits, stateRoot: reply.value.stateRoot, expectedCommitIds: ['root'],
  } } });
  await vi.waitFor(() => expect(scope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ id: 402,
    value: { records: { [JSON.stringify(['state', 'defaultSystemMessage'])]: JSON.stringify('synthetic 日本語 😀') } } }));
  expect(scope.postMessage.mock.calls.at(-1)![1].transfer).toEqual([]);
});

it('uses the same combined helpers when Workers are unavailable', async () => {
  vi.stubGlobal('Worker', undefined);
  const processing = await import('./processing');
  const encoded = await processing.createEncodedCheckpointAsync({ commits, tips: ['root'] });
  const verified = await processing.decodeVerifyCheckpointAsync({ chunks: [encoded.payload], commits, stateRoot: encoded.stateRoot });
  expect(verified.tips).toEqual(['root']);
});
