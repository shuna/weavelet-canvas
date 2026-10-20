import { host, bytes } from './host';
import { measure } from './metrics';
export const syncCache = (dataset: string) => measure('cache', async () => { const value = host('syncCache', dataset); return value == null ? undefined : new Uint8Array(value); });
export const readSyncEntries = (dataset: string, keys: string[]) => measure('cache', async () => host('readSyncEntries', dataset, keys).map((value: number[] | null) => value == null ? undefined : new Uint8Array(value)));
export const writeSyncCache = (dataset: string, value?: Uint8Array, entries: [string, Uint8Array][] = [], remove: string[] = []) => measure('cache', async () => host('writeSyncCache', dataset, value ? bytes(value) : null, entries.map(([key, value]) => [key, bytes(value)]), remove));
export const rememberedSyncKey = async (dataset: string, key?: unknown) => host('rememberedSyncKey', dataset, key ?? null) ?? undefined;
