import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ state: {} as any }));
vi.mock('@store/store', () => ({ default: { getState: () => fixture.state } }));
import { beginAiTask, cancelAiTask, evaluationDependencyIds, finishAiTask, invalidateAiTasks, isAiTaskCurrent, ownsAiTask } from './aiTaskLifetime';

beforeEach(() => {
  invalidateAiTasks();
  fixture.state = { chats: [{ id: 'chat', title: 'original', titleSet: false, config: { model: 'local' }, branchTree: { nodes: {
    user: { id: 'user', role: 'user', parentId: null, contentHash: 'input' },
    assistant: { id: 'assistant', role: 'assistant', parentId: 'user', contentHash: 'output' },
  } } }] };
});
const generation = () => beginAiTask({ requestId: 'generate', chatId: 'chat', nodeId: 'assistant', kind: 'generation', dependencyIds: ['user'] });

describe('AI task lifetime', () => {
  it('rejects an input edited while preparation waits and does not recapture its newer fingerprint', async () => {
    const ticket = generation();
    await Promise.resolve();
    fixture.state.chats[0].branchTree.nodes.user.contentHash = 'edited';
    expect(isAiTaskCurrent(ticket)).toBe(false);
    expect(ownsAiTask(ticket)).toBe(true);
  });
  it('keeps pre-evaluation alive across assistant streaming and parent completion, but validates both post inputs', () => {
    const parent = generation();
    const pre = beginAiTask({ requestId: 'pre', chatId: 'chat', nodeId: 'assistant', kind: 'evaluation-pre', parent, dependencyIds: evaluationDependencyIds('chat', 'assistant', 'pre-send') });
    fixture.state.chats[0].branchTree.nodes.assistant.contentHash = 'streamed';
    finishAiTask(parent);
    expect(isAiTaskCurrent(pre)).toBe(true);
    const post = beginAiTask({ requestId: 'post', chatId: 'chat', nodeId: 'assistant', kind: 'evaluation-post', dependencyIds: evaluationDependencyIds('chat', 'assistant', 'post-receive') });
    fixture.state.chats[0].branchTree.nodes.assistant.contentHash = 'edited-output';
    expect(isAiTaskCurrent(post)).toBe(false);
    fixture.state.chats[0].branchTree.nodes.user.contentHash = 'edited-input';
    expect(isAiTaskCurrent(pre)).toBe(false);
  });
  it('keeps identity after reorder, rejects deletion despite a clone with the same node IDs, and invalidates same-ID replacement', () => {
    const ticket = generation();
    const clone = { ...structuredClone(fixture.state.chats[0]), id: 'clone' };
    fixture.state.chats.unshift(clone);
    expect(isAiTaskCurrent(ticket)).toBe(true);
    fixture.state.chats.pop();
    expect(isAiTaskCurrent(ticket)).toBe(false);
    fixture.state.chats.push({ ...clone, id: 'chat' });
    invalidateAiTasks();
    expect(isAiTaskCurrent(ticket)).toBe(false);
  });
  it('does not let a superseded request clear a newer request, and cancellation runs each callback once', () => {
    const cancel = vi.fn();
    const first = beginAiTask({ requestId: 'first', chatId: 'chat', nodeId: 'assistant', kind: 'generation', dependencyIds: ['user'], cancel });
    const second = generation();
    expect(cancel).toHaveBeenCalledTimes(1);
    finishAiTask(first);
    expect(isAiTaskCurrent(second)).toBe(true);
    cancelAiTask(first);
    expect(cancel).toHaveBeenCalledTimes(1);
    invalidateAiTasks(['chat'], ['user']);
    expect(isAiTaskCurrent(second)).toBe(false);
  });
  it('does not replace a title edited during automatic title generation', () => {
    const ticket = beginAiTask({ requestId: 'title', chatId: 'chat', kind: 'title', dependencyIds: [] });
    fixture.state.chats[0].title = 'manual';
    expect(isAiTaskCurrent(ticket)).toBe(false);
  });
});
