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

for (const clearBeforeUpdate of [false, true]) {
  test(`React updates content and structure with clear-before-render=${clearBeforeUpdate}`, async ({ page }) => {
    await page.goto('/');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const result = await page.evaluate(async clearFirst => {
      const modulePath = '/tests/chat-find-react-fixture.ts';
      return (await import(modulePath)).exerciseReactChatFind(clearFirst);
    }, clearBeforeUpdate);
    expect(result.error).toBeNull();
    expect(result.stages).toEqual(['updated banana suffix', 'updated banana suffix', 'final', 'replacement']);
    expect(result.count).toBe(2);
    expect(errors).toEqual([]);
  });
}

test('clear keeps original Text identity and synchronous renderer edits, including deletion', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/utils/chatFindDom.ts';
    const { highlightChatFind, clearChatFind } = await import(modulePath);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const text = document.createTextNode('banana');
    root.appendChild(text);
    highlightChatFind(root, 'ana');
    clearChatFind(root);
    const identity = root.firstChild === text && root.textContent === 'banana';
    highlightChatFind(root, 'ana');
    text.data = '';
    clearChatFind(root);
    const empty = root.textContent;
    text.data = 'banana';
    highlightChatFind(root, 'ana');
    root.removeChild(text);
    await Promise.resolve();
    const removed = root.textContent;
    clearChatFind(root);
    root.appendChild(document.createTextNode('new banana'));
    const ranges = highlightChatFind(root, 'ana').map((match: { range: Range }) => match.range.toString());
    clearChatFind(root);
    const refreshed = root.textContent;
    root.remove();
    return { identity, empty, removed, ranges, refreshed };
  });
  expect(result).toEqual({ identity: true, empty: '', removed: '', ranges: ['ana', 'ana'], refreshed: 'new banana' });
});

test('Web ChatFindBar refreshes after React mutations without adding navigation or scroll', async ({ page }) => {
  await page.goto('/');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async () => {
    const modulePath = '/tests/chat-find-react-fixture.ts';
    (window as any).webFindFixture = await (await import(modulePath)).mountWebChatFind();
  });
  const fixture = page.locator('#chat-find-fixture');
  const input = fixture.locator('[data-chat-find-bar] input');
  await input.fill('banana');
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('1/2');
  await input.press('Enter');
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('2/2');
  const counters = await page.evaluate(() => (window as any).webFindFixture.counters());
  await fixture.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(fixture.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible();
  await expect(fixture.locator('[data-find-body] mark')).toHaveCount(2);
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('2/2');
  await expect(fixture.locator('.chat-find-highlight-active')).toHaveText('banana');
  expect(await page.evaluate(() => (window as any).webFindFixture.counters())).toEqual(counters);
  await page.evaluate(() => (window as any).webFindFixture.update('banana banana banana'));
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('2/3');
  await input.press('Enter');
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('3/3');
  await input.press('Shift+Enter');
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('2/3');
  await input.fill('absent');
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('0件');
  await page.evaluate(() => (window as any).webFindFixture.update('absent absent'));
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('1/2');
  await input.fill('banana');
  await input.fill('absent');
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('1/2');
  await expect(fixture.locator('[data-find-body] mark')).toHaveText(['absent', 'absent']);
  await fixture.locator('[data-chat-find-bar] button').nth(1).click();
  await page.evaluate(() => (window as any).webFindFixture.update('absent absent absent'));
  await expect(fixture.locator('[data-chat-find-bar]')).toContainText('0件');
  await expect(fixture.locator('[data-find-body] mark')).toHaveCount(0);
  await input.fill('absent');
  await page.evaluate(() => (window as any).webFindFixture.unmount());
  await page.waitForTimeout(350);
  await expect(page.locator('#chat-find-fixture')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('all-node search refreshes highlights without replacing node counts or selection', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const modulePath = '/tests/chat-find-react-fixture.ts';
    (window as any).webFindFixture = await (await import(modulePath)).mountWebChatFind();
    (window as any).webFindFixture.enableNodeSearch();
  });
  const fixture = page.locator('#chat-find-fixture');
  const bar = fixture.locator('[data-chat-find-bar]');
  await bar.locator('input').fill('banana');
  await expect(bar).toContainText('1/2');
  await bar.locator('button').nth(1).click();
  await expect(bar).toContainText('1/1');
  await expect(fixture.locator('[data-find-body] mark')).toHaveCount(2);
  const counters = await page.evaluate(() => (window as any).webFindFixture.counters());
  await fixture.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(fixture.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible();
  await expect(fixture.locator('[data-find-body] mark')).toHaveCount(2);
  await expect(bar).toContainText('1/1');
  expect(await page.evaluate(() => (window as any).webFindFixture.counters())).toEqual(counters);
  await page.evaluate(() => (window as any).webFindFixture.update('banana banana banana'));
  await expect(fixture.locator('[data-find-body] mark')).toHaveCount(3);
  await expect(bar).toContainText('1/1');
  expect(await page.evaluate(() => (window as any).webFindFixture.counters())).toEqual(counters);
  await bar.locator('input').press('Enter');
  await page.evaluate(() => (window as any).webFindFixture.unmount());
  await page.waitForTimeout(350);
  await expect(page.locator('#chat-find-fixture')).toHaveCount(0);
});
