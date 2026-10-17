import { parseEventSource } from '../../src/api/helper';
import { parseProxySse } from '../../src/utils/proxyProtocol';
import type { EventSourceDataInterface } from '../../src/types/api';
import type { OpenRouterObservation } from '../../src/types/chat';
import type { ChatInterface } from '../../src/types/chat';
import type { ContentStoreData } from '../../src/utils/contentStore';
import type { StreamRecord } from '../../src/utils/streamDb';
import { resolveRecoveryTarget } from '../../src/utils/streamRecovery';
import { proxyRecoveryRetry as recoveryRetry } from '../../src/utils/proxyRecoveryPolicy';

type State = { proxyPartial: string; llmPartial: string; lastEventId: number; llmDone: boolean };
type Input = { text: string; flush?: boolean; state?: State };
type Output = { state: State; events: EventSourceDataInterface[];
  terminal?: 'complete' | 'partial' | 'error'; retry?: boolean; observation?: OpenRouterObservation; error?: string };

export function proxyStream(json: string): string {
  const input = JSON.parse(json) as Input;
  const state: State = { proxyPartial: input.state?.proxyPartial ?? '', llmPartial: input.state?.llmPartial ?? '',
    lastEventId: input.state?.lastEventId ?? 0, llmDone: input.state?.llmDone ?? false };
  const parsed = parseProxySse(state.proxyPartial + input.text, input.flush ?? false);
  state.proxyPartial = parsed.partial;
  const output: Output = { state, events: [] };
  for (const event of parsed.events) {
    if (event.id > 0 && event.id <= state.lastEventId) continue;
    if (event.id > state.lastEventId) state.lastEventId = event.id;
    if (event.eventType === 'waiting') continue;
    if (event.eventType === 'done' || event.eventType === 'error') {
      if (event.meta?.openRouterObservation) output.observation = event.meta.openRouterObservation;
      if (event.eventType === 'error') {
        output.terminal = 'error';
        output.retry = false;
        if (event.meta?.error) output.error = event.meta.error;
      } else {
        output.terminal = event.meta?.complete === true && event.meta.cacheCapability !== 'overflow' && state.llmDone ? 'complete' : 'partial';
        output.retry = false;
      }
      break;
    }
    if (event.eventType === 'interrupted' || event.eventType === 'cache-miss') {
      output.terminal = 'partial';
      output.retry = event.eventType === 'cache-miss';
      break;
    }
    if ('rawText' in event) {
      if (typeof event.rawText !== 'string') throw new Error('Invalid proxy rawText.');
      const inner = parseEventSource(state.llmPartial + event.rawText);
      state.llmPartial = inner.partial;
      state.llmDone ||= inner.done;
      output.events.push(...inner.events);
    }
  }
  if (output.terminal === 'complete' && state.llmPartial) {
    const inner = parseEventSource(state.llmPartial, true);
    state.llmPartial = inner.partial;
    output.events.push(...inner.events);
  }
  return JSON.stringify(output);
}

export function proxyRecoveryRetry(json: string): string {
  return JSON.stringify(recoveryRetry(JSON.parse(json)));
}

export function proxyRecoveryTarget(json: string): string {
  const input = JSON.parse(json) as { chat: ChatInterface; contentStore: ContentStoreData; record: StreamRecord; expectedHash?: string };
  const target = resolveRecoveryTarget([input.chat], input.contentStore, input.record, input.expectedHash);
  return JSON.stringify(target
    ? { status: 'ready', messageIndex: target.messageIndex, nodeID: input.record.nodeId }
    : { status: 'stale' });
}
