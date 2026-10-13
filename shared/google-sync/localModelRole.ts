import { mutateLocalModelRole, type LocalModelRoleAction, type LocalModelRoleState } from '../../src/utils/localModelRole';
import { diffJSONChanges } from '../../src/utils/jsonChanges';

export function localModelRole(json: string): string {
  const input = JSON.parse(json) as LocalModelRoleAction & {state: LocalModelRoleState};
  const before = {
    localModelEnabled: input.state.localModelEnabled,
    activeLocalModels: input.state.activeLocalModels,
  };
  return JSON.stringify({changes: diffJSONChanges(before, mutateLocalModelRole(before, input))});
}
