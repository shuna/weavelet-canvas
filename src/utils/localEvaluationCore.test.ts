import { describe, expect, it } from 'vitest';
import { evaluation } from '../../shared/google-sync/evaluation';

const run = (input: object) => JSON.parse(evaluation(JSON.stringify(input)));

describe('shared local evaluation', () => {
  it('retains the actual Web analysis-first moderation selection including empty IDs', () => {
    const activeLocalModels = {analysis: 'analysis', moderation: 'moderation', future: 'opaque'};
    expect(run({operation: 'localModerationModel', state: {localModelEnabled: true, activeLocalModels}})).toBe('analysis');
    expect(run({operation: 'localModerationModel', state: {localModelEnabled: false, activeLocalModels}})).toBeNull();
    expect(run({operation: 'localModerationModel', state: {localModelEnabled: true, activeLocalModels: {moderation: 'moderation'}}})).toBe('moderation');
    expect(run({operation: 'localModerationModel', state: {localModelEnabled: true, activeLocalModels: {...activeLocalModels, analysis: ''}}})).toBe('');
    expect(run({operation: 'localModerationModel', state: {}})).toBeNull();
  });
  it('keeps axis order and truncates prompt inputs before generation', () => {
    expect(run({operation: 'localAxes'})).toEqual(['taskCompletion', 'faithfulness', 'coherence', 'conciseness', 'instructionFollowing']);
    const request = run({operation: 'localPrompt', axis: 'faithfulness', text: 'x'.repeat(450), assistantResponse: 'y'.repeat(450), language: 'ja-JP'});
    expect(request.prompt).toContain('この文章の内容は正確で事実に基づいていますか？');
    expect(request.prompt).toContain('x'.repeat(400));
    expect(request.prompt).not.toContain('x'.repeat(401));
    expect(request.prompt).toContain('y'.repeat(400));
    expect(request.fallback).toContain('x'.repeat(150));
    expect(request.fallback).not.toContain('x'.repeat(151));
    expect(request.options).toEqual({maxTokens: 400, temperature: 0.2});
    expect(request.fallbackOptions).toEqual({maxTokens: 200, temperature: 0.5});
  });

  it('scores each generated axis and retains empty fallback behavior', () => {
    expect(run({operation: 'localAxisScore', raw: 'good and excellent'})).toEqual({score: 0.75, reasoning: 'good and excellent'});
    expect(run({operation: 'localAxisScore', raw: '  '})).toEqual({score: 0.5});
    const result = run({operation: 'localQualityResult', outputs: {taskCompletion: 'good and excellent', faithfulness: ''}, now: 15});
    expect(result).toMatchObject({kind: 'standard', source: 'local', timestamp: 15, scores: {taskCompletion: 0.75, faithfulness: 0.5}, reasoning: {taskCompletion: 'good and excellent'}});
    expect(result.reasoning.faithfulness).toBeUndefined();
  });

  it('keeps JSON, line, and free-text parser tiers', () => {
    const json = run({operation: 'localParse', raw: '```json\n{"scores":{"taskCompletion":8},"reasoning":{"taskCompletion":"done"}}\n```', now: 21});
    expect(json).toMatchObject({scores: {taskCompletion: 0.8}, reasoning: {taskCompletion: 'done'}, timestamp: 21});
    const lines = run({operation: 'localParse', raw: 'Task Completion: 8/10 - addresses request\nFaithfulness: 7/10 - grounded response\nCoherence: 6/10 - readable answer', now: 22});
    expect(lines.scores).toMatchObject({taskCompletion: 0.8, faithfulness: 0.7, coherence: 0.6});
    const fallback = run({operation: 'localParse', raw: 'bad and unclear', now: 23});
    expect(fallback.scores.taskCompletion).toBe(0.3);
    expect(fallback.reasoning.taskCompletion).toBe('bad and unclear');
  });

  it('uses positive labels and thresholds without changing raw scores', () => {
    const labels = [{label: 'not_toxic', score: 0.99}, {label: 'hate', score: 0.8}];
    expect(run({operation: 'localModeration', labels, now: 30})).toEqual({screening: 'block-candidate', rawScores: labels, source: 'local', timestamp: 30});
    expect(run({operation: 'localModeration', labels: [{label: 'safe', score: 0.99}], now: 31}).screening).toBe('safe');
  });

  it('preserves local, hybrid, and remote fallback policy', () => {
    expect(run({operation: 'localPolicy', safetyEngine: 'local', hybridRemoteOnSafe: false})).toEqual({runLocal: true, runRemote: true});
    expect(run({operation: 'localPolicy', safetyEngine: 'local', hybridRemoteOnSafe: false, localSafety: {screening: 'safe'}})).toEqual({runLocal: true, runRemote: false});
    expect(run({operation: 'localPolicy', safetyEngine: 'hybrid', hybridRemoteOnSafe: false, localSafety: {screening: 'warn'}})).toEqual({runLocal: true, runRemote: true});
    expect(run({operation: 'localPolicy', safetyEngine: 'remote', hybridRemoteOnSafe: false})).toEqual({runLocal: false, runRemote: true});
  });
});
