import { test, expect } from '@playwright/test';

test.use({ headless: true, baseURL: 'http://127.0.0.1:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('chat and default settings persist model-scoped controls and enforce ZDR', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const source = await (await fetch('/src/components/ConfigMenu/ConfigMenu.tsx')).text();
    const reactPath = source.match(/from "([^"\n]*\/react\.js[^"\n]*)"/)![1];
    const React = (await load(reactPath)).default;
    const { createRoot } = (await load('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { default: ConfigMenu } = await load('/src/components/ConfigMenu/ConfigMenu.tsx');
    const { ChatConfigInline } = await load('/src/components/ChatConfigMenu/ChatConfigMenu.tsx');
    const { default: useStore } = await load('/src/store/store.ts');
    const { _defaultChatConfig } = await load('/src/constants/chat.ts');
    const { default: i18n } = await load('/src/i18n.ts');
    await i18n.changeLanguage('en');
    const config = { ..._defaultChatConfig, model: 'anthropic/claude-sonnet-4', providerId: 'openrouter', modelSource: 'remote', openRouter: { responseCache: { mode: 'off' }, stickySession: true } };
    useStore.setState({ defaultChatConfig: config, favoriteModels: [
      { modelId: config.model, providerId: 'openrouter' }, { modelId: 'openai/gpt-4.1', providerId: 'openrouter' },
    ] });
    const element = document.createElement('div'); element.id = 'or-settings-check'; document.body.append(element);
    let root = createRoot(element);
    const state = (window as any).orSettings = {
      saved: config,
      mount: (kind: string) => {
        root.unmount(); root = createRoot(element);
        if (kind === 'chat') root.render(React.createElement(ConfigMenu, { config, setConfig: (value: unknown) => state.saved = value, setIsModalOpen() {}, imageDetail: 'auto', setImageDetail() {} }));
        else root.render(React.createElement(ChatConfigInline));
      },
      unmount: () => root.unmount(),
      defaultConfig: () => useStore.getState().defaultChatConfig,
    };
    state.mount('chat');
  });
  const fields = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'OpenRouter' }) });
  const selects = fields.locator('select');
  await expect(fields).toContainText('OpenRouter');
  await fields.locator('input[placeholder]').nth(1).fill('anthropic');
  await selects.nth(5).selectOption('on');
  await expect.poll(() => page.evaluate(() => (window as any).orSettings.saved.openRouter)).toMatchObject({ routing: { only: ['anthropic'] }, responseCache: { mode: 'on' } });
  await fields.locator('input[type=checkbox]').first().check();
  await expect(selects.nth(5)).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as any).orSettings.saved.openRouter)).toMatchObject({ routing: { zdr: true }, responseCache: { mode: 'off' } });
  await page.locator('.basic-single').last().click();
  await page.getByRole('option', { name: 'openai/gpt-4.1' }).click();
  await expect(fields.locator('input[placeholder]').nth(1)).toHaveValue('');
  await expect(fields.locator('option[value=claude-system]')).toHaveAttribute('disabled', '');
  await expect.poll(() => page.evaluate(() => (window as any).orSettings.saved.openRouter)).toEqual({ responseCache: { mode: 'off' }, stickySession: true });
  await page.locator('.basic-single').last().click();
  await page.getByRole('option', { name: 'anthropic/claude-sonnet-4' }).click();
  await expect(fields.locator('input[placeholder]').nth(1)).toHaveValue('anthropic');
  await expect(fields.locator('input[type=checkbox]').first()).toBeChecked();
  await page.evaluate(() => (window as any).orSettings.mount('default'));
  await fields.locator('input[placeholder]').nth(2).fill('google-vertex');
  await page.evaluate(() => (window as any).orSettings.unmount());
  await expect.poll(() => page.evaluate(() => (window as any).orSettings.defaultConfig().openRouter)).toMatchObject({ routing: { ignore: ['google-vertex'] } });
});
