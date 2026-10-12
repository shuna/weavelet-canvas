declare const nativeSyncCall: (json: string) => string;
export function host(operation: string, ...args: unknown[]): any {
  const result = JSON.parse(nativeSyncCall(JSON.stringify({ operation, args: args.map(value => JSON.stringify(value ?? null)) })));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
export const bytes = (value: Uint8Array) => Array.from(value);
