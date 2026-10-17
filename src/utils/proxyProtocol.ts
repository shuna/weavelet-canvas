import type { OpenRouterObservation } from '@type/chat';

// ---------------------------------------------------------------------------
// Proxy SSE parsing
// ---------------------------------------------------------------------------

export interface ProxySseEvent {
  /** Sequential event ID from the proxy */
  id: number;
  /** Event type: undefined for data events, 'done' or 'error' for control */
  eventType?: string;
  /** The raw text chunk from the LLM (for data events) */
  rawText?: string;
  /** Metadata for done/error events */
  meta?: { totalChunks: number; complete: boolean; error?: string; reason?: string; cacheCapability?: 'available' | 'overflow'; openRouterObservation?: OpenRouterObservation };
}

/**
 * Parse proxy SSE text into structured events.
 *
 * IMPORTANT: A plain-JS copy of this function exists in public/sw-stream.js
 * (parseProxySse) for Service Worker scope which cannot import ES modules.
 * Keep both implementations in sync when making changes.
 *
 * Proxy SSE format:
 *   id: 1
 *   data: "JSON-stringified raw text"
 *
 *   event: done
 *   data: {"totalChunks":N,"complete":true}
 */
export function parseProxySse(
  text: string,
  flush = false
): { events: ProxySseEvent[]; partial: string } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawBlocks = normalized.split('\n\n');
  const partial = flush ? '' : (rawBlocks.pop() ?? '');
  const events: ProxySseEvent[] = [];

  for (const block of rawBlocks) {
    if (!block.trim()) continue;

    let id = 0;
    let eventType: string | undefined;
    let dataLine = '';

    for (const line of block.split('\n')) {
      if (line.startsWith('id: ')) {
        id = parseInt(line.slice(4), 10);
      } else if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        dataLine = line.slice(6);
      } else if (line === 'data') {
        dataLine = '';
      }
    }

    if (eventType === 'done' || eventType === 'error' || eventType === 'interrupted' || eventType === 'waiting' || eventType === 'cache-miss') {
      try {
        events.push({ id, eventType, meta: JSON.parse(dataLine) });
      } catch {
        events.push({ id, eventType });
      }
    } else if (dataLine) {
      try {
        const rawText = JSON.parse(dataLine) as string;
        events.push({ id, rawText });
      } catch {
        // Malformed data — skip
      }
    }
  }

  return { events, partial };
}
