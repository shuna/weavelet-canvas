import { isOpenRouterURL, observeOpenRouterHeaders, observeOpenRouterUsage } from '../../src/utils/openrouterRequest';
import type { OpenRouterObservation } from '../../src/types/chat';
import { extractReasoningFromEvent, extractNonStreamingOutput } from '../../src/utils/remoteResponse';
import { extractTextFromApiContent } from '../../src/utils/apiContent';
import { ThinkTagParser } from '../../src/utils/thinkTagParser';
import type { EventSourceDataInterface, NonStreamingResponse } from '../../src/types/api';

type OutputState = { text: string; reasoning: string; think: ReturnType<ThinkTagParser['checkpoint']>; finishReason?: string; observeUsage?: boolean; observation?: OpenRouterObservation };
export function remoteOutput(json: string): string {
  const input = JSON.parse(json) as { operation: 'consume' | 'flush' | 'headers'; headers?: Record<string, string>; endpointURL?: {protocol:string;hostname:string}; state?: OutputState;
    value?: EventSourceDataInterface & NonStreamingResponse & { error?: unknown }; streaming?: boolean };
  const parser = new ThinkTagParser();
  const state: OutputState = input.state ?? { text: '', reasoning: '', think: parser.checkpoint() };
  parser.restore(state.think);
  let finished = false;
  if (input.operation === 'headers') {
    state.observeUsage = !!input.endpointURL && isOpenRouterURL(input.endpointURL);
    if (state.observeUsage) state.observation = { ...state.observation, ...observeOpenRouterHeaders({ get: name => input.headers?.[name.toLowerCase()] ?? null }) };
  } else if (input.operation === 'flush') {
    const tail = parser.flush(); state.text += tail.content; state.reasoning += tail.reasoning; finished = true;
  } else if (input.operation === 'consume') {
    const value = input.value;
    if (!value || value.error != null) throw new Error('Remote API error.');
    if (state.observeUsage) state.observation = { ...state.observation, ...observeOpenRouterUsage(value.usage) };
    const choice = value.choices?.[0];
    const payload = input.streaming ? choice?.delta : choice?.message;
    if (payload) {
      // Keep native's explicit unsupported boundary; this adds no tool execution feature.
      if (Object.hasOwn(payload, 'tool_calls') || Object.hasOwn(payload, 'function_call')) throw new Error('Generated tool calls are not supported by this remote path.');
      if (input.streaming) {
        state.reasoning += extractReasoningFromEvent(value);
        const parsed = parser.process(extractTextFromApiContent(payload.content as never));
        state.text += parsed.content; state.reasoning += parsed.reasoning;
      } else {
        if (!payload.content) throw new Error('Failed to retrieve completion content.');
        const parsed = extractNonStreamingOutput(payload as NonStreamingResponse['choices'][number]['message'], parser);
        state.text += parsed.content; state.reasoning += parsed.reasoning; finished = true;
      }
      if (choice.finish_reason) { state.finishReason = choice.finish_reason; finished = true; }
    } else if (!input.streaming) throw new Error('Failed to retrieve completion content.');
  } else throw new Error('Unknown remote output operation.');
  state.think = parser.checkpoint();
  const parts = [
    ...(state.reasoning ? [{ type: 'reasoning', text: state.reasoning }] : []),
    ...(state.text ? [{ type: 'text', text: state.text }] : []),
  ];
  return JSON.stringify({ state, parts, finished, isEmpty: parts.length === 0 });
}
