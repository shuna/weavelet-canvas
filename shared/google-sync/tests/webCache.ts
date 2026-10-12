const sessions = new Map<string, Uint8Array>(), entries = new Map<string, Uint8Array>(), keys = new Map<string, unknown>();
export const syncCache = async (dataset: string) => sessions.get(dataset);
export const readSyncEntries = async (dataset: string, names: string[]) => names.map(name => entries.get(JSON.stringify([dataset, name])));
export const writeSyncCache = async (dataset: string, value?: Uint8Array, values: [string, Uint8Array][] = [], remove: string[] = []) => {
  if (value) sessions.set(dataset, value.slice());
  for (const [name, bytes] of values) entries.set(JSON.stringify([dataset, name]), bytes.slice());
  for (const name of remove) entries.delete(JSON.stringify([dataset, name]));
};
export const rememberedSyncKey = async (dataset: string, value?: unknown) => { if (value) keys.set(dataset, value); return keys.get(dataset); };
