export { fileImport } from './fileImport';
export { branchHistory } from './branchHistory';
export { nodeRemoval } from './nodeRemoval';
export { nodeOptions } from './nodeOptions';
export { chatSearch } from './search';
export { navigationOperation } from './navigation';
export const driveFolderName = (json: string) => JSON.stringify(defaultSyncFolderName(JSON.parse(json)));
import { defaultSyncFolderName, driveListParameters, nextSyncFolderName, DEFAULT_SYNC_FOLDER_NAME } from '../../src/store/storage/google/datasetListing';
export const driveListing = (json: string) => JSON.stringify({ parameters: driveListParameters(), suggestedName: nextSyncFolderName(DEFAULT_SYNC_FOLDER_NAME, JSON.parse(json)) });
import { encryptedSyncHeaderId } from '../../src/store/storage/google/datasetHeader';
export const driveHeaderID = (json: string) => JSON.stringify(encryptedSyncHeaderId(JSON.parse(json)));
import { EncryptedDriveSync } from './source/sync';
import { DriveNotFoundError } from './adapters/transport';
import { host } from './adapters/host';
import { toRecords, fromRecords, canonical, resolveStrict } from './source/records';
import { resolveContent } from '@utils/contentStore';
export { folderOperation, folderRows } from './folders';
export { generationRequest } from './generation';
export { libraryOperation, libraryDefaults } from './library';
export { messageEdit } from './editing';
export { documentOperation, messageAttributesOperation } from './document';

const global = globalThis as any;
global.crypto = { randomUUID: () => host("uuid") };
global.console = { error: () => {}, warn: () => {}, log: () => {} };
global.performance = { now: () => Date.now() };
global.structuredClone = (value: unknown) => JSON.parse(JSON.stringify(value));
global.TextEncoder = class { encode(value: string) { return new Uint8Array(host('utf8', value)); } };
global.TextDecoder = class { decode(value: Uint8Array) { return host('text', Array.from(value)); } };
let sequence = 0;
let requests: { id: number; method: string; args: unknown[] }[] = [];
const replies = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const request = (method: string, args: unknown[]) => new Promise((resolve, reject) => {
  const id = ++sequence;
  requests.push({ id, method, args }); replies.set(id, { resolve, reject });
});
const drive = new Proxy({}, { get: (_target, method: string) => {
  if (method === 'supportsCompaction') return true;
  if (method === 'keyHeader') return (dataset: string) => request('metadata', [dataset]).then(file => encryptedSyncHeaderId(file as any));
  if (method === 'history') return async (dataset: string) => ({
    commits: await request('commits', [dataset]), packs: await request('packs', [dataset]),
  });
  return (...args: unknown[]) => request(method, args.map(arg => arg instanceof Uint8Array ? Array.from(arg) : arg)).then((value: any) => {
    if (method === 'read') return new Uint8Array(value);
    if (method === 'changes') return { ...value, changes: value.changes.map((change: any) => ({
      id: change.fileId, removed: change.removed || change.file?.trashed,
      dataset: change.file?.appProperties?.dataset, kind: change.file?.appProperties?.kind,
    })) };
    return value;
  });
} });
let session: EncryptedDriveSync;
let outcome: { status: string; value?: unknown; error?: string; conflictKeys?: string[] };
export const start = (operation: string, json: string) => {
  outcome = { status: 'pending' };
  const args = JSON.parse(json);
  Promise.resolve().then(async () => {
    switch (operation) {
      case 'create': {
        const created = await EncryptedDriveSync.create(drive as any, args.password, args.options);
        session = created.session; return created.file;
      }
      case 'open': session = new EncryptedDriveSync(args.dataset, drive as any, args.options); return null;
      case 'unlock': return session.unlock(args.password);
      case 'restoreKey': return session.restoreKey();
      case 'push': host('stageAccepted', session.dataset, args.snapshot); return session.push(args.snapshot, args.replace);
      case 'synchronize': host('stageAccepted', session.dataset, args.snapshot); return session.synchronize(args.snapshot,args.replace);
      case 'resolveForPublication': host('stageAccepted', session.dataset, args.snapshot); return session.resolve(args.snapshot,args.mode);
      case 'pull': return session.pull();
      case 'acceptLocal': host('stageAccepted',session.dataset,args.snapshot); return session.acceptLocal(args.snapshot);
      case 'receive': {
        const snapshot = await session.pull();
        host('stageAccepted', session.dataset, snapshot);
        await session.acceptLocal(snapshot);
        return snapshot;
      }
      case 'resolve': {
        host('stageAccepted', session.dataset, args.snapshot);
        const snapshot = await session.resolve(args.snapshot, args.mode);
        host('stageAccepted', session.dataset, snapshot);
        await session.acceptLocal(snapshot);
        return snapshot;
      }
      case 'close': session.close(); return null;
      default: throw new Error('Unknown sync operation');
    }
  }).then(value => { outcome = { status: 'done', value: value ?? null }; }, error => {
    outcome = { status: 'error', error: String(error.message ?? error), conflictKeys: error.keys };
  });
};
export const drain = () => { const pending = requests; requests = []; return JSON.stringify(pending); };
export const settle = (id: number, json: string) => {
  const reply = replies.get(id)!; replies.delete(id);
  const result = JSON.parse(json);
  if (result.ok) reply.resolve(result.value);
  else reply.reject(result.notFound ? new DriveNotFoundError(result.error) : new Error(result.error));
};
export const result = () => JSON.stringify({ ...outcome, value: undefined, valueJSON: outcome.value === undefined ? null : JSON.stringify(outcome.value) });

let recordOutcome: { valueJSON?: string; error?: string };
export const recordsStart = (operation: string, json: string) => {
  recordOutcome = {};
  const args = JSON.parse(json);
  Promise.resolve().then(() => {
    switch (operation) {
      case 'toRecords': return toRecords(args[0]);
      case 'fromRecords': return fromRecords(args[0]);
      case 'canonical': return canonical(args[0]);
      case 'resolveContent': return resolveStrict(args[0], args[1]);
      case 'resolveProjectedContent': return resolveContent(args[0], args[1]);
      default: throw new Error('Unknown shared record operation');
    }
  }).then(value => { recordOutcome = { valueJSON: JSON.stringify(value) }; }, error => { recordOutcome = { error: String(error.message ?? error) }; });
};
export const recordsResult = () => JSON.stringify(recordOutcome);

export { treeEdit } from "./treeEdit";

export { branchClipboard } from "./branchClipboard";

export { fileExport } from "./fileExport";

export { composerContent } from "./composer";

export { chatConfig } from "./chatConfig";

export { providerModelList } from "./providerModels";

export { remoteOutput } from "./remoteOutput";

export { generationPlan } from "./generationPlan";

export { localGenerationInput, localGenerationOutput } from "./localGeneration";

export { assistantPrefill } from './assistantPrefill';
