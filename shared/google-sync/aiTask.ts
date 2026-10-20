import { aiTaskFingerprint } from '../../src/utils/aiTaskTarget';

export function aiTaskTarget(json: string): string {
  const input = JSON.parse(json);
  const before = aiTaskFingerprint(input.ticket, input.before);
  return JSON.stringify(before !== null && aiTaskFingerprint(input.ticket, input.current) === before);
}
