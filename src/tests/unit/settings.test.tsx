import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '@/renderer/features/settings';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { useChatStore } from '@/renderer/features/chat/store/chatStore';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useSettingsStore } from '@/renderer/store/settingsStore';
import { installChatApi } from '@/tests/helpers/chatApi';
import { installDiskApi } from '@/tests/helpers/diskApi';

function renderSettings() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <TooltipProvider>
          <Settings />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useChatStore.getState().reset();
  useDiskStore.setState({ roots: ['/Users/me/Vault', '/Users/me/Papers'] });
  useSettingsStore.setState({ settings: { openAIKey: '' }, loading: { isLoading: false, error: null } });
});

describe('Settings', () => {
  it('lists opened folders with a close action and a way to add another', async () => {
    const api = installDiskApi({ removeRoot: vi.fn(async () => ({ success: true as const, data: undefined })), listRoots: vi.fn(async () => ({ success: true as const, data: ['/Users/me/Papers'] })) });
    installChatApi();
    const user = userEvent.setup();
    renderSettings();
    const list = screen.getByRole('list', { name: 'Opened folders' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await user.click(within(list).getByRole('button', { name: 'Close Vault' }));
    expect(api.removeRoot).toHaveBeenCalledWith('/Users/me/Vault');
    await user.click(screen.getByRole('button', { name: 'Open folder…' }));
    expect(api.openFolder).toHaveBeenCalled();
  });

  it('switches the theme from a segmented control', async () => {
    installDiskApi();
    installChatApi();
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
  });

  it('shows the chat index state, gates indexing on a key, and can start an update', async () => {
    installDiskApi();
    const chat = installChatApi({ status: { ready: true, files: 12, chunks: 40, staleFiles: 3, lastIndexedAt: Date.now() - 120_000 } });
    const user = userEvent.setup();
    renderSettings();
    expect(await screen.findByText(/12 files, 40 passages, updated 2 minutes ago · 3 pending changes/)).toBeInTheDocument();
    const update = screen.getByRole('button', { name: 'Update index' });
    expect(update).toBeDisabled();
    expect(screen.getByText(/Add your OpenAI API key above/)).toBeInTheDocument();
    act(() => useSettingsStore.setState({ settings: { openAIKey: 'sk-test' } }));
    await user.click(screen.getByRole('button', { name: 'Update index' }));
    await waitFor(() => expect(chat.indexUpdate).toHaveBeenCalled());
  });
});
