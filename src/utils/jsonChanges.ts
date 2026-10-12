export type DocumentPatch = { op: 'set'; path: (string | number)[]; value: any } | { op: 'remove'; path: (string | number)[] }
  | { op: 'keys'; path: (string | number)[]; keys: string[] };
export const orderedJSONEqual = (left: any, right: any): boolean => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every((key, index) => key === b[index] && orderedJSONEqual(left[key], right[key]));
};

// Diff within already-selected edited roots; unchanged leaves never leave the original native document.
function appendChanges(before: any, after: any, path: (string | number)[], output: DocumentPatch[]) {
  if (orderedJSONEqual(before, after)) return;
  // Opaque references name original native values and are atomic at this boundary.
  const opaque = (value: any) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && Number.isInteger(value.opaqueRef);
  if (opaque(before) || opaque(after)) { output.push({ op: 'set', path, value: after }); return; }
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < after.length; i++) {
      if (i < before.length) appendChanges(before[i], after[i], [...path, i], output);
      else output.push({ op: 'set', path: [...path, i], value: after[i] });
    }
    for (let i = before.length - 1; i >= after.length; i--) output.push({ op: 'remove', path: [...path, i] });
  } else if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) output.push({ op: 'remove', path: [...path, key] });
    for (const key of Object.keys(after)) {
      if (Object.hasOwn(before, key)) appendChanges(before[key], after[key], [...path, key], output);
      else output.push({ op: 'set', path: [...path, key], value: after[key] });
    }
    if (!orderedJSONEqual(Object.keys(before), Object.keys(after))) output.push({ op: 'keys', path, keys: Object.keys(after) });
  } else output.push({ op: 'set', path, value: after });
}
export function diffJSONChanges(before: any, after: any): DocumentPatch[] {
  const output: DocumentPatch[] = []; appendChanges(before, after, [], output); return output;
}
