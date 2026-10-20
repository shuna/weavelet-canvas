type TextContentPart = { type: string; text?: string };

export function contentPreview(parts: readonly TextContentPart[]): string {
  const text = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join(' ');
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}
