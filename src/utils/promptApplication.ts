import type { ContentInterface } from '@type/chat';

export function appendSystemLibraryPrompt(previous: string, text: string): string {
  return previous ? previous + '\n\n' + text : text;
}

export function appendCommandLibraryPrompt(previous: ContentInterface[], text: string): ContentInterface[] {
  const first = previous[0];
  if (first?.type === 'text') {
    return [{ ...first, text: first.text + text }, ...previous.slice(1)];
  }
  return [{ type: 'text', text }, ...previous];
}
