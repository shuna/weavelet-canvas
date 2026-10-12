import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine } from './webEngine.mjs';
import { FakeDrive } from './fakeDrive.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const web = await engine(path.resolve(process.argv[2] ?? repo));
const fixed = JSON.parse(readFileSync(path.join(repo, 'tests/fixtures/web-native/message-attributes.json'), 'utf8'));
const snapshot = fixed.branchedSnapshot;
const password = 'FAKE TEST ONLY attributes passphrase';
const drive = new FakeDrive(web.DriveNotFoundError);
const created = await web.EncryptedDriveSync.create(drive, password, { partBytes: 128 });
await created.session.push(snapshot, true);
writeFileSync(path.join(repo, 'tests/fixtures/web-native/google-message-attributes-wire.json'), JSON.stringify({ fixtureVersion: 1,
  description: 'FAKE ONLY. Actual Web protocol output from the fixed handwritten message-attributes fixture.',
  password, dataset: created.session.dataset, capture: drive.capture(), expectedRecords: await web.toRecords(snapshot), expectedAttributes: fixed.expected.branchedAttributes }, null, 2) + '\n');
console.log('Created actual Web message attributes packet fixture.');
