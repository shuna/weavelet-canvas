export function mergeEditTimes(key: string, values: (string | null | undefined)[]): string | undefined {
  if (key !== '["state","lastContentEditedAt"]' && !key.endsWith(',"updatedAt"]')) return;
  const path: string[] = JSON.parse(key);
  if (!((path[0] === 'state' && path.length === 2 && path[1] === 'lastContentEditedAt') ||
    (path[0] === 'chats' && path.at(-1) === 'updatedAt' && (path.length === 3 ||
      (path.length === 6 && path[2] === 'branchTree' && path[3] === 'nodes'))))) return;
  const times = values.map(value => value == null ? NaN : Number(value));
  if (times.length && times.every(time => Number.isFinite(time) && time > 0)) return String(Math.max(...times));
}
