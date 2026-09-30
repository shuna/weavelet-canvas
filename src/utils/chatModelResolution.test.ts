import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@store/store', () => ({ default: { getState: vi.fn() } }));
import useStore from '@store/store';
import { confirmChatModelFavorite, resolveChatModel } from './chatModelResolution';

describe('chat model resolution', () => {
  const setFavoriteModels = vi.fn();
  const state = {
    chats: [{ config: { model: 'anthropic/claude-sonnet-4' } }],
    favoriteModels: [],
    providerModelCache: {
      openrouter: [{ id: 'anthropic/claude-sonnet-4', name: 'Claude', providerId: 'openrouter', contextLength: 200000 }],
    },
    providerCustomModels: {},
    setFavoriteModels,
  };

  beforeEach(() => {
    state.chats[0].config.model = 'anthropic/claude-sonnet-4';
    state.favoriteModels = [];
    setFavoriteModels.mockClear();
    vi.mocked(useStore.getState).mockReturnValue(state as never);
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
  });

  it('distinguishes an absent model ID from an unmatched model', () => {
    state.chats[0].config.model = '';
    expect(resolveChatModel(0).status).toBe('unspecified');
    state.chats[0].config.model = 'unknown/model';
    expect(resolveChatModel(0).status).toBe('unmatched');
  });

  it('shows a provider model for this chat until the user approves favoriting it', () => {
    expect(resolveChatModel(0).status).toBe('available');
    expect(confirmChatModelFavorite(0)).toBe(true);
    expect(setFavoriteModels).toHaveBeenCalledWith([
      expect.objectContaining({ modelId: 'anthropic/claude-sonnet-4', providerId: 'openrouter', contextLength: 200000 }),
    ]);
  });

  it('leaves favorites unchanged when the user cancels', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    expect(confirmChatModelFavorite(0)).toBe(false);
    expect(setFavoriteModels).not.toHaveBeenCalled();
  });

  it('does not guess a provider when the same nonfavorite ID exists in several catalogs', () => {
    const duplicate = {
      ...state,
      providerModelCache: {
        ...state.providerModelCache,
        openai: [{ id: 'anthropic/claude-sonnet-4', name: 'Duplicate', providerId: 'openai' }],
      },
    };
    vi.mocked(useStore.getState).mockReturnValue(duplicate as never);
    expect(resolveChatModel(0).status).toBe('unmatched');
    expect(confirmChatModelFavorite(0)).toBe(false);
  });
});
