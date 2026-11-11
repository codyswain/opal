import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateRow, useUpdatesStore } from '@/renderer/features/updates';
import { updateBackupsDir, updateRelaunchEnv } from '@/main/testProfile';
import type { UpdateState } from '@/types/updates';

const ready: UpdateState = {
  current: { commit: 'aaa1111', builtAt: '2026-01-05T07:40:00Z' },
  available: { commit: 'bbb2222', builtAt: '2026-01-06T07:40:00Z', notes: 'Faster daily page' },
  showRow: true,
  canRollBack: false,
  busy: null,
};

afterEach(() => {
  useUpdatesStore.setState({ state: null, pending: false });
  delete (window as Partial<Window>).updatesAPI;
});

describe('UpdateRow', () => {
  it('is absent until an update is ready, and for a build rolled back from', () => {
    const { container, rerender } = render(<UpdateRow />);
    expect(container).toBeEmptyDOMElement();
    useUpdatesStore.setState({ state: { ...ready, showRow: false } });
    rerender(<UpdateRow />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reads Update ready with the notes as its tooltip, and installs on one click', async () => {
    // Opal quits before the call returns, so it never does here.
    const install = vi.fn(() => new Promise(() => undefined));
    window.updatesAPI = { install } as unknown as Window['updatesAPI'];
    useUpdatesStore.setState({ state: ready });
    render(<UpdateRow />);
    const row = screen.getByRole('button', { name: 'Update ready' });
    expect(row).toHaveAttribute('title', 'Faster daily page');
    fireEvent.click(row);
    expect(install).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled();
  });

  it('reads Updating… while the main process installs', () => {
    useUpdatesStore.setState({ state: { ...ready, showRow: false, busy: 'installing' } });
    render(<UpdateRow />);
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
  });
});

describe('update test-profile settings', () => {
  it('moves the backups folder and passes the profile on only under a test profile', () => {
    const home = '/Users/someone';
    expect(updateBackupsDir({ OPAL_TEST_UPDATE_BACKUPS_DIR: '/tmp/b' }, home)).toBe(`${home}/Library/Caches/Opal-app-backups`);
    expect(updateBackupsDir({ OPAL_TEST_USER_DATA_DIR: '/tmp/p', OPAL_TEST_UPDATE_BACKUPS_DIR: '/tmp/b' }, home)).toBe('/tmp/b');
    expect(updateRelaunchEnv({})).toBeNull();
    expect(updateRelaunchEnv({ OPAL_TEST_UPDATE_BACKUPS_DIR: '/tmp/b' })).toBeNull();
    expect(updateRelaunchEnv({ OPAL_TEST_USER_DATA_DIR: '/tmp/p', OPAL_TEST_UPDATE_BACKUPS_DIR: '/tmp/b' }))
      .toEqual({ OPAL_TEST_USER_DATA_DIR: '/tmp/p', OPAL_TEST_UPDATE_BACKUPS_DIR: '/tmp/b' });
  });
});
