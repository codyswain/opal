import * as React from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { OpenPageRequest } from '@/common/opalLink';
import { PageLinks, ShellProvider } from '@/renderer/features/shell';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { openTabs, openedPath, tabPaths } from '@/tests/helpers/tabs';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

describe('PageLinks', () => {
  let deliver: ((request: OpenPageRequest) => void) | null;
  const onOpenPage = vi.fn((handler: (request: OpenPageRequest) => void) => {
    deliver = handler;
    return () => {
      deliver = null;
    };
  });

  beforeEach(() => {
    deliver = null;
    onOpenPage.mockClear();
    installActivityApi();
    window.systemAPI = { ...window.systemAPI, onOpenPage } as typeof window.systemAPI;
  });

  const mount = (at: string) =>
    render(
      <MemoryRouter
        initialEntries={[at]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ShellProvider>
          <PageLinks />
        </ShellProvider>
      </MemoryRouter>,
    );

  it('waits for the start page to reach the files route', () => {
    mount('/');
    expect(onOpenPage).not.toHaveBeenCalled();
  });

  it('opens a linked file in a new tab, or switches to the tab showing it', () => {
    openTabs(['/vault/a.md', '/vault/b.md'], 0);
    mount('/files');
    act(() => deliver?.({ path: '/vault/c.md' }));
    expect(tabPaths()).toEqual(['/vault/a.md', '/vault/c.md', '/vault/b.md']);
    expect(openedPath()).toBe('/vault/c.md');

    act(() => deliver?.({ path: '/vault/b.md' }));
    expect(tabPaths()).toHaveLength(3);
    expect(openedPath()).toBe('/vault/b.md');
    expect(useTabsStore.getState().tabs.at(-1)?.id).toBe(useTabsStore.getState().activeId);
  });

  it('says why a link could not open', () => {
    mount('/files');
    act(() => deliver?.({ error: 'Library/x.md is not a file in an opened folder.' }));
    expect(toast.error).toHaveBeenCalledWith('Library/x.md is not a file in an opened folder.');
  });
});
