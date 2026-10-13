import { appendCommandLibraryPrompt, appendSystemLibraryPrompt, searchPromptLibrary } from '../../src/utils/promptApplication';
import { replaceTextValue, textValueOf } from '../../src/utils/messageText';
import { hasMeaningfulContent } from '../../src/utils/contentValidation';
import type { ContentInterface } from '../../src/types/chat';

type Input = { operation: 'search' | 'command' | 'system'; prompts?: { name: string; index: number }[];
  query?: string; parts?: ContentInterface[]; editedText?: string; previous?: string; text?: string };
export function promptApplicationOperation(json: string): string {
  const input = JSON.parse(json) as Input;
  switch (input.operation) {
    case 'search': return JSON.stringify(searchPromptLibrary(input.prompts!, input.query!));
    case 'system': return JSON.stringify(appendSystemLibraryPrompt(input.previous!, input.text!));
    case 'command': {
      const current = input.editedText === undefined ? input.parts! : replaceTextValue(input.parts!, input.editedText);
      const parts = appendCommandLibraryPrompt(current, input.text!);
      return JSON.stringify({ parts, text: textValueOf(parts), hasMeaningfulContent: hasMeaningfulContent(parts) });
    }
    default: throw new Error('Unknown prompt application operation.');
  }
}
