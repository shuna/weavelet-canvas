import type {Prompt} from '../../src/types/prompt';
import {applyPromptLibraryAction, parsePromptLibraryCSV, promptLibraryDefaults, promptsToCSV, type PromptLibraryAction} from '../../src/utils/promptLibrary';

export function promptLibraryOperation(json: string): string {
  const input = JSON.parse(json) as {operation: 'defaults' | 'apply' | 'parseCSV' | 'exportCSV'; prompts?: Prompt[]; action?: PromptLibraryAction; csv?: string};
  switch (input.operation) {
    case 'defaults': return JSON.stringify(promptLibraryDefaults());
    case 'apply': return JSON.stringify(applyPromptLibraryAction(input.prompts!, input.action!));
    case 'parseCSV': return JSON.stringify(parsePromptLibraryCSV(input.csv!));
    case 'exportCSV': return JSON.stringify({csv: promptsToCSV(input.prompts!)});
  }
}
