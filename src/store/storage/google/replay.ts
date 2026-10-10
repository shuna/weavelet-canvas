import { isNonBlockingRecord, selectActivePath } from './settings';
import { mergeEditTimes } from './editTimes';
import { applyChanges, SyncConflictError, type Records, type Change } from './records';
import { digest, encode } from './crypto';

export interface Commit { version: 1; parents: string[]; changes: Change[]; resolutions?: Record<string, (string | null)[]> }

export async function hashCommits(commits: Record<string, Commit>): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const [id, commit] of Object.entries(commits)) hashes[id] = await digest(encode(commit));
  return hashes;
}

export async function replayHistory({ commits, tips }: { commits: Record<string, Commit>; tips: string[] }) {
  // Replay retained history unchanged; run this CPU work in the sync worker.
  const histories = new Map<string, { id: string; value: string | null }[]>();
  const ancestors = new Map<string, Set<string>>();
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    const commit = commits[id];
    if (!commit) throw new Error('Missing sync history.');
    reachable.add(id); commit.parents.forEach(visit);
  };
  tips.forEach(visit);
  const remaining = new Set([...reachable].sort());
  const latest = (versions: { id: string; value: string | null }[]) => {
    const excluded = new Set<string>();
    const result: typeof versions = [];
    for (let index = versions.length - 1; index >= 0; index--) {
      const version = versions[index];
      if (excluded.has(version.id)) continue;
      result.push(version);
      for (const ancestor of ancestors.get(version.id)!) excluded.add(ancestor);
    }
    return result.reverse();
  };
  const valueOf = (versions: { value: string | null }[], key: string) => {
    const time = mergeEditTimes(key, versions.map(version => version.value));
    if (time !== undefined) return time;
    const values = new Set(versions.map((v) => v.value));
    if (values.size > 1 && !isNonBlockingRecord(key)) throw new SyncConflictError([]);
    return versions[0]?.value ?? null;
  };
  const repairedPath = (key: string, versions: { id: string; value: string | null }[], records: Records, preceding?: Set<string>) => {
    if (!key.endsWith(',"activePath"]')) return;
    const values = [...new Set(versions.map(version => version.value))];
    if (values.length < 2) {
      if (!values[0]) return;
      const path: string[] = JSON.parse(key), ids: unknown = JSON.parse(values[0]);
      if (!Array.isArray(ids) || !ids.some(id => {
        const removed = histories.get(JSON.stringify([...path.slice(0, 3), 'nodes', id, 'id']));
        const retained = removed && latest(removed.filter(version => !preceding || preceding.has(version.id)));
        return retained?.length && retained.every(version => version.value === null);
      })) return;
    }
    return selectActivePath(key, values, records);
  };
  while (remaining.size) {
    let progress = false;
    for (const id of remaining) {
      const commit = commits[id];
      if (!commit.parents.every((p) => ancestors.has(p))) continue;
      const preceding = new Set(commit.parents);
      for (const parent of commit.parents) for (const ancestor of ancestors.get(parent)!) preceding.add(ancestor);
      ancestors.set(id, preceding);
      const keys = new Set<string>();
      for (const change of commit.changes) {
        if (!change || typeof change.key !== 'string' || keys.has(change.key)) throw new Error('Invalid sync change.');
        keys.add(change.key);
        const history = histories.get(change.key) ?? [];
        const parents = latest(history.filter((v) => preceding.has(v.id)));
        let parentValue: string | null;
        if (commit.resolutions?.[change.key]) {
          const expected = [...new Set(await Promise.all(parents.map(v => v.value === null ? null : digest(v.value))))].sort();
          if (expected.length < 2 || JSON.stringify(expected) !== JSON.stringify([...commit.resolutions[change.key]].sort())) {
            throw new Error('Invalid conflict resolution parents.');
          }
          parentValue = parents[0]?.value ?? null;
        } else if (isNonBlockingRecord(change.key)) {
          // Old writers may have continued from either side of a presentation/cache conflict.
          const parentHashes = await Promise.all(parents.map(version => version.value === null ? null : digest(version.value)));
          const matching = parentHashes.indexOf(change.before);
          parentValue = matching >= 0 ? parents[matching].value : valueOf(parents, change.key);
          if (matching < 0 && change.key.endsWith(',"activePath"]')) {
            const parentRecords: Records = {};
            for (const [key, versions] of histories) {
              const retained = latest(versions.filter(version => preceding.has(version.id)));
              const value = mergeEditTimes(key, retained.map(version => version.value)) ?? retained[0]?.value ?? null;
              if (value !== null) parentRecords[key] = value;
            }
            const repaired = repairedPath(change.key, parents, parentRecords, preceding);
            if (repaired !== undefined && (repaired === null ? null : await digest(repaired)) === change.before) parentValue = repaired;
          }
        } else parentValue = valueOf(parents, change.key);
        await applyChanges(parentValue === null ? {} : { [change.key]: parentValue }, [change]);
        history.push({ id, value: change.after });
        histories.set(change.key, history);
      }
      remaining.delete(id); progress = true;
    }
    if (!progress) throw new Error('Missing or cyclic sync history.');
  }
  const records: Records = {};
  const conflicts: Record<string, (string | null)[]> = {};
  for (const [key, history] of histories) {
    const versions = latest(history);
    const values = [...new Set(versions.map(v => v.value))];
    const time = mergeEditTimes(key, values);
    if (values.length > 1 && time === undefined && !isNonBlockingRecord(key)) conflicts[key] = await Promise.all(values.map(v => v === null ? null : digest(v)));
    const value = time ?? versions[0]?.value ?? null;
    if (value !== null) records[key] = value;
  }
  for (const [key, history] of histories) {
    const selected = repairedPath(key, latest(history), records);
    if (selected === null) delete records[key];
    else if (selected !== undefined) records[key] = selected;
  }
  return { records, conflicts };
}
