// Fake data only. Use the actual Web engine and crypto to produce native boundary fixtures.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine } from './webEngine.mjs';
import { FakeDrive } from './fakeDrive.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const web = await engine(repo);
const snapshot = JSON.parse(readFileSync(path.join(repo, 'tests/fixtures/web-native/content-entry-wire.json'))).snapshot;
let seed = 7;
const base = Array.from({ length: 18000 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return String.fromCharCode(33 + seed % 90); }).join('');
for (const [index, text] of [base, base.slice(0, 7000) + ' edited ' + base.slice(7008), base.slice(0, 12000) + ' another edit ' + base.slice(12014)].entries()) {
  snapshot.state.contentStore['FAKE-wire-' + index] = { content: [{ text, type: 'text' }], refCount: 0, xFuture: { preserved: index } };
}
const password = 'FAKE TEST ONLY wire delta passphrase', drive = new FakeDrive(web.DriveNotFoundError);
const created = await web.EncryptedDriveSync.create(drive, password, { partBytes: 4096, wireDelta: true });
await created.session.push(snapshot, true);
const dataset = created.session.dataset, multipart = drive.capture();
const header = drive.files.get(dataset).metadata.appProperties.headerId;
const key = await web.unlockKey(JSON.parse(new TextDecoder().decode(drive.files.get(header).bytes)), password, dataset);
const commits = await drive.commits(dataset), manifestID = commits[0];
const manifest = web.decode(await web.decrypt(key, drive.files.get(manifestID).bytes, `${dataset}:${manifestID}`));
assert.equal(manifest.version, 3);
const payload = Buffer.concat(await Promise.all(manifest.parts.map(async id => Buffer.from(await web.decrypt(key, drive.files.get(id).bytes, `${dataset}:${id}`)))));
const wire = web.decode(payload);
assert.equal(wire.format, 'weavelet-sync-delta');
const malformed = structuredClone(wire);
const delta = malformed.value.changes.find(change => change.after && typeof change.after === 'object');
assert.ok(delta); delta.after.hash = '0'.repeat(64);
const bad = new FakeDrive(web.DriveNotFoundError, multipart), part = manifest.parts[0];
bad.files.get(part).bytes = await web.encrypt(key, web.encode(malformed), `${dataset}:${part}`);
bad.files.get(manifestID).bytes = await web.encrypt(key, web.encode({ ...manifest, parts: [part] }), `${dataset}:${manifestID}`);
let parent = manifestID, previous = await web.toRecords(snapshot), expected = structuredClone(snapshot);
for (let i = 1; i < 128; i++) {
  expected = structuredClone(snapshot); expected.state.theme = `FAKE delta theme ${i}`;
  const records = await web.toRecords(expected), commit = { version: 1, parents: [parent], changes: await web.diffRecords(previous, records) };
  const [id] = await drive.ids(1);
  await drive.put(id, dataset, 'commit', await web.encrypt(key, web.encode({ version: 2, parents: commit.parents, changes: commit.changes }), `${dataset}:${id}`));
  parent = id; previous = records;
}
await created.session.pull();
expected.state.theme = 'FAKE delta packed'; await created.session.push(expected);
const packIDs = await drive.packs(dataset);
assert.ok(packIDs.length);
const packVersions = await Promise.all(packIDs.map(async id => web.decode(await web.decrypt(key, drive.files.get(id).bytes, `${dataset}:${id}`)).version));
assert.ok(packVersions.includes(2));
writeFileSync(path.join(repo, 'tests/fixtures/web-native/google-wire-delta.json'), JSON.stringify({ fixtureVersion: 1,
  description: 'FAKE ONLY: actual Web opt-in manifest3 multipart, pack2, and authenticated malformed delta payload.',
  password, dataset, multipart, multipartRecords: await web.toRecords(snapshot), packed: drive.capture(), packedRecords: await web.toRecords(expected), damaged: bad.capture() }) + '\n');
console.log('Generated actual Web manifest3 and pack2 plus authenticated malformed delta fixture.');
