import type { ContentInterface, TextContentInterface } from '@type/chat';

export function appendSystemLibraryPrompt(previous: string, text: string): string {
  return previous ? previous + '\n\n' + text : text;
}

export function appendCommandLibraryPrompt(previous: ContentInterface[], text: string): ContentInterface[] {
  const currentText =
    previous.length > 0 && (previous[0] as TextContentInterface).text !== undefined
      ? (previous[0] as TextContentInterface).text
      : '';
  return [
    { type: 'text', text: currentText + text },
    ...previous.slice(1),
  ];
}
