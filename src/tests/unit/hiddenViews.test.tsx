import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DiskExplorer } from '@/renderer/features/disk-explorer/components/DiskExplorer';
import { TabStrip } from '@/renderer/features/disk-explorer/components/TabStrip';
import { TouchedList } from '@/renderer/features/disk-explorer/components/stack/TouchedList';
import type { TouchedItem } from '@/types/touched';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { namesHidden, useHiddenStore } from '@/renderer/features/disk-explorer/store/hiddenStore';
import { ShellProvider } from '@/renderer/features/shell/context/ShellContext';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { openTabs, resetTabs } from '@/tests/helpers/tabs';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const ROOT = '/Vault';
const PRIVATE = '/Vault/Notes/Private.md';
const PLAN = '/Vault/Notes/Plan.md';

beforeEach(() => {
  resetTabs();
  installActivityApi();
  installMarkdownApi({ [PRIVATE]: '# Private\n', [PLAN]: '# Plan\n' });
  installDiskApi({ stat: vi.fn(async () => ({ success: false as const, error: 'Missing' })) });
  Object.defineProperty(window, 'hiddenAPI', {
    value: {
      state: vi.fn(async () => ({ success: true, data: { shown: false } })),
      blocked: vi.fn(async (paths: string[]) => ({ success: true, data: paths.map((path) => path === PRIVATE) })),
      onChanged: vi.fn(() => () => undefined),
    },
    configurable: true,
  });
  useHiddenStore.setState({ shown: false, blocked: { [PRIVATE]: true, [PLAN]: false }, ready: true, generation: 1 });
  useDiskStore.setState({
    roots: [ROOT],
    rootsLoaded: true,
    listings: {},
    expanded: {},
    pendingAction: null,
    pendingDelete: null,
    loading: { isLoading: false, error: null },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'hiddenAPI');
});

describe('a hidden file in a tab', () => {
  it('shows only the hidden line, and never reads the file', async () => {
    openTabs([PRIVATE]);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TooltipProvider><ShellProvider><DiskExplorer /></ShellProvider></TooltipProvider>
      </MemoryRouter>
    );
    expect(await screen.findByTestId('files-hidden')).toHaveTextContent('This file is hidden.');
    expect(window.markdownAPI.read).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Private');
  });

  it('names its tab Hidden, and other tabs as before', () => {
    useDiskStore.setState({ listings: { '/Vault/Notes': [entry({ path: PLAN, name: 'Plan.md', kind: 'markdown' })] } });
    openTabs([PRIVATE, PLAN]);
    render(<TooltipProvider><TabStrip /></TooltipProvider>);
    const strip = screen.getByTestId('tab-strip');
    expect(strip).toHaveTextContent('Hidden');
    expect(strip).toHaveTextContent('Plan');
    expect(strip.textContent).not.toContain('Private');
  });

  it('names no tab before the first check is in', async () => {
    useHiddenStore.setState({ blocked: {}, ready: false });
    expect(namesHidden(useHiddenStore.getState(), PLAN)).toBe(true);
    await useHiddenStore.getState().refresh([PRIVATE, PLAN]);
    expect(namesHidden(useHiddenStore.getState(), PLAN)).toBe(false);
    expect(namesHidden(useHiddenStore.getState(), PRIVATE)).toBe(true);
  });
});

describe('the touched list', () => {
  it('offers Hide on a file row only', async () => {
    const user = userEvent.setup();
    const add = vi.fn(async () => ({ success: true as const, data: undefined }));
    Object.assign(window.hiddenAPI, { add });
    const days = [null, { lines: 1, text: 'Wrote the plan.' }, null, null, null, null, null];
    const rows: TouchedItem[] = [
      { key: 'Notes/Plan.md', kind: 'file', id: null, name: 'Plan', path: PLAN, url: null, days, colour: null },
      { key: 'linear:ABC-1', kind: 'issue', id: 'ABC-1', name: 'Fix', path: null, url: 'https://example.com/ABC-1', days, colour: null },
    ];
    render(<TouchedList touched={{ week: { root: ROOT, monday: '2026-11-09', items: rows, digests: [] }, day: 1, rows, digest: null }} openPath={vi.fn()} />);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: 'ABC-1 Fix' }) });
    expect(screen.queryByTestId('touched-menu')).toBeNull();

    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: 'Plan' }) });
    const menu = await screen.findByTestId('touched-menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Hide']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Hide' }));
    expect(add).toHaveBeenCalledWith(PLAN);
  });
});
