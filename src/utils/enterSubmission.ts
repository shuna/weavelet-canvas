export function enterSubmission(input: {
  key: string;
  isComposing: boolean;
  keyCode: number;
  isMobile: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  enterToSubmit: boolean;
  sticky?: boolean;
}): 'generate' | 'save' | null {
  // Safari may finish composition before the confirming Enter keydown.
  if (input.isComposing || input.keyCode === 229 || input.key !== 'Enter' || input.isMobile) return null;
  if (input.ctrlKey && input.shiftKey) return 'generate';
  if ((input.enterToSubmit && !input.shiftKey) || (!input.enterToSubmit && (input.ctrlKey || input.shiftKey))) {
    return input.sticky ? 'generate' : 'save';
  }
  return null;
}
