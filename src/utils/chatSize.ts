import type { ContentInterface, ImageContentInterface, TextContentInterface } from '@type/chat';

export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('en-US', {
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(num)
    .replace(/,/g, ' ');
};

export type ChatSizePart = { type: string; textLength: number; hasImageURL: boolean; imageURLLength: number };
export function chatSizeFromLengths(messages: ChatSizePart[][]): number {
  return messages.reduce((total, parts) => total + parts.reduce((subtotal, part) => subtotal +
    (part.type === 'text' ? part.textLength : part.hasImageURL ? part.imageURLLength : 0), 0), 0);
}
export function measureChatSize(messages: { content: ContentInterface[] }[]): number {
  return chatSizeFromLengths(messages.map(message => message.content.map(part => {
    const text = (part as TextContentInterface).text;
    const image = (part as ImageContentInterface).image_url;
    return { type: part.type, textLength: typeof text === 'string' ? text.length : 0,
      hasImageURL: image !== undefined, imageURLLength: typeof image?.url === 'string' ? image.url.length : 0 };
  })));
}
export const chatSizeLabel = (size: number): string | undefined => size ? formatNumber(size) : undefined;
