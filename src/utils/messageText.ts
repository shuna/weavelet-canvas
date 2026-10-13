import type { ContentInterface, TextContentInterface } from '@type/chat';

const firstTextIndex = (content: ContentInterface[]): number =>
  content.findIndex((item) => item.type === 'text');

export const textValueOf = (content: ContentInterface[]): string => {
  const index = firstTextIndex(content);
  return index >= 0 ? (content[index] as TextContentInterface).text : '';
};

export const replaceTextValue = (
  content: ContentInterface[],
  text: string
): ContentInterface[] => {
  const index = firstTextIndex(content);
  if (index < 0) {
    return [{ type: 'text', text } as TextContentInterface, ...content];
  }

  const next = [...content];
  next[index] = { ...content[index], text } as TextContentInterface;
  return next;
};
