import { SYSTEM_PROMPT_PRESETS } from '../../src/constants/systemPromptPresets';
import { appendCommandLibraryPrompt, appendSystemLibraryPrompt, searchPromptLibrary, systemPresetNeedsConfirmation } from '../../src/utils/promptApplication';
import { replaceTextValue, textValueOf } from '../../src/utils/messageText';
import { hasMeaningfulContent } from '../../src/utils/contentValidation';
import type { ContentInterface } from '../../src/types/chat';

type Input = { operation: 'search' | 'command' | 'system' | 'presets' | 'preset'; id?: string; prompts?: { name: string; index: number }[];
  query?: string; parts?: ContentInterface[]; editedText?: string; previous?: string; text?: string };
export function promptApplicationOperation(json: string): string {
  const input = JSON.parse(json) as Input;
  switch (input.operation) {
    case 'presets': return JSON.stringify(SYSTEM_PROMPT_PRESETS.map(({ content, ...metadata }) => metadata));
    case 'preset': {
      const preset = SYSTEM_PROMPT_PRESETS.find(preset => preset.id === input.id);
      if (!preset) throw new Error('Unknown system prompt preset.');
      return JSON.stringify({ content: preset.content, needsConfirmation: systemPresetNeedsConfirmation(input.previous!, preset.content) });
    }
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
