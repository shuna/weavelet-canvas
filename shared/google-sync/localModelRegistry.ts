import { removeRegisteredLocalModel, toggleRegisteredLocalModelFavorite, type LocalModelRegistryState } from '../../src/utils/localModelRegistry';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import type { LocalModelTask } from '../../src/local-llm/types';

type State = LocalModelRegistryState<unknown, unknown> & {
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
};

type Input =
  | { operation: 'remove'; state: State; id: string }
  | { operation: 'favorite'; state: State; id: string };

export function localModelRegistry(json: string): string {
  const input = JSON.parse(json) as Input;
  const next = input.operation === 'remove'
    ? removeRegisteredLocalModel(input.state, input.id)
    : toggleRegisteredLocalModelFavorite(input.state, input.id);
  return JSON.stringify({ changes: diffJSONChanges(input.state, next) });
}
