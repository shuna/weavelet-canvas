import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileImport } from '../../shared/google-sync/fileImport';
import { inspectLegacySnapshotContainer, LEGACY_SNAPSHOT_MAX_BYTES } from './legacySnapshotContainer';

const fixture = new Uint8Array(readFileSync(new URL('../../tests/fixtures/web-native/legacy-ios-sync-snapshot.wvlt', import.meta.url)));
const inspect = (bytes: Uint8Array) => inspectLegacySnapshotContainer(Array.from(bytes.slice(0, 20)), bytes.length);

describe('old Swift SnapshotContainer header', () => {
  it('uses actual writer bytes through the same shared native bridge', () => {
    expect(Array.from(fixture.slice(0, 4))).toEqual([0x54, 0x4c, 0x56, 0x57]);
    const expected = { uncompressedSize: new DataView(fixture.buffer).getUint32(8, true), compressedSize: fixture.length - 20 };
    expect(inspect(fixture)).toEqual(expected);
    expect(JSON.parse(fileImport(JSON.stringify({ operation: 'container', header: Array.from(fixture.slice(0, 20)), totalLength: fixture.length })))).toEqual(expected);
    expect(inspect(new TextEncoder().encode('{"version":3}'))).toBeNull();
    expect(inspect(new TextEncoder().encode('WVLT'))).toBeNull();
  });

  it('rejects unsupported headers and oversized or mismatched lengths before decoding', () => {
    expect(() => inspect(fixture.slice(0, 19))).toThrow();
    expect(() => inspect(new Uint8Array([...fixture, 0]))).toThrow();
    for (const [offset, value] of [[4, 2], [6, 2], [16, 1], [12, 0xff]]) {
      const bytes = fixture.slice(); bytes[offset] = value;
      expect(() => inspect(bytes)).toThrow();
    }
    for (const size of [0, LEGACY_SNAPSHOT_MAX_BYTES + 1]) {
      const bytes = fixture.slice(); new DataView(bytes.buffer).setUint32(8, size, true);
      expect(() => inspect(bytes)).toThrow();
    }
  });
});
