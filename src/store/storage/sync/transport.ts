import type { TransferPurpose } from '../google/diagnostics';

export type SyncDataset = { id: string };
export type SyncChange = {
  id: string;
  removed?: boolean;
  dataset?: string;
  kind?: string;
};

export class SyncFileNotFoundError extends Error {}

export interface SyncTransport<T extends SyncDataset = SyncDataset> {
  readonly supportsCompaction?: boolean;
  ids(count: number): Promise<string[]>;
  folder(id: string, headerId: string, name?: string): Promise<T>;
  keyHeader(dataset: string): Promise<string>;
  read(id: string, purpose?: TransferPurpose): Promise<Uint8Array>;
  // IDs identify immutable bytes. Retrying a write must verify an existing file, never overwrite it.
  put(id: string, dataset: string, kind: string, bytes: Uint8Array): Promise<void>;
  startToken(): Promise<string>;
  history(dataset: string): Promise<{ commits: string[]; packs: string[] }>;
  commits(dataset: string): Promise<string[]>;
  packs(dataset: string): Promise<string[]>;
  // A cursor advances only after every dependency has been read and authenticated.
  changes(token: string): Promise<{ token: string; changes: SyncChange[] }>;
  remove(id: string): Promise<void>;
}
