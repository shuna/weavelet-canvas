import { isMessageVisible } from '../../src/utils/advancedDisplay';

export function messageDisplayIndexes(json: string): string {
  const input: { advancedMode: boolean; roles: string[] } = JSON.parse(json);
  return JSON.stringify(input.roles.flatMap((role, index) => isMessageVisible(input.advancedMode, index, role) ? [index] : []));
}
