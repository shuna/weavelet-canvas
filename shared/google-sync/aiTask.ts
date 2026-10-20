import { aiTaskFingerprint, orphanGenerationSessions } from '../../src/utils/aiTaskTarget';

export function aiTaskTarget(json: string): string {
  const input = JSON.parse(json);
  if (input.operation === 'orphans') {
    const sessions = orphanGenerationSessions(input.chatId, input.activePath ?? [], input.sessions ?? []);
    return JSON.stringify({ count: sessions.length, targetNodeId: sessions[0]?.targetNodeId ?? null });
  }
  const before = aiTaskFingerprint(input.ticket, input.before);
  return JSON.stringify(before !== null && aiTaskFingerprint(input.ticket, input.current) === before);
}
