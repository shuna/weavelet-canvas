import { describe, expect, it } from 'vitest';
import { localModelRegistry } from '../../shared/google-sync/localModelRegistry';
import { removeRegisteredLocalModel, toggleRegisteredLocalModelFavorite } from './localModelRegistry';

describe('local model registry', () => {
  it('removes a registered model from every registry root while preserving unrelated values', () => {
    const keep = { id: 'keep', opaque: { retained: true } };
    const state = {
      localModels: [{ id: 'remove', unknown: 'discard' }, keep],
      activeLocalModels: { generation: 'remove', analysis: 'keep' },
      favoriteLocalModelIds: ['first', 'remove', 'remove', 'keep'],
      savedModelMeta: { remove: { partial: true }, keep: { opaque: ['retained'] } },
    };

    expect(removeRegisteredLocalModel(state, 'remove')).toEqual({
      localModels: [keep],
      activeLocalModels: { analysis: 'keep' },
      favoriteLocalModelIds: ['first', 'keep'],
      savedModelMeta: { keep: { opaque: ['retained'] } },
    });
  });

  it('toggles favorites with the existing order semantics', () => {
    const state = {
      localModels: [], activeLocalModels: {}, favoriteLocalModelIds: ['first', 'second'], savedModelMeta: {},
    };

    expect(toggleRegisteredLocalModelFavorite(state, 'third').favoriteLocalModelIds).toEqual(['first', 'second', 'third']);
    expect(toggleRegisteredLocalModelFavorite(state, 'second').favoriteLocalModelIds).toEqual(['first']);
  });

  it('preserves opaque native model fields while removing by the projected ID', () => {
    const state = {
      localModels: [{ id: 'remove', payload: { opaqueRef: 8 } }, { id: 'keep', payload: { opaqueRef: 9 } }],
      activeLocalModels: { generation: 'remove', analysis: 'keep' },
      favoriteLocalModelIds: ['remove', 'keep'],
      savedModelMeta: { remove: { partial: true }, keep: { opaque: true } },
    };
    const output = JSON.parse(localModelRegistry(JSON.stringify({
      operation: 'remove', state, id: 'remove',
    })));

    expect(output.changes).toEqual(expect.arrayContaining([
      { op: 'set', path: ['localModels', 0, 'id'], value: 'keep' },
      { op: 'set', path: ['localModels', 0, 'payload'], value: { opaqueRef: 9 } },
      { op: 'remove', path: ['localModels', 1] },
      { op: 'remove', path: ['activeLocalModels', 'generation'] },
      { op: 'set', path: ['favoriteLocalModelIds', 0], value: 'keep' },
      { op: 'remove', path: ['favoriteLocalModelIds', 1] },
      { op: 'remove', path: ['savedModelMeta', 'remove'] },
    ]));
    expect(JSON.stringify(output.changes)).toContain('"keep"');

    const favorite = JSON.parse(localModelRegistry(JSON.stringify({
      operation: 'favorite', state, id: 'keep',
    })));
    expect(favorite.changes).toEqual([
      { op: 'remove', path: ['favoriteLocalModelIds', 1] },
    ]);
  });
});
