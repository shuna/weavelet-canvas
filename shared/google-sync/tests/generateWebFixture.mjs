// Synthetic fixtures only; no credentials, network requests or cloud writes.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine } from './webEngine.mjs';
import { FakeDrive } from './fakeDrive.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const webRoot = path.resolve(process.argv[2] ?? repo);
const web = await engine(webRoot);
const input = JSON.parse(readFileSync(path.join(repo, 'tests/fixtures/web-native/content-entry-wire.json'), 'utf8')).snapshot;
const password = 'FAKE TEST ONLY session passphrase';
const drive = new FakeDrive(web.DriveNotFoundError);
const created = await web.EncryptedDriveSync.create(drive, password, { partBytes: 128 });
await created.session.push(input, true);
const dataset = created.session.dataset;
const small = drive.capture();
const expected = structuredClone(input);
expected.state.theme = 'FAKE theme 127';
const header = drive.files.get(dataset).metadata.appProperties.headerId;
const envelope = JSON.parse(new TextDecoder().decode(drive.files.get(header).bytes));
const key = await web.unlockKey(envelope, password, dataset);
let parent = (await drive.commits(dataset))[0];
let previous = await web.toRecords(input);
for (let i = 1; i < 128; i++) {
  const snapshot = structuredClone(input); snapshot.state.theme = `FAKE theme ${i}`;
  const records = await web.toRecords(snapshot);
  const commit = { version: 2, parents: [parent], changes: await web.diffRecords(previous, records) };
  const [id] = await drive.ids(1);
  await drive.put(id, dataset, 'commit', await web.encrypt(key, web.encode(commit), `${dataset}:${id}`));
  parent = id; previous = records;
}
const reader = new web.EncryptedDriveSync(dataset, drive); await reader.unlock(password);
assert.deepEqual(await web.toRecords(await reader.pull()), await web.toRecords(expected));
writeFileSync(path.join(repo, 'tests/fixtures/web-native/google-session-wire.json'), JSON.stringify({ fixtureVersion: 1,
  description: 'FAKE ONLY. Actual Web envelope, multipart v1, inline v2 and 128-commit history; semantic snapshot comes from the fixed content entry fixture.',
  password, dataset, snapshot: input, expected, expectedRecords: await web.toRecords(expected), small, history: drive.capture() }, null, 2) + '\n');
console.log('Created fake Web session fixture with 128 authenticated commits.');
