import { hasMeaningfulMessageContent } from '../../src/utils/contentValidation';
import { textValueOf, replaceTextValue } from '../../src/utils/messageText';
import type { ContentInterface, ImageDetail } from '../../src/types/chat';

type ComposerInput = {
  operation: 'prepare';
  parts: ContentInterface[];
  text?: string;
  images?: { url: string; detail: ImageDetail }[];
};

export function composerContent(json: string): string {
  const input = JSON.parse(json) as ComposerInput;
  if (input.operation !== 'prepare') throw new Error('Unknown composer operation.');
  const parts = input.text === undefined ? input.parts : replaceTextValue(input.parts, input.text);
  const prepared: ContentInterface[] = input.images?.length
    ? [...parts, ...input.images.map(image => ({ type: 'image_url' as const, image_url: { url: image.url, detail: image.detail } }))]
    : parts;
  return JSON.stringify({ parts: prepared,
    hasMeaningfulContent: hasMeaningfulMessageContent([{ role: 'user', content: prepared }]),
    text: textValueOf(prepared) });
}
