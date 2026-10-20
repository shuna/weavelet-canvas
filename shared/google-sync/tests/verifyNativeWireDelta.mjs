// Fake Catalyst captures only; verify native writes with the actual Web reader.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine } from './webEngine.mjs';
import { FakeDrive } from './fakeDrive.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const capture = JSON.parse(readFileSync(process.argv[2] ?? '/private/tmp/weavelet-native-wire-delta-output.json', 'utf8'));
for (const output of capture.outputs) {
  // Each capture is a separate fork of the same fixture dataset; do not share its cache.
  const web = await engine(repo);
  const drive = new FakeDrive(web.DriveNotFoundError, output.capture);
  const reader = new web.EncryptedDriveSync(capture.dataset, drive);
  await reader.unlock(capture.password);
  // JSON I/O has no dictionary prototype; preserve every key and exact record string.
  const records = await web.toRecords(await reader.pull());
  assert.deepEqual(Object.fromEntries(Object.entries(records)), output.expectedRecords);
}
console.log('Actual Web reader accepted both native updates after manifest3/pack2 imports.');
