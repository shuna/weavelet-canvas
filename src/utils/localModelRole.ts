import type { LocalModelTask } from '@src/local-llm/types';

export type LocalModelRoleState = {
  localModelEnabled: boolean;
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
};

export type LocalModelRoleAction =
  | {operation: 'enable'; enabled: boolean}
  | {operation: 'assign'; task: LocalModelTask; modelId: string | null};

export function mutateLocalModelRole<T extends LocalModelRoleState>(state: T, action: LocalModelRoleAction): T {
  if (action.operation === 'enable') return {...state, localModelEnabled: action.enabled};
  const activeLocalModels = {...state.activeLocalModels};
  if (action.modelId === null) delete activeLocalModels[action.task];
  else activeLocalModels[action.task] = action.modelId;
  return {...state, activeLocalModels};
}
