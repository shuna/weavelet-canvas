import { modelFileRemovalPaths, removeRegisteredLocalModel, toggleRegisteredLocalModelFavorite, type LocalModelRegistryState } from '../../src/utils/localModelRegistry';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import type { LocalModelTask } from '../../src/local-llm/types';

type State = LocalModelRegistryState<unknown, unknown> & {
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
};

type Input =
  | { operation: 'remove'; state: State; id: string }
  | { operation: 'favorite'; state: State; id: string }
  | { operation: 'fileRemovalPaths'; fileName: string };

export function localModelRegistry(json: string): string {
  const input = JSON.parse(json) as Input;
  if (input.operation === 'fileRemovalPaths') return JSON.stringify(modelFileRemovalPaths(input.fileName));
  const next = input.operation === 'remove'
    ? removeRegisteredLocalModel(input.state, input.id)
    : toggleRegisteredLocalModelFavorite(input.state, input.id);
  return JSON.stringify({ changes: diffJSONChanges(input.state, next) });
}
