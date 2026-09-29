import { afterEach, expect, it, vi } from 'vitest';
import { requestGoogleCode } from './google-popup';

let channel: { name: string; onmessage?: (event: { data: unknown }) => void; close: ReturnType<typeof vi.fn> };
function setup(popup: object | null = { closed: true }) {
  vi.useFakeTimers();
  vi.stubGlobal('BroadcastChannel', class {
    name: string;
    close = vi.fn();
    constructor(name: string) { this.name = name; channel = this; }
  });
  const open = vi.fn().mockReturnValue(popup);
  vi.stubGlobal('window', { open });
  return open;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('receives the code even when COOP has severed the popup window handle', async () => {
  const open = setup();
  const result = requestGoogleCode();
  expect(open.mock.calls[0][0]).toBe(`/google-auth.html#${channel.name}`);
  channel.onmessage?.({ data: { code: '' } });
  expect(channel.close).not.toHaveBeenCalled();
  channel.onmessage?.({ data: { code: 'one-time-code' } });
  await expect(result).resolves.toBe('one-time-code');
  expect(channel.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('reports popup blocking and cancellation instead of silently staying disconnected', async () => {
  setup(null);
  await expect(requestGoogleCode()).rejects.toThrow('ポップアップ');
  expect(channel.close).toHaveBeenCalledOnce();
  setup();
  const result = requestGoogleCode();
  channel.onmessage?.({ data: { error: 'closed' } });
  await expect(result).rejects.toThrow('Google認証を完了できません');
  expect(vi.getTimerCount()).toBe(0);
});
it('ends an abandoned attempt without accepting results on its old channel', async () => {
  setup();
  const result = expect(requestGoogleCode()).rejects.toThrow('Google認証が完了しません');
  await vi.advanceTimersByTimeAsync(180000);
  await result;
  expect(channel.close).toHaveBeenCalledOnce();
});
