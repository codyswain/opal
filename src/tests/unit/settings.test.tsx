import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog, useSettingsStore } from '@/renderer/features/settings';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installActivityApi } from '@/tests/helpers/activityApi';

function renderSettings() {
  const view = render(
    <ThemeProvider>
      <TooltipProvider>
        <SettingsDialog />
      </TooltipProvider>
    </ThemeProvider>
  );
  act(() => useSettingsStore.getState().show());
  return view;
}

beforeEach(() => {
  window.localStorage.clear();
  useSettingsStore.setState({ open: false });
  useDiskStore.setState({ roots: ['/Users/me/Vault', '/Users/me/Papers'] });
  installActivityApi();
});

describe('Settings', () => {
  it('opens as a dialog and closes with Escape', async () => {
    installDiskApi();
    const user = userEvent.setup();
    renderSettings();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(useSettingsStore.getState().open).toBe(false);
  });

  it('lists opened folders with a close action and a way to add another', async () => {
    const api = installDiskApi({ removeRoot: vi.fn(async () => ({ success: true as const, data: undefined })), listRoots: vi.fn(async () => ({ success: true as const, data: ['/Users/me/Papers'] })) });
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
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
  });

  it('clears recent history only after confirmation', async () => {
    installDiskApi();
    const activity = installActivityApi();
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(activity.clear).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(activity.clear).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Recent history cleared.')).toBeInTheDocument();
  });

  it('says so when main cannot clear the history', async () => {
    installDiskApi();
    installActivityApi({ clear: vi.fn(async () => ({ success: false as const, error: 'disk full' })) });
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Recent history could not be cleared.')).toBeInTheDocument();
  });
});
