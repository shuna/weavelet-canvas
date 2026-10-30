import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrCreateDeviceId } from './deviceId';

describe('getOrCreateDeviceId', () => {
  const STORAGE_KEY = 'weavelet-device-id';

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('generates and persists a UUID on first call', () => {
    const id = getOrCreateDeviceId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id);
  });

  it('works on LAN HTTP where crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const id = getOrCreateDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(getOrCreateDeviceId()).toBe(id);
  });

  it('returns the same UUID on subsequent calls', () => {
    const first = getOrCreateDeviceId();
    const second = getOrCreateDeviceId();
    expect(second).toBe(first);
  });

  it('returns a fallback UUID when localStorage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('localStorage disabled');
    });

    const id = getOrCreateDeviceId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
