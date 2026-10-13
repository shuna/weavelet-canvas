// Shared by the conversation display and image export; file export keeps every message.
export function isMessageVisible(advancedMode: boolean, originalIndex: number, role: string): boolean {
  return !(!advancedMode && originalIndex === 0 && role === 'system');
}
