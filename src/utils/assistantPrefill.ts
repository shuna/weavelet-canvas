export const isAssistantPrefillEnabled = (modelSource?: string): boolean => modelSource === 'local';

export function isAssistantPrefillLocation(input: {sticky: boolean; role: string; nodeId?: string; readOnly?: boolean; collapsed?: boolean}): boolean {
  return input.role === 'user' && (input.sticky || (!input.readOnly && !!input.nodeId && !input.collapsed));
}

export function shouldConsumeAssistantPrefill(isLocal: boolean, draft?: string, prefix?: string): boolean {
  return isLocal && prefix !== undefined && draft?.trim() === prefix;
}
