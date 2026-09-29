import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { connectGoogle, state } = vi.hoisted(() => ({
  connectGoogle: vi.fn(),
  state: { setProvider: vi.fn(), setGoogleAccessToken: vi.fn(), setCloudSync: vi.fn(), setSyncStatus: vi.fn() },
}));
vi.mock('@api/google-auth', () => ({ connectGoogle }));
vi.mock('@store/cloud-auth-store', () => ({ default: { getState: () => state } }));
let config: { callback: (response: { code: string }) => Promise<void> };
let script: { src: string; onload: () => void };
const elements = { status: { textContent: '' }, connect: { disabled: true }, back: { hidden: false } };
const replace = vi.fn();
const values = new Map<string, string>();
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  values.clear(); values.set('google-auth-started', String(Date.now()));
  elements.connect.disabled = true; elements.back.hidden = false;
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('location', { replace });
  vi.stubGlobal('document', {
    getElementById: (id: keyof typeof elements) => elements[id],
    createElement: () => (script = {} as typeof script), head: { append: vi.fn() },
  });
  vi.stubGlobal('window', { google: { accounts: { oauth2: { initCodeClient: (options: typeof config) => { config = options; return { requestCode: vi.fn() }; } } } } });
});
afterEach(() => vi.unstubAllGlobals());
it('saves the successful connection before returning to sync settings in the same tab', async () => {
  connectGoogle.mockResolvedValue('short-token');
  await import('./google-auth-page'); script.onload();
  await config.callback({ code: 'one-time-code' });
  expect(connectGoogle).toHaveBeenCalledWith('one-time-code');
  expect(state.setGoogleAccessToken).toHaveBeenCalledWith('short-token');
  expect(state.setCloudSync).toHaveBeenCalledWith(true);
  expect(values.has('google-auth-started')).toBe(false);
  expect(replace).toHaveBeenCalledWith('/?google-sync=return');
  await config.callback({ code: 'duplicate' });
  expect(connectGoogle).toHaveBeenCalledTimes(1);
});
it('keeps the error visible and allows retry when the server refuses the connection', async () => {
  connectGoogle.mockRejectedValue(new Error('401 Cloudflare Access login required'));
  await import('./google-auth-page'); script.onload();
  await config.callback({ code: 'code' });
  expect(elements.status.textContent).toContain('401 Cloudflare Access');
  expect(elements.connect.disabled).toBe(false);
  expect(elements.back.hidden).toBe(false);
  expect(state.setCloudSync).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
it('does not start authentication without a recent request from the app', async () => {
  values.set('google-auth-started', String(Date.now() - 600001));
  await import('./google-auth-page');
  expect(document.head.append).not.toHaveBeenCalled();
  expect(elements.connect.disabled).toBe(true);
});
