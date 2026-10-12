import { host, bytes } from './host';
export const syncCache = async (dataset: string) => { const value = host('syncCache', dataset); return value == null ? undefined : new Uint8Array(value); };
export const readSyncEntries = async (dataset: string, keys: string[]) => host('readSyncEntries', dataset, keys).map((value: number[] | null) => value == null ? undefined : new Uint8Array(value));
export const writeSyncCache = async (dataset: string, value?: Uint8Array, entries: [string, Uint8Array][] = [], remove: string[] = []) => host('writeSyncCache', dataset, value ? bytes(value) : null, entries.map(([key, value]) => [key, bytes(value)]), remove);
export const rememberedSyncKey = async (dataset: string, key?: unknown) => host('rememberedSyncKey', dataset, key ?? null) ?? undefined;
