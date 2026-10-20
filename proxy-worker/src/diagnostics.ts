export interface SessionDiagnostic {
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  phase: 'headers' | 'streaming' | 'disconnected' | 'complete' | 'interrupted' | 'failed' | 'acknowledged';
  lastEventId: number;
  lastChunkAt?: number;
  disconnectedAt?: number;
  disconnectReason?: string;
  lastClientWriteAt?: number;
  firstEventId: number;
  receivedBytes: number;
  bufferedBytes: number;
  cacheWrites: number;
  cacheFailures: number;
  lastCacheWriteAt?: number;
  reason?: string;
}

export interface ProxyStatus {
  version: string;
  checkedAt: number;
  colo: string;
  instanceId: string;
  scope: 'current-isolate' | 'durable-session' | 'all-sessions';
  nextCursor?: string | null;
  unavailableSessions?: number;
  recentSessionsVisible: boolean;
  storageDeletion?: { individual: boolean; all: boolean };
  limits: { cacheBytes: number; retentionMs: number; idleTimeoutMs: number };
  sessions: Array<{
    sessionId: string;
    local: SessionDiagnostic | null;
    cache: { state: 'available' | 'missing' | 'expired' | 'error' | 'acknowledged' | 'not-saved' | 'not-recorded'; firstEventId?: number; lastEventId?: number; terminal?: string; expiresAt?: number; updatedAt?: number; capability?: string; reason?: string };
  }>;
}

const recent = new Map<string, SessionDiagnostic>();
let instanceId: string | undefined;
export const getInstanceId = () => instanceId ??= crypto.randomUUID();
export function sessionDiagnostics(): SessionDiagnostic[] {
  for (const [id, value] of recent) if (Date.now() - value.updatedAt > 300_000) recent.delete(id);
  return [...recent.values()].sort((a, b) => b.startedAt - a.startedAt);
}
export function startDiagnostic(sessionId: string): SessionDiagnostic {
  sessionDiagnostics();
  while (recent.size >= 100) recent.delete(recent.keys().next().value!);
  const value: SessionDiagnostic = { sessionId, startedAt: Date.now(), updatedAt: Date.now(), phase: 'headers', lastEventId: 0, firstEventId: 1, receivedBytes: 0, bufferedBytes: 0, cacheWrites: 0, cacheFailures: 0 };
  recent.set(sessionId, value);
  return value;
}

export const forgetDiagnostic = (sessionId: string) => recent.delete(sessionId);
