import { describe, expect, it } from 'vitest';
import { evaluation } from '../../shared/google-sync/evaluation';

const run = (input: object) => JSON.parse(evaluation(JSON.stringify(input)));
const chat = {
  id: 'a', config: {systemPrompt: 'system text'},
  messages: [
    {role: 'user', content: [{type: 'text', text: 'first'}]},
    {role: 'assistant', content: [{type: 'text', text: 'answer'}]},
    {role: 'user', content: [{type: 'text', text: 'last'}]},
  ],
  branchTree: {activePath: ['n1', 'n2', 'n3']},
};

describe('shared evaluation', () => {
  it('uses the active path and omitted nodes for full context', () => {
    expect(run({operation: 'context', chat, omittedNodes: {n1: true}, messageIndex: 2, role: 'user', scope: 'full-context', omittedMode: 'respect-omitted'})).toEqual({userText: 'last', contextText: '[assistant]\nanswer\n\n[user]\nlast'});
  });

  it('builds a judge request without serializing a secret', () => {
    const request = run({operation: 'judgeRequest', userPrompt: 'hello', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'judge', hasApiKey: true, language: 'ja'});
    expect(request.chatUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(request.authentication).toBe('bearer');
    expect(request.headers).toEqual({'Content-Type': 'application/json'});
    expect(request.body.response_format).toEqual({type: 'json_object'});
    expect(request.body.messages[0].content).toContain('in ja');
  });

  it('uses native URL metadata for OpenRouter routing when JSC has no URL', () => {
    const originalURL = globalThis.URL;
    Object.defineProperty(globalThis, 'URL', {value: undefined, configurable: true});
    try {
      const request = run({operation: 'judgeRequest', userPrompt: 'hello', endpoint: 'https://openrouter.ai/api/v1', endpointURL: {protocol: 'https:', hostname: 'openrouter.ai'}, model: 'judge', openRouter: {routing: {only: ['provider-a']}}, viaProxy: true});
      expect(request.body.provider.only).toEqual(['provider-a']);
      expect(request.headers['X-OpenRouter-Cache']).toBe('false');
    } finally { Object.defineProperty(globalThis, 'URL', {value: originalURL, configurable: true}); }
  });

  it('rejects hard routing on a non-OpenRouter judge endpoint with or without native URL metadata', () => {
    const input = {operation: 'judgeRequest', userPrompt: 'hello', endpoint: 'https://api.openai.com/v1', model: 'judge', openRouter: {routing: {only: ['provider-a']}}};
    expect(() => run(input)).toThrow('[EVAL_OPENROUTER_AUXILIARY_ENDPOINT_REQUIRED]');
    expect(() => run({...input, endpointURL: {protocol: 'https:', hostname: 'api.openai.com'}})).toThrow('[EVAL_OPENROUTER_AUXILIARY_ENDPOINT_REQUIRED]');
  });

  it('builds safety transport and rejects hard routing constraints', () => {
    expect(run({operation: 'safetyRequest', endpoint: 'https://api.openai.com/v1/chat/completions', text: 'check'})).toEqual({endpoint: 'https://api.openai.com/v1/moderations', headers: {'Content-Type': 'application/json'}, body: {input: 'check'}});
    expect(() => run({operation: 'safetyRequest', endpoint: 'https://api.openai.com/v1', text: 'check', openRouter: {routing: {only: ['provider-a']}}})).toThrow('[EVAL_SAFETY_OPENROUTER_CONSTRAINTS]');
  });

  it('parses fenced judge JSON, caps axes, and keeps safety API fields', () => {
    const quality = run({operation: 'parseQuality', text: '```json\n{"scores":{"taskCompletion":2,"faithfulness":0.7},"promptSuggestions":["x"]}\n```', now: 10});
    expect(quality.scores.taskCompletion).toBe(0);
    expect(quality.scores.faithfulness).toBe(0.7);
    expect(quality.timestamp).toBe(10);
    const safety = run({operation: 'parseSafety', data: {results: [{flagged: true, category_scores: {hate: 0.9}, categories: {hate: true}}]}, now: 11});
    expect(safety).toEqual({flagged: true, categories: {hate: true}, categoryScores: {hate: 0.9}, timestamp: 11});
  });

  it('reports safety and quality threshold states for the native display', () => {
    const display = run({operation: 'display', result: {phase: 'post-receive', safety: {flagged: true, categories: {hate: true}, categoryScores: {hate: 0.91}}, quality: {kind: 'standard', scores: {taskCompletion: 0.9, faithfulness: 0.4, coherence: 0.6, conciseness: 0.8, instructionFollowing: 0.8}, reasoning: {faithfulness: 'unsupported'}, promptSuggestions: ['add source'], configSuggestions: []}}});
    expect(display.safety.status).toBe('block');
    expect(display.quality.axes.find((axis: {key: string}) => axis.key === 'faithfulness')).toMatchObject({status: 'red', reasoning: 'unsupported'});
    expect(display.quality.promptSuggestions).toEqual(['add source']);
  });

  it('updates one dimension and preserves unrelated results and unknown fields', () => {
    const state = {evaluationSettings: {safetyPreSend: 'manual'}, safetyThresholds: {}, qualityThresholds: {}, evaluationResults: {'a:n:pre-send': {phase: 'pre-send', xUnknown: 'keep', quality: {kind: 'standard'}}, 'a:n:post-receive': {phase: 'post-receive', xOther: 1}}, xRoot: 2};
    const output = run({operation: 'mutate', state, action: {type: 'set-result', key: 'a:n:pre-send', phase: 'pre-send', dimension: 'safety', result: {flagged: false, categories: {}, categoryScores: {}, timestamp: 1}, context: {scope: 'single', omittedMode: 'respect-omitted'}}});
    expect(output.changes.every((change: {path: string[]}) => change.path[0] === 'evaluationResults')).toBe(true);
    expect(JSON.stringify(output)).toContain('xUnknown');
    expect(JSON.stringify(output)).not.toContain('xOther');
  });
});
