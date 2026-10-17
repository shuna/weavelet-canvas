import { describe, expect, it } from 'vitest';
import { proxyStream } from '../../shared/google-sync/proxy';

const outer = (id: number, raw: string) => `id: ${id}\ndata: ${JSON.stringify(raw)}\n\n`;
const control = (kind: string, meta: object) => `event: ${kind}\ndata: ${JSON.stringify(meta)}\n\n`;
const run = (text: string, state?: object) => JSON.parse(proxyStream(JSON.stringify({ text, state })));

describe('shared proxy stream boundary', () => {
  it('keeps split outer and inner SSE together with its cursor and skips replayed IDs', () => {
    const llm = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
    const first = run(outer(1, llm.slice(0, 14)).slice(0, -5));
    expect(first.events).toEqual([]);
    expect(first.state.lastEventId).toBe(0);
    const second = run(outer(1, llm.slice(0, 14)).slice(-5), first.state);
    expect(second.events).toEqual([]);
    expect(second.state).toMatchObject({ lastEventId: 1, llmPartial: llm.slice(0, 14) });
    const third = run(outer(1, 'ignored') + outer(2, llm.slice(14)), second.state);
    expect(third.events).toEqual([{ choices: [{ delta: { content: 'hello' } }] }]);
    expect(third.state).toMatchObject({ lastEventId: 2, llmPartial: '' });
  });

  it('requires both inner DONE and complete non-overflow proxy terminal', () => {
    const pending = run(outer(1, 'data: {"choices":[] }\n\n'));
    expect(run(control('done', { complete: true }), pending.state).terminal).toBe('partial');
    const innerDone = run(outer(2, 'data: [DONE]\n\n'), pending.state);
    expect(innerDone.state.llmDone).toBe(true);
    expect(run(control('done', { complete: false }), innerDone.state).terminal).toBe('partial');
    expect(run(control('done', { complete: true, cacheCapability: 'overflow' }), innerDone.state).terminal).toBe('partial');
    expect(run(control('done', { complete: true }), innerDone.state).terminal).toBe('complete');
    expect(run(control('cache-miss', { complete: false }), innerDone.state).terminal).toBe('partial');
    expect(run(control('cache-miss', { complete: false }), innerDone.state).retry).toBe(true);
    expect(run(control('interrupted', { complete: false }), innerDone.state).retry).toBe(false);
  });

  it('returns terminal metadata without LLM data and rejects non-string raw chunks', () => {
    const state = { proxyPartial: '', llmPartial: '', lastEventId: 4, llmDone: true };
    const observation = { totalCost: 1 };
    const result = run(control('waiting', {}) + control('done', { complete: true, openRouterObservation: observation }), state);
    expect(result.events).toEqual([]);
    expect(result.terminal).toBe('complete');
    expect(result.observation).toEqual(observation);
    expect(run(control('error', { error: 'upstream' })).error).toBe('upstream');
    expect(run(control('error', { error: 'upstream' })).retry).toBe(false);
    expect(() => run('id: 5\ndata: 42\n\n', state)).toThrow('Invalid proxy rawText.');
  });
});
