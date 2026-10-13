import { describe, expect, it } from 'vitest';
import { compress } from 'lz-string';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { computeCloudSyncMetrics } from '../guards';
import {
  cloudKitBytesToCompressed,
  cloudKitCompressedToBytes,
  cloudKitLocalWins,
  cloudKitPayloadJSON,
  cloudKitSnapshotLayout,
} from '../../../../../shared/google-sync/cloudKit';

describe('shared CloudKit wire rules', () => {
  it('preserves every UTF-16 code unit as little-endian BYTES', () => {
    const units = '\ud800\u0000\u00ff\u4e2d\udfff';
    const bytes = cloudKitCompressedToBytes(units);
    expect(Array.from(bytes)).toEqual([0, 216, 0, 0, 255, 0, 45, 78, 255, 223]);
    expect(cloudKitBytesToCompressed(bytes)).toBe(units);
    expect(() => cloudKitBytesToCompressed(bytes.subarray(1))).toThrow('Invalid CloudKit payload');
  });

  it('returns the original JSON text and rejects damaged payloads', () => {
    const json = '{"state":{"unknownLargeNumber":9007199254740993},"version":18}';
    expect(cloudKitPayloadJSON(cloudKitCompressedToBytes(compress(json)))).toBe(json);
    expect(() => cloudKitPayloadJSON(new Uint8Array([0, 0]))).toThrow('Invalid CloudKit payload');
  });

  it('selects wrapped and legacy state without rewriting its values', () => {
    expect(cloudKitSnapshotLayout({ state: { chats: [] }, version: 18 }, 19)).toEqual({ wrapped: true, version: 18 });
    expect(cloudKitSnapshotLayout({ chats: [] }, 19)).toEqual({ wrapped: false, version: 19 });
    expect(() => cloudKitSnapshotLayout({ state: null }, 19)).toThrow('Invalid CloudKit snapshot state');
    expect(() => cloudKitSnapshotLayout([], 19)).toThrow('Invalid CloudKit snapshot');
  });

  it('chooses local state on an equal timestamp', () => {
    expect(cloudKitLocalWins(100, 100)).toBe(true);
    expect(cloudKitLocalWins(100, 101)).toBe(false);
    expect(cloudKitLocalWins(100)).toBe(true);
  });

  it('exposes the same layout, LWW and upload guards through the native bundle', () => {
    const bundle = readFileSync('shared/google-sync/GoogleSync.bundle.js', 'utf8');
    const nativeSyncCall = (requestJSON: string) => {
      const request = JSON.parse(requestJSON);
      if (request.operation !== 'utf8') throw new Error(`Unexpected host call: ${request.operation}`);
      const text = JSON.parse(request.args[0]) as string;
      if (text !== (text as string & { toWellFormed(): string }).toWellFormed()) throw new Error('Native host rejected an isolated surrogate');
      return JSON.stringify({ ok: true, value: Array.from(new TextEncoder().encode(text)) });
    };
    const bridge = runInNewContext(`${bundle}\nWeaveletGoogleSync`, { nativeSyncCall }) as {
      cloudKitOperation: (input: string) => string;
    };
    const call = (input: object) => JSON.parse(bridge.cloudKitOperation(JSON.stringify(input)));
    expect(call({ operation: 'constants' })).toEqual({
      recordName: 'weavelet-default-snapshot', recordType: 'WeaveletSnapshot', version: 18,
    });
    expect(call({ operation: 'layout', value: { state: {}, version: 18 } }))
      .toEqual({ wrapped: true, version: 18 });
    expect(call({ operation: 'localWins', localUpdatedAt: 100, serverUpdatedAt: 101 })).toBe(false);
    const snapshot = { state: { chats: [{ id: 'one' }], contentStore: {} }, version: 18 };
    expect(call({ operation: 'receiveGuard', snapshotJSON: JSON.stringify(snapshot) }))
      .toEqual({ compatibleVersion: true, validFolders: true });
    expect(call({ operation: 'receiveGuard', snapshotJSON: JSON.stringify({ ...snapshot, version: 17 }) }))
      .toEqual({ compatibleVersion: false, validFolders: true });
    expect(call({ operation: 'receiveGuard', snapshotJSON: JSON.stringify({
      ...snapshot, state: { ...snapshot.state, folders: { loop: { id: 'loop', name: 'Loop', order: 0, expanded: true, parentId: 'loop' } } },
    }) })).toEqual({ compatibleVersion: true, validFolders: false });
    const guarded = call({ operation: 'uploadGuard', snapshotJSON: JSON.stringify(snapshot), previousMetrics: null });
    expect(guarded).toEqual({ message: null, metrics: computeCloudSyncMetrics(snapshot) });
    const surrogateSnapshot = { state: { chats: [{ id: 'one', title: '\ud800\udfff11' }], contentStore: {} }, version: 18 };
    const compressed = compress(JSON.stringify(surrogateSnapshot));
    expect(compressed).not.toBe((compressed as string & { toWellFormed(): string }).toWellFormed());
    expect(call({ operation: 'uploadGuard', snapshotJSON: JSON.stringify(surrogateSnapshot), previousMetrics: null }).metrics)
      .toEqual(computeCloudSyncMetrics(surrogateSnapshot));
    expect(call({ operation: 'uploadGuard', snapshotJSON: JSON.stringify({ state: { chats: [] } }), previousMetrics: null }).message)
      .toContain('erase all chats');
  });
});
