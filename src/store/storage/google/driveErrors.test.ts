import { expect, it } from 'vitest';
import { isInvalidSyncFileId } from './driveErrors';

it('recognizes only structured Drive invalid-file-ID errors', () => {
  for (const location of ['fileId', 'parameter fileId']) {
    const body = { error: { errors: [{ location }] } };
    expect(isInvalidSyncFileId(400, body)).toBe(true);
    expect(isInvalidSyncFileId(403, body)).toBe(false);
  }
  for (const body of [null, 'fileId', {}, { error: null }, { error: { errors: {} } },
    { error: { errors: [null, 'fileId', {}, { location: 'parentId' }] } }]) {
    expect(isInvalidSyncFileId(400, body)).toBe(false);
  }
});
