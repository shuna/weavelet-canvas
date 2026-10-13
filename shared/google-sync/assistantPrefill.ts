import { isAssistantPrefillEnabled, shouldConsumeAssistantPrefill } from '../../src/utils/assistantPrefill';
import { resolveAssistantPrefillKey } from '../../src/utils/generationPlan';

type Input =
  | {operation: 'resolve'; mode: 'append' | 'midchat'; insertIndex: number | null; activePath?: string[]}
  | {operation: 'consume'; modelSource?: string; draft?: string; prefix?: string};

export function assistantPrefill(json: string): string {
  const input = JSON.parse(json) as Input;
  if (input.operation === 'resolve') {
    return JSON.stringify({key: resolveAssistantPrefillKey({branchTree: input.activePath ? {activePath: input.activePath} : undefined}, input.mode, input.insertIndex)});
  }
  if (input.operation === 'consume') {
    return JSON.stringify({consumed: shouldConsumeAssistantPrefill(isAssistantPrefillEnabled(input.modelSource), input.draft, input.prefix)});
  }
  throw new Error('Invalid assistant prefill operation.');
}
