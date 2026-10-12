import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engine } from './webEngine.mjs';
import { FakeDrive } from './fakeDrive.mjs';
const filenames = process.argv.length > 3 ? process.argv.slice(3) : ['/private/tmp/weavelet-native-session-create-output.json', '/private/tmp/weavelet-native-session-pack-output.json', '/private/tmp/weavelet-native-session-attributes-output.json'];
for (const filename of filenames) {
  const web = await engine(path.resolve(process.argv[2] ?? '.'));
  const fixture = JSON.parse(readFileSync(filename, 'utf8'));
  const drive = new FakeDrive(web.DriveNotFoundError, fixture.capture);
  const session = new web.EncryptedDriveSync(fixture.dataset, drive);
  await session.unlock(fixture.password);
  const snapshot = await session.pull();
  assert.deepEqual({ ...await web.toRecords(snapshot) }, fixture.expectedRecords);
  await session.acceptLocal(snapshot);
  const before = JSON.stringify(drive.capture());
  await session.push(snapshot);
  assert.equal(JSON.stringify(drive.capture()), before, 'Accepted baseline must prevent duplicate publication');
  console.log(`Actual Web read/accept/push verified native ${filename.includes('attributes') ? 'attributes resolution' : filename.includes('pack') ? 'pack' : 'created multipart'} session.`);
}
