import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RecentView } from '@/renderer/features/disk-explorer/components/RecentView';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useRecentStore } from '@/renderer/features/disk-explorer/store/recentStore';
import { ShellProvider } from '@/renderer/features/shell/context/ShellContext';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installActivityApi, recentItem, recentResult } from '@/tests/helpers/activityApi';
import { openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const LOG = '/Vault/Library/daily/2026-10-28.md';
const PERSON = '/Vault/Library/people/Alec.md';
const PAPER = '/Vault/Library/papers/paper.pdf';
const README = '/Vault/README.md';
const NOW = new Date(2026, 9, 28, 15, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

function rows() {
  return recentResult([
    recentItem({ entry: { path: LOG, name: '2026-10-28.md', kind: 'markdown' }, touchedAt: at(28, 14, 50) }),
    recentItem({ entry: { path: PERSON, name: 'Alec.md', kind: 'markdown' }, touchedAt: at(27, 9, 15) }),
    recentItem({ entry: { path: PAPER, name: 'paper.pdf', kind: 'pdf' }, touchedAt: at(24, 11) }),
    recentItem({ entry: { path: README, name: 'README.md', kind: 'markdown' }, touchedAt: at(8, 10) }),
  ]);
}

function renderRecent() {
  return render(
    <MemoryRouter
      initialEntries={['/files']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ShellProvider>
        <RecentView />
      </ShellProvider>
    </MemoryRouter>
  );
}

const row = (path: string) => screen.getByTestId(`recent-row-${path}`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useRecentStore.getState().reset();
  installDiskApi();
  installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: rows() })) });
  useDiskStore.setState({ roots: [ROOT], rootsLoaded: true, listings: {} });
  resetTabs();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RecentView', () => {
  it('groups files by day, with the folder muted and the time on the right', async () => {
    renderRecent();
    await screen.findByTestId(`recent-row-${LOG}`);
    const groups = screen.getAllByRole('region').map((group) => group.getAttribute('aria-label'));
    expect(groups).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Earlier']);

    const today = within(screen.getByRole('region', { name: 'Today' }));
    expect(today.getByText('2026-10-28')).toBeInTheDocument();
    expect(today.getByText('Library/daily')).toBeInTheDocument();
    expect(today.getByText(/^2:50\sPM$/)).toBeInTheDocument();
    expect(row(PERSON)).toHaveTextContent(/AlecLibrary\/people9:15\sAM/);
    expect(row(PAPER)).toHaveTextContent('paper.pdfLibrary/papersSaturday');
    // A file at the top of the vault has no folder to show.
    expect(row(README)).toHaveTextContent('READMEOct 8');
    expect(row(README)).toHaveAttribute('title', 'README.md');
    expect(row(PERSON)).toHaveAttribute('title', 'Library/people/Alec.md');

    expect(window.activityAPI.recent).toHaveBeenCalledWith({ since: new Date(2026, 8, 28).getTime() });
    expect(window.activityAPI.record).not.toHaveBeenCalled();
  });

  it('opens a file in the current tab, or a new one with Cmd+click or a middle click', async () => {
    renderRecent();
    fireEvent.click(await screen.findByTestId(`recent-row-${LOG}`));
    expect(openedPath()).toBe(LOG);
    expect(window.activityAPI.record).toHaveBeenCalledWith(LOG, 'opened');

    fireEvent.click(row(PERSON), { metaKey: true });
    expect(tabPaths()).toEqual([LOG, PERSON]);
    fireEvent(row(PAPER), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(tabPaths()).toEqual([LOG, PERSON, PAPER]);
    expect(openedPath()).toBe(PAPER);
  });

  it('moves between rows with the arrow keys', async () => {
    const user = userEvent.setup();
    renderRecent();
    await screen.findByTestId(`recent-row-${LOG}`);
    row(LOG).focus();
    await user.keyboard('{ArrowDown}');
    expect(row(PERSON)).toHaveFocus();
    await user.keyboard('{End}');
    expect(row(README)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(row(PAPER)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(row(LOG)).toHaveFocus();
  });

  it('says what will appear when nothing was opened in the last 30 days', async () => {
    installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: recentResult() })) });
    renderRecent();
    expect(await screen.findByText('Files you open or edit show up here.')).toBeInTheDocument();
    // Clearing history lives in Settings.
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('reloads when main reports changed activity', async () => {
    let changed: (() => void) | null = null;
    const api = installActivityApi({
      recent: vi.fn(async () => ({ success: true as const, data: rows() })),
      onChanged: vi.fn((callback: () => void) => { changed = callback; return () => undefined; }),
    });
    renderRecent();
    await screen.findByTestId(`recent-row-${LOG}`);
    const calls = vi.mocked(api.recent).mock.calls.length;
    act(() => changed?.());
    await waitFor(() => expect(vi.mocked(api.recent).mock.calls.length).toBeGreaterThan(calls));
  });

  it('shows a retryable error when loading fails, and warnings above the list', async () => {
    const recent = vi.fn()
      .mockResolvedValueOnce({ success: false as const, error: 'Could not load recent activity.' })
      .mockResolvedValue({
        success: true as const,
        data: recentResult(rows().items, { warnings: ['Recent activity could not be saved: disk full'] }),
      });
    installActivityApi({ recent });
    renderRecent();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load recent activity.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId(`recent-row-${LOG}`)).toBeInTheDocument();
    expect(screen.getByText(/disk full/)).toBeInTheDocument();
  });
});
