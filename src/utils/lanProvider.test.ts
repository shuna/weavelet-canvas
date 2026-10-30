import { describe, expect, it } from 'vitest';
import { validateLanProvider } from './lanProvider';
import type { ProviderConfig } from '@type/provider';

const config: ProviderConfig = { id: 'lan', name: 'LAN', endpoint: ' http://[::1]:8000/v1/chat?x=1 ', modelsEndpoint: 'http://[::1]:8000/v1/models', modelsRequireAuth: false, apiKey: 'old' };

describe('LAN provider validation', () => {
  it('normalizes settings and removes a key when auth is disabled', () => {
    expect(validateLanProvider(config)).toMatchObject({ endpoint: 'http://[::1]:8000/v1/chat?x=1', apiKey: undefined });
  });
  it('rejects invalid URLs, different origins and missing keys', () => {
    for (const endpoint of ['ftp://host/path', 'http://u:p@host/', 'http://host/#fragment', 'http://host/#', '/relative']) {
      expect(() => validateLanProvider({ ...config, endpoint })).toThrow();
    }
    expect(() => validateLanProvider({ ...config, modelsEndpoint: 'http://other/v1/models' })).toThrow();
    expect(() => validateLanProvider({ ...config, modelsRequireAuth: true, apiKey: ' ' })).toThrow();
    expect(() => validateLanProvider({ ...config, endpoint: null } as never)).toThrow('Invalid LAN server settings');
    try { validateLanProvider({ ...config, endpoint: 'not-a-url-secret' }); } catch (error) {
      expect(String(error)).not.toContain('not-a-url-secret');
    }
  });
});
