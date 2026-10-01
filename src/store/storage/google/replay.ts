import { applyChanges, SyncConflictError, type Records, type Change } from './records';
import { digest } from './crypto';

export interface Commit { version: 1; parents: string[]; changes: Change[]; resolutions?: Record<string, (string | null)[]> }

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
  const latest = (versions: { id: string; value: string | null }[]) =>
    versions.filter((v) => !versions.some((other) => ancestors.get(other.id)?.has(v.id)));
  const valueOf = (versions: { value: string | null }[]) => {
    const values = new Set(versions.map((v) => v.value));
    if (values.size > 1) throw new SyncConflictError([]);
    return versions[0]?.value ?? null;
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
        } else parentValue = valueOf(parents);
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
    if (values.length > 1) conflicts[key] = await Promise.all(values.map(v => v === null ? null : digest(v)));
    const value = versions[0]?.value ?? null;
    if (value !== null) records[key] = value;
  }
  return { records, conflicts };
}
