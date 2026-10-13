import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  state: {} as any,
  prepare: vi.fn(), release: vi.fn(), unregister: vi.fn(),
  ensureLoaded: vi.fn(), generate: vi.fn(), classify: vi.fn(),
  getWllamaEngine: vi.fn(), getTransformersEngine: vi.fn(),
  safety: vi.fn(), quality: vi.fn(),
}));
vi.mock('@store/store', () => ({ default: { getState: () => fixture.state } }));
vi.mock('@src/local-llm/runtime', () => ({
  promptAsInput: (prompt: string) => ({ messages: [{ role: 'user', content: prompt }] }),
  localModelRuntime: {
    ensureLoaded: fixture.ensureLoaded,
    getWllamaEngine: fixture.getWllamaEngine,
    getTransformersEngine: fixture.getTransformersEngine,
    registerOwnerCancellation: () => fixture.unregister,
  },
}));
vi.mock('@src/local-llm/orchestrator', () => ({
  createLocalModelOwner: (scope: string) => scope,
  prepareModelsForExecution: fixture.prepare,
  releaseModelsForExecution: fixture.release,
}));
vi.mock('@api/evaluation', () => ({ runSafetyCheck: fixture.safety, runQualityEvaluation: fixture.quality }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('i18next', () => ({ default: { language: 'en' } }));

import { runPostReceiveEvaluation, runPreSendEvaluation, useEvaluation } from './useEvaluation';
import { beginAiTask, finishAiTask, invalidateAiTasks } from './aiTaskLifetime';
import { runLocalModeration, runLocalQualityEvaluation } from '@api/localEvaluation';
import { evaluationResultKey } from '@type/evaluation';

const userContent = [{ type: 'text' as const, text: 'question' }];
const assistantContent = [{ type: 'text' as const, text: 'answer' }];
const context = { chatId: 'chat', nodeId: 'assistant', endpoint: 'https://example.test', model: 'remote' };
const key = evaluationResultKey('chat', 'assistant', 'pre-send');
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  invalidateAiTasks();
  vi.clearAllMocks();
  fixture.state = {
    localModelEnabled: true,
    activeLocalModels: { analysis: 'analysis-a', moderation: 'moderation-a', quality: 'quality-a', generation: 'generation-a' },
    evaluationSettings: { safetyEngine: 'local', hybridRemoteOnSafe: true,
      safetyPreSend: 'manual', safetyPostReceive: 'manual', qualityPreSend: 'auto', qualityPostReceive: 'manual' },
    chats: [{ id: 'chat', config: { model: 'generation-a' }, branchTree: { nodes: {
      user: { id: 'user', parentId: null, role: 'user', contentHash: 'question-hash' },
      assistant: { id: 'assistant', parentId: 'user', role: 'assistant', contentHash: 'answer-hash' },
    } } }],
    evaluationResults: {},
    setEvaluationPending: vi.fn(), setEvaluationAxisProgress: vi.fn(), clearEvaluationAxisProgress: vi.fn(),
    setEvaluationResult: vi.fn((resultKey, result) => { fixture.state.evaluationResults[resultKey] = result; }),
  };
  fixture.prepare.mockResolvedValue(undefined);
  fixture.ensureLoaded.mockResolvedValue(undefined);
  fixture.generate.mockResolvedValue('good clear accurate');
  fixture.classify.mockResolvedValue([{ label: 'safe', score: 0.9 }]);
  fixture.getWllamaEngine.mockReturnValue({ generate: fixture.generate });
  fixture.getTransformersEngine.mockReturnValue({ classify: fixture.classify });
  fixture.safety.mockResolvedValue({ flagged: false });
  fixture.quality.mockResolvedValue({ kind: 'standard', source: 'remote' });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('asynchronous evaluation execution', () => {
  it('routes only text parts through the shared automatic plan', async () => {
    fixture.state.localModelEnabled = false;
    fixture.state.evaluationSettings.safetyEngine = 'remote';
    fixture.state.evaluationSettings.safetyPreSend = 'auto';
    fixture.state.evaluationSettings.qualityPreSend = 'manual';
    await runPreSendEvaluation([
      {type:'text',text:'first'}, {type:'reasoning',text:'hidden'}, {type:'text',text:'second'},
    ], context);
    expect(fixture.safety).toHaveBeenCalledWith('first\nsecond', undefined, expect.any(AbortSignal));
    expect(fixture.quality).not.toHaveBeenCalled();
    await runPreSendEvaluation([{type:'reasoning',text:'hidden'}], context);
    expect(fixture.state.setEvaluationPending).toHaveBeenCalledTimes(2);
  });

  it('uses the initially selected model after preparation awaits an assignment change', async () => {
    const preparation = deferred<void>();
    fixture.prepare.mockReturnValueOnce(preparation.promise);
    const pending = runPreSendEvaluation(userContent, context);
    fixture.state.activeLocalModels.analysis = 'analysis-b';
    preparation.resolve();
    await pending;
    expect(fixture.prepare.mock.calls[0][1]).toEqual(['analysis-a']);
    expect(fixture.ensureLoaded).toHaveBeenCalledWith('analysis-a', expect.any(String));
    expect(fixture.getWllamaEngine).toHaveBeenCalledWith('analysis-a');
    expect(fixture.generate).toHaveBeenCalledTimes(5);
    expect(fixture.state.setEvaluationResult).toHaveBeenCalledWith(key, expect.objectContaining({ quality: expect.any(Object) }));
    expect(fixture.unregister).toHaveBeenCalledTimes(1);
    expect(fixture.release).toHaveBeenCalledTimes(1);
  });

  it('fixes the manual quality model through preparation too', async () => {
    const preparation = deferred<void>();
    fixture.prepare.mockReturnValueOnce(preparation.promise);
    const pending = useEvaluation().triggerManualQuality('question', undefined, 'chat', 'assistant', 'pre-send', { endpoint: 'url' } as any, 'remote');
    fixture.state.activeLocalModels.analysis = 'analysis-b';
    preparation.resolve();
    await pending;
    expect(fixture.getWllamaEngine).toHaveBeenCalledWith('analysis-a');
    expect(fixture.state.setEvaluationResult).toHaveBeenCalledTimes(1);
  });

  it('fixes the moderation fallback assignment before preparation awaits', async () => {
    delete fixture.state.activeLocalModels.analysis;
    fixture.state.evaluationSettings.qualityPreSend = 'manual';
    fixture.state.evaluationSettings.safetyPreSend = 'auto';
    const preparation = deferred<void>();
    fixture.prepare.mockReturnValueOnce(preparation.promise);
    const pending = runPreSendEvaluation(userContent, context);
    fixture.state.activeLocalModels.moderation = 'moderation-b';
    preparation.resolve();
    await pending;
    expect(fixture.prepare.mock.calls[0][1]).toEqual(['moderation-a']);
    expect(fixture.getTransformersEngine).toHaveBeenCalledWith('moderation-a');
  });

  it('does not start remote fallback after local classification is cancelled', async () => {
    fixture.state.evaluationSettings.qualityPreSend = 'manual';
    fixture.state.evaluationSettings.safetyPreSend = 'auto';
    const started = deferred<void>();
    fixture.classify.mockImplementationOnce((_text, _reason, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      started.resolve();
    }));
    const pending = runPreSendEvaluation(userContent, context);
    await started.promise;
    invalidateAiTasks(['chat']);
    await pending;
    expect(fixture.safety).not.toHaveBeenCalled();
    expect(fixture.state.setEvaluationResult).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledTimes(1);
    expect(fixture.unregister).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('validates delayed pre-evaluation after generation completes (input edited: %s)', async (edited) => {
    fixture.state.localModelEnabled = false;
    const response = deferred<any>();
    fixture.quality.mockReturnValueOnce(response.promise);
    const parent = beginAiTask({ requestId: 'generation', kind: 'generation', chatId: 'chat', nodeId: 'assistant', dependencyIds: ['user'] });
    const pending = runPreSendEvaluation(userContent, { ...context, parentTicket: parent });
    fixture.state.chats[0].branchTree.nodes.assistant.contentHash = 'generated-response';
    finishAiTask(parent);
    if (edited) fixture.state.chats[0].branchTree.nodes.user.contentHash = 'edited-input';
    response.resolve({ kind: 'standard', source: 'remote' });
    await pending;
    expect(fixture.state.setEvaluationResult).toHaveBeenCalledTimes(edited ? 0 : 1);
  });

  it.each(['user', 'assistant'])('rejects delayed post-evaluation after the %s input is edited', async (nodeId) => {
    fixture.state.localModelEnabled = false;
    fixture.state.evaluationSettings.qualityPostReceive = 'auto';
    const response = deferred<any>();
    fixture.quality.mockReturnValueOnce(response.promise);
    const pending = runPostReceiveEvaluation(userContent, assistantContent, context);
    fixture.state.chats[0].branchTree.nodes[nodeId].contentHash = 'edited';
    response.resolve({ kind: 'standard', source: 'remote' });
    await pending;
    expect(fixture.state.setEvaluationResult).not.toHaveBeenCalled();
    expect(fixture.state.setEvaluationPending).toHaveBeenLastCalledWith(evaluationResultKey('chat', 'assistant', 'post-receive'), false);
  });

  it('does not retry an empty local quality response after cancellation', async () => {
    const controller = new AbortController();
    fixture.generate.mockImplementationOnce(() => { controller.abort(); return Promise.resolve(''); });
    await expect(runLocalQualityEvaluation('question', undefined, undefined, 'owner', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    expect(fixture.generate.mock.calls[0][4]).toBe(controller.signal);
  });

  it('retains the empty-response fallback while the request remains active', async () => {
    const signal = new AbortController().signal;
    fixture.generate.mockResolvedValueOnce('');
    const result = await runLocalQualityEvaluation('question', undefined, undefined, 'owner', signal);
    expect(result.source).toBe('local');
    expect(fixture.generate).toHaveBeenCalledTimes(6);
    expect(fixture.generate.mock.calls.every(call => call[4] === signal)).toBe(true);
  });

  it('does not load models when the evaluation was already cancelled', async () => {
    const signal = AbortSignal.abort();
    await expect(runLocalModeration('text', 'owner', signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runLocalQualityEvaluation('text', undefined, undefined, 'owner', signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.ensureLoaded).not.toHaveBeenCalled();
  });

  it('preserves direct-call model fallback priority', async () => {
    await runLocalModeration('text');
    expect(fixture.getTransformersEngine).toHaveBeenLastCalledWith('analysis-a');
    delete fixture.state.activeLocalModels.analysis;
    await runLocalModeration('text');
    expect(fixture.getTransformersEngine).toHaveBeenLastCalledWith('moderation-a');
    await runLocalQualityEvaluation('text', undefined);
    expect(fixture.getWllamaEngine).toHaveBeenLastCalledWith('quality-a');
    delete fixture.state.activeLocalModels.quality;
    await runLocalQualityEvaluation('text', undefined);
    expect(fixture.getWllamaEngine).toHaveBeenLastCalledWith('generation-a');
  });
});
