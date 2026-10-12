import { EncryptedDriveSync } from './source/sync';
import { DriveNotFoundError } from './adapters/transport';
import { host } from './adapters/host';
import { toRecords, fromRecords, canonical, resolveStrict } from './source/records';
import { resolveContent } from '@utils/contentStore';
export { folderOperation, folderRows } from './folders';
export { generationRequest } from './generation';

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
const drive = new Proxy({}, { get: (_target, method: string) => (...args: unknown[]) => request(method,
  args.map(arg => arg instanceof Uint8Array ? Array.from(arg) : arg)).then(value => method === 'read' ? new Uint8Array(value as number[]) : value) });
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
      case 'pull': return session.pull();
      case 'acceptLocal': return session.acceptLocal(args.snapshot);
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
