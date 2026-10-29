import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer/components/FilesRoute';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useRecentStore } from '@/renderer/features/disk-explorer/store/recentStore';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { filesLocationSnapshots } from '@/renderer/features/disk-explorer/navigation/filesLocationSnapshots';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installActivityApi, recentItem, recentResult } from '@/tests/helpers/activityApi';
import { openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const NOTES = '/Vault/Notes';
const NOTE = '/Vault/Notes/brief.md';
const PDF = '/Vault/Papers/paper.pdf';
const MIN = 60_000;
const HOUR = 60 * MIN;

function Harness() {
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => useTabsStore.getState().back()}>Back</button>
      <output data-testid="location">{location.search}</output>
      <FilesRoute />
    </>
  );
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/files${search}`]}>
      <Harness />
    </MemoryRouter>
  );
}

function rows() {
  const now = Date.now();
  return recentResult([
    recentItem({
      entry: { path: NOTE, name: 'brief.md', kind: 'markdown' },
      touchedAt: now - 10 * MIN, touchedKind: 'opened', openedAt: now - 10 * MIN,
    }),
    recentItem({
      entry: { path: PDF, name: 'paper.pdf', kind: 'pdf' },
      touchedAt: now - 26 * HOUR, touchedKind: 'organized', openedAt: null, organizedAt: now - 26 * HOUR,
    }),
  ]);
}

beforeEach(() => {
  filesLocationSnapshots.clear();
  useRecentStore.getState().reset();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    readDirectory: vi.fn(async (path: string) => ({
      success: true as const,
      data: {
        path,
        entries: path === NOTES ? [entry({ path: NOTE, name: 'brief.md', kind: 'markdown' })] : [],
      },
    })),
    stat: vi.fn(async (path: string) => ({
      success: true as const,
      data: entry({ path, name: path.split('/').pop() ?? path, kind: 'markdown' }),
    })),
  });
  installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: rows() })) });
  useDiskStore.setState({
    roots: [], listings: {}, expanded: {}, currentDirectory: null, currentCollection: null,
    focusedPath: null, selectedPath: null, selectedPaths: [], filter: '',
    quickPreviewPath: null, isQuickLookOpen: false, isPreviewPaneOpen: false,
    pendingAction: null, pendingDelete: null, loading: { isLoading: false, error: null },
  });
  resetTabs();
});

describe('RecentView', () => {
  it('lists recent items newest first with reasons and locations, without recording', async () => {
    renderAt('?mode=browse&collection=recent');
    expect(await screen.findByText('Opened 10 minutes ago')).toBeInTheDocument();
    expect(screen.getByText('Organized yesterday')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Papers')).toBeInTheDocument();
    const items = screen.getAllByTestId(/^disk-folder-entry-/);
    expect(items[0]).toHaveAttribute('data-testid', `disk-folder-entry-${NOTE}`);
    expect(window.activityAPI.record).not.toHaveBeenCalled();
    expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'recent' });
    expect(useDiskStore.getState().currentDirectory).toBeNull();
    expect(screen.queryByTestId('breadcrumb')).not.toBeInTheDocument();
  });

  it('shows the empty state when there is no activity', async () => {
    installActivityApi({ recent: vi.fn(async () => ({ success: true as const, data: recentResult() })) });
    renderAt('?mode=browse&collection=recent');
    expect(await screen.findByText('Items you open or work on will appear here.')).toBeInTheDocument();
    // Clearing history lives in Settings now.
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
  });

  it('opens a result in the current tab with one click and records the open once', async () => {
    const user = userEvent.setup();
    renderAt('?mode=browse&collection=recent');
    const row = await screen.findByTestId(`disk-folder-entry-${NOTE}`);
    await user.click(row);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `?mode=focus&dir=${encodeURIComponent(NOTES)}&file=${encodeURIComponent(NOTE)}`
      )
    );
    expect(tabPaths()).toEqual([NOTE]);
    expect(window.activityAPI.record).toHaveBeenCalledTimes(1);
    expect(window.activityAPI.record).toHaveBeenCalledWith(NOTE, 'opened');
  });

  it('Back from an opened result restores Recent and its selection without recording', async () => {
    const user = userEvent.setup();
    renderAt('?mode=browse&collection=recent');
    const row = await screen.findByTestId(`disk-folder-entry-${PDF}`);
    await user.click(row);
    await waitFor(() => expect(openedPath()).toBe(PDF));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('?mode=browse&collection=recent')
    );
    await waitFor(() => expect(useDiskStore.getState().currentCollection).toEqual({ kind: 'recent' }));
    await waitFor(() => expect(useDiskStore.getState().selectedPaths).toEqual([PDF]));
    expect(window.activityAPI.record).toHaveBeenCalledTimes(1);
  });

  it('Show in folder navigates to the parent with the item selected and records the folder', async () => {
    const user = userEvent.setup();
    renderAt('?mode=browse&collection=recent');
    expect(await screen.findByRole('button', { name: 'Show in folder' })).toBeDisabled();
    fireEvent.click(screen.getByTestId(`disk-folder-entry-${NOTE}`), { metaKey: true });
    await user.click(screen.getByRole('button', { name: 'Show in folder' }));
    await waitFor(() => expect(useDiskStore.getState().currentDirectory).toBe(NOTES));
    await waitFor(() => expect(useDiskStore.getState().selectedPaths).toEqual([NOTE]));
    expect(window.activityAPI.record).toHaveBeenCalledWith(NOTES, 'opened');
    expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
  });

  it('reloads when main reports changed activity', async () => {
    let changed: (() => void) | null = null;
    const api = installActivityApi({
      recent: vi.fn(async () => ({ success: true as const, data: rows() })),
      onChanged: vi.fn((callback: () => void) => { changed = callback; return () => undefined; }),
    });
    renderAt('?mode=browse&collection=recent');
    await screen.findByText('Opened 10 minutes ago');
    const calls = (api.recent as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => changed?.());
    await waitFor(() => expect((api.recent as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });

  it('shows a retryable error when loading fails', async () => {
    const recent = vi.fn()
      .mockResolvedValueOnce({ success: false as const, error: 'nope' })
      .mockResolvedValue({ success: true as const, data: rows() });
    installActivityApi({ recent });
    const user = userEvent.setup();
    renderAt('?mode=browse&collection=recent');
    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Opened 10 minutes ago')).toBeInTheDocument();
  });

  it('keeps the name filter and warnings visible', async () => {
    installActivityApi({
      recent: vi.fn(async () => ({ success: true as const, data: recentResult(rows().items, { warnings: ['Recent activity could not be saved: disk full'] }) })),
    });
    const user = userEvent.setup();
    renderAt('?mode=browse&collection=recent');
    expect(await screen.findByText(/disk full/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Filter recent items'), 'paper');
    expect(screen.queryByTestId(`disk-folder-entry-${NOTE}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`disk-folder-entry-${PDF}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/disk full/)).not.toBeInTheDocument();
  });
});
