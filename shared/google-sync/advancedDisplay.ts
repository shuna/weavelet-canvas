import { isMessageVisible } from '../../src/utils/advancedDisplay';
import { clampSplitPanelRatio } from '../../src/utils/splitPanel';

export function splitPanelRatio(json: string): string {
  const input: { ratio: number } = JSON.parse(json);
  return JSON.stringify(clampSplitPanelRatio(input.ratio));
}

export function messageDisplayIndexes(json: string): string {
  const input: { advancedMode: boolean; roles: string[] } = JSON.parse(json);
  return JSON.stringify(input.roles.flatMap((role, index) => isMessageVisible(input.advancedMode, index, role) ? [index] : []));
}
