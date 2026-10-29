import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '@/renderer/features/settings';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
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
  useDiskStore.setState({ roots: ['/Users/me/Vault', '/Users/me/Papers'] });
});

describe('Settings', () => {
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
});
