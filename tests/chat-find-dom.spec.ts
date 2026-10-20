import { expect, test } from '@playwright/test';

test.use({ headless: true });
test('overlapping and Unicode matches preserve DOM text, selection and exclusions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/utils/chatFindDom.ts';
    const { highlightChatFind, clearChatFind, selectChatFindMatch } = await import(modulePath);
    const root = document.createElement('div');
    root.innerHTML = '<p>banana İxİ</p><p>ba<b>na</b>na</p><textarea>banana</textarea><div contenteditable="true"><span>banana</span></div><div data-chat-find-bar>banana</div>';
    document.body.appendChild(root);
    const original = root.textContent;
    const overlap = highlightChatFind(root, 'ana');
    const selected = selectChatFindMatch(overlap, 1);
    const overlapResult = {
      count: overlap.length, ranges: overlap.map((match: { range: Range }) => match.range.toString()),
      text: root.textContent, selected: selected.range.toString(),
      active: root.querySelectorAll('.chat-find-highlight-active').length,
      height: selected.range.getBoundingClientRect().height,
      excluded: root.querySelectorAll('textarea mark, [contenteditable] mark, [data-chat-find-bar] mark').length,
    };
    const unicode = highlightChatFind(root, 'i');
    const unicodeRanges = unicode.map((match: { range: Range }) => match.range.toString());
    const unicodeText = root.textContent;
    clearChatFind(root);
    const cleared = root.textContent;
    const marks = root.querySelectorAll('mark').length;
    root.remove();
    return { original, overlapResult, unicodeRanges, unicodeText, cleared, marks };
  });
  expect(result.overlapResult.count).toBe(2);
  expect(result.overlapResult.ranges).toEqual(['ana', 'ana']);
  expect(result.overlapResult.text).toBe(result.original);
  expect(result.overlapResult.selected).toBe('ana');
  expect(result.overlapResult.active).toBe(2);
  expect(result.overlapResult.height).toBeGreaterThan(0);
  expect(result.overlapResult.excluded).toBe(0);
  expect(result.unicodeRanges).toEqual(['İ', 'İ']);
  expect(result.unicodeText).toBe(result.original);
  expect(result.cleared).toBe(result.original);
  expect(result.marks).toBe(0);
});
