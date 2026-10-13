import defaultPrompts from '@constants/prompt';
import type {Prompt} from '@type/prompt';
import {importPromptCSV, promptsToCSV} from './prompt';

export type PromptLibraryAction =
  | {type: 'add'; id: string}
  | {type: 'edit'; index: number; field: 'name' | 'prompt'; value: string}
  | {type: 'edit'; index: number; field: 'label'; value: 'system' | 'user' | null}
  | {type: 'remove'; index: number}
  | {type: 'clear'}
  | {type: 'import'; mode: 'append' | 'replace'; rows: Array<Pick<Prompt, 'name' | 'prompt'>>; newIDs: string[]};

export const promptLibraryDefaults = (): Prompt[] => defaultPrompts.map(prompt => ({...prompt}));

export function parsePromptLibraryCSV(csv: string): Array<Pick<Prompt, 'name' | 'prompt'>> {
  return importPromptCSV(csv).map(data => {
    const columns = Object.values(data);
    return {name: columns[0], prompt: columns[1]};
  });
}

export function applyPromptLibraryAction(prompts: Prompt[], action: PromptLibraryAction): Prompt[] {
  switch (action.type) {
    case 'add': return [...prompts, {id: action.id, name: '', prompt: ''}];
    case 'edit': return prompts.map((item, index) => {
      if (index !== action.index) return item;
      if (action.field === 'label' && action.value === null) {
        const updated = {...item};
        delete updated.label;
        return updated;
      }
      return {...item, [action.field]: action.value};
    });
    case 'remove': return prompts.filter((_, index) => index !== action.index);
    case 'clear': return [];
    case 'import': {
      if (action.rows.length !== action.newIDs.length) throw new Error('prompt import ID count');
      const imported = action.rows.map((row, index) => ({id: action.newIDs[index], name: row.name, prompt: row.prompt}));
      return action.mode === 'replace' ? imported : prompts.concat(imported);
    }
  }
}

export {promptsToCSV};
