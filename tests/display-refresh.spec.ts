import { test, expect } from '@playwright/test';

test.use({ headless: true, baseURL: 'http://127.0.0.1:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('continuous Markdown advances, completion is immediate, hidden snapshots freeze, and sync dots tick once a second', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const source = await (await fetch('/src/components/Chat/ChatContent/Message/View/ContentBody.tsx')).text();
    const reactPath = source.match(/from "([^"\n]*\/react\.js[^"\n]*)"/)![1];
    const React = (await load(reactPath)).default;
    const { createRoot } = (await load('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { default: ContentBody } = await load('/src/components/Chat/ChatContent/Message/View/ContentBody.tsx');
    const { default: SyncDots } = await load('/src/components/GoogleSync/SyncDots.tsx');
    const { useStreamingText } = await load('/src/hooks/useStreamingText.ts');
    const hookSource = await (await fetch('/src/hooks/useStreamingText.ts')).text();
    const bufferPath = hookSource.match(/from '([^'\n]*\/streamingBuffer\.ts[^'\n]*)'/)![1];
    const buffer = await load(bufferPath);
    const progress = await load('/src/store/storage/google/progress.ts');
    const { useSyncProgressDisplay } = await load('/src/hooks/useSyncProgressDisplay.ts');
    const element = document.createElement('div');
    element.id = 'display-check';
    document.body.append(element);
    const root = createRoot(element);
    let setText: (text: string) => void, setGenerating: (generating: boolean) => void;
    let setVisible: (visible: boolean) => void;
    buffer.initializeStreamingBuffer('display-test', [{ type: 'text', text: 'first' }]);
    function Check() {
      const [text, updateText] = React.useState('```text\nstart');
      const [generating, updateGenerating] = React.useState(true);
      const [visible, updateVisible] = React.useState(true);
      setText = updateText; setGenerating = updateGenerating; setVisible = updateVisible;
      const liveText = useStreamingText('display-test', visible);
      const syncProgress = useSyncProgressDisplay();
      return React.createElement('div', null,
        React.createElement('div', { id: 'markdown-check' }, React.createElement(ContentBody, {
          currentTextContent: text, markdownMode: true, streamingMarkdownPolicy: 'always',
          inlineLatex: false, isGeneratingMessage: generating,
        })),
        React.createElement('div', { id: 'snapshot-check' }, liveText),
        React.createElement('div', { id: 'progress-check' }, String(syncProgress.completedFiles)),
        React.createElement('div', { id: 'dots-check' }, React.createElement(SyncDots, { label: '同期中' })));
    }
    root.render(React.createElement(Check));
    (window as any).displayCheck = {
      update: (text: string, generating = true) => { setText(text); setGenerating(generating); },
      continuous: () => {
        let i = 0;
        const timer = setInterval(() => setText('```text\nstart-' + ++i), 30);
        return setTimeout(() => clearInterval(timer), 1200);
      },
      visible: (visible: boolean) => setVisible(visible),
      append: () => { buffer.appendToStreamingBuffer('display-test', '-next'); buffer.notifyStreamingUpdate('display-test'); },
      progress: (active: boolean, completedFiles: number) => progress.useGoogleSyncProgress.setState({ active, completedFiles }),
      cleanup: () => { root.unmount(); buffer.finalizeStreamingBuffer('display-test'); },
    };
  });
  await expect(page.locator('#markdown-check')).toContainText('start');
  await page.evaluate(() => (window as any).displayCheck.continuous());
  await expect(page.locator('#markdown-check')).toContainText('start-', { timeout: 800 });
  await page.waitForTimeout(1300);
  await page.evaluate(() => (window as any).displayCheck.update('**final tail**', false));
  await expect(page.locator('#markdown-check strong')).toHaveText('final tail');
  await page.evaluate(() => (window as any).displayCheck.visible(false));
  await page.waitForTimeout(50);
  await page.evaluate(() => (window as any).displayCheck.append());
  await page.waitForTimeout(120);
  await expect(page.locator('#snapshot-check')).toHaveText('first');
  await page.evaluate(() => (window as any).displayCheck.visible(true));
  await expect(page.locator('#snapshot-check')).toHaveText('first-next');
  await page.evaluate(() => (window as any).displayCheck.progress(true, 0));
  await expect(page.locator('#progress-check')).toHaveText('0');
  await page.evaluate(() => (window as any).displayCheck.progress(true, 5));
  await page.waitForTimeout(150);
  await expect(page.locator('#progress-check')).toHaveText('0');
  await expect(page.locator('#progress-check')).toHaveText('5');
  await page.evaluate(() => (window as any).displayCheck.progress(false, 6));
  await expect(page.locator('#progress-check')).toHaveText('6');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dots = await page.locator('#dots-check').innerText();
  await page.waitForTimeout(1100);
  await expect(page.locator('#dots-check')).toHaveText(dots);
  await page.evaluate(() => (window as any).displayCheck.cleanup());
});

test('compact mobile layout shows one receiving indicator and retains stop', async ({ page }) => {
  test.setTimeout(30000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Skip All', exact: true }).click();
  await page.locator('#modal-root').getByRole('button', { name: 'close modal', exact: true }).click();
  await page.evaluate(async () => {
    const source = await (await fetch('/src/components/Chat/ChatViewTabs.tsx')).text();
    const path = source.match(/from ['"]([^'"\n]*\/store\/store\.ts[^'"\n]*)['"]/)![1];
    const { default: store } = await import(/* @vite-ignore */ path);
    const chat = store.getState().chats?.[0];
    if (!chat) throw new Error('No initial chat');
    store.setState({ hideSideMenu: true, currentChatIndex: 0,
      generatingSessions: { 'display-mobile': { sessionId: 'display-mobile', chatId: chat.id, targetNodeId: 'display-mobile-node' } } });
  });
  const stop = page.getByRole('button', { name: /Stop generating|生成を停止|生成を中止/i });
  await expect(stop).toHaveCount(1);
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
});

test('sync banner overlays below the view bar without moving the layout', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Skip All', exact: true }).click();
  await page.locator('#modal-root').getByRole('button', { name: 'close modal', exact: true }).click();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const source = await (await fetch('/src/components/GoogleSync/GoogleSync.tsx')).text();
    const reactPath = source.match(/from "([^"\n]*\/react\.js[^"\n]*)"/)![1];
    const authPath = source.match(/from ['"]([^'"\n]*\/cloud-auth-store\.ts[^'"\n]*)['"]/)![1];
    const React = (await load(reactPath)).default;
    const { createRoot } = (await load('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { default: GoogleSync } = await load('/src/components/GoogleSync/GoogleSync.tsx');
    const { default: auth } = await load(authPath);
    const element = document.createElement('div');
    document.body.append(element);
    createRoot(element).render(React.createElement(GoogleSync, { clientId: 'test', showEntry: false }));
    (window as any).setBannerStatus = (syncStatus: string) => auth.setState({ syncStatus });
  });
  const anchor = page.locator('#google-sync-banner-overlay');
  await expect(anchor).toBeAttached();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      await expect.poll(() => anchor.evaluate(el => el.parentElement!.getBoundingClientRect().left)).toBe(0);
    }
    await page.evaluate(() => (window as any).setBannerStatus('synced'));
    await expect(page.locator('[data-google-sync-banner]')).toHaveCount(0);
    const before = await anchor.evaluate(el => el.parentElement!.getBoundingClientRect().toJSON());
    await page.evaluate(() => (window as any).setBannerStatus('syncing'));
    const banner = page.locator('[data-google-sync-banner]');
    await expect(banner).toBeVisible();
    const after = await anchor.evaluate(el => el.parentElement!.getBoundingClientRect().toJSON());
    expect(after).toEqual(before);
    const bounds = await banner.boundingBox();
    expect(bounds!.y).toBeCloseTo(before.bottom);
    expect(bounds!.height).toBe(24);
    expect(await banner.evaluate(el => el.lastElementChild!.getAttribute('role'))).toBe('img');
  }
});
