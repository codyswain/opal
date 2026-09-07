import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/renderer/store/settingsStore';

beforeEach(() => {
  useSettingsStore.setState({ settings: { openAIKey: '' }, loading: { isLoading: false, error: null } });
});

describe('settingsStore.loadSettings', () => {
  it('unwraps the IPC envelope the credentials channel answers with', async () => {
    (window as unknown as { credentialAPI: unknown }).credentialAPI = { getKey: vi.fn(async () => ({ success: true, data: 'sk-live' })), setKey: vi.fn(), deleteKey: vi.fn() };
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().settings.openAIKey).toBe('sk-live');
  });

  it('treats a missing key, a failed response, or a bare string safely', async () => {
    const api: { getKey: () => Promise<unknown>; setKey: () => void; deleteKey: () => void } = { getKey: vi.fn(async () => ({ success: true, data: null })), setKey: vi.fn(), deleteKey: vi.fn() };
    (window as unknown as { credentialAPI: unknown }).credentialAPI = api;
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().settings.openAIKey).toBe('');
    api.getKey = vi.fn(async () => ({ success: false, error: 'keychain locked' }));
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().settings.openAIKey).toBe('');
    api.getKey = vi.fn(async () => 'sk-bare');
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().settings.openAIKey).toBe('sk-bare');
  });
});
