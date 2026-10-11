import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {} as any,
  prepare: vi.fn(), save: vi.fn(), report: vi.fn(), invalidate: vi.fn(),
  set: vi.fn(),
}));
vi.mock('@store/store', () => ({ default: {
  getState: () => mocks.state,
  setState: (patch: unknown) => { mocks.set(patch); mocks.state = { ...mocks.state, ...patch as object }; },
} }));
vi.mock('@hooks/aiTaskLifetime', () => ({ invalidateAiTasks: mocks.invalidate }));
vi.mock('@store/persistence', () => ({
  prepareHydratedState: mocks.prepare,
  createPersistedChatDataState: (state: unknown) => state,
  reportHydratedStateCommitted: mocks.report,
}));
vi.mock('./IndexedDbStorage', () => ({ saveChatData: mocks.save }));
import { applyExternalSnapshot } from './applyExternalSnapshot';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { chats: ['old'], branchHistoryPast: ['old undo'] };
  mocks.invalidate.mockImplementation(() => {});
  mocks.prepare.mockImplementation(async () => ({ state: { chats: ['new'], currentChatIndex: 0 }, repairedChatTitles: [] }));
  mocks.save.mockResolvedValue(undefined);
});

describe('external snapshot commit', () => {
  it('rejects edits during download before cancelling tasks', async () => {
    const observed = mocks.state;
    mocks.state = { ...observed, chats: ['edited'] };
    expect(await applyExternalSnapshot({}, () => true, observed)).toBe(false);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects a payload superseded by cancellation finalizing partial content', async () => {
    mocks.invalidate.mockImplementation(() => { mocks.state = { ...mocks.state, chats: ['partial'] }; });
    expect(await applyExternalSnapshot({}, () => true)).toBe(false);
    expect(mocks.state.chats).toEqual(['partial']);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('commits once and clears obsolete editing history', async () => {
    expect(await applyExternalSnapshot({}, () => true)).toBe(true);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.state.branchHistoryPast).toEqual([]);
    expect(mocks.save).toHaveBeenCalledWith(mocks.state);
  });
  it.each(['edit', 'disconnect'])('rejects %s during preparation', async (kind) => {
    let connected = true;
    mocks.prepare.mockImplementation(async () => {
      if (kind === 'edit') mocks.state = { ...mocks.state, chats: ['edited'] };
      else connected = false;
      return { state: { chats: ['new'] } };
    });
    expect(await applyExternalSnapshot({}, () => connected)).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('retains applied memory and reports storage failure without success side effects', async () => {
    mocks.save.mockRejectedValue(new Error('quota'));
    await expect(applyExternalSnapshot({}, () => true)).rejects.toThrow('quota');
    expect(mocks.state.chats).toEqual(['new']);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('does not restore an old selection after an edit during storage write', async () => {
    mocks.save.mockImplementation(async () => { mocks.state = { ...mocks.state, currentChatIndex: 4 }; });
    expect(await applyExternalSnapshot({}, () => true)).toBe(true);
    expect(mocks.state.currentChatIndex).toBe(4);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
