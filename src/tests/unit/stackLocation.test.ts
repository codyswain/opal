import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aloneLocation,
  fileLocation,
  filesLocationKey,
  locationPath,
  normalizeFilesLocation,
  parseFilesLocation,
  remapFilesLocation,
  serializeFilesLocation,
  stackLocation,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { locationName, tabLabels } from '@/renderer/features/disk-explorer/components/tabLabels';
import {
  canonical,
  remapTabsState,
  restoredStackView,
  selectOpenedPath,
  tabFile,
  useTabsStore,
  type TabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { selectViewedPath, useStackStore } from '@/renderer/features/disk-explorer/store/stackStore';
import { useDaySidebarStore } from '@/renderer/features/day-sidebar/store/daySidebarStore';
import { shownDay } from '@/renderer/features/day-sidebar/dayRule';
import { writePref } from '@/renderer/shared/prefs/prefs';
import { openTabs, resetTabs, tabId } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const TODAY = '/Vault/Library/daily/2026-10-29.md';
const OCT_25 = '/Vault/Library/daily/2026-10-25.md';
const NOTE = '/Vault/Notes/brief.md';

beforeEach(() => {
  window.localStorage.clear();
  resetTabs();
  useStackStore.setState({ live: {}, viewed: null, reveal: null, move: null });
  useDaySidebarStore.setState({ pickedDay: null, lastDay: null, seenPath: null });
});

describe('stack locations', () => {
  it('round-trip through the URL, and differ from the same file alone', () => {
    const stack = stackLocation('daily', TODAY);
    const search = serializeFilesLocation(stack);
    expect(search).toBe(`?mode=stack&kind=daily&file=${encodeURIComponent(TODAY)}`);
    expect(parseFilesLocation(search, [ROOT])).toEqual(stack);
    expect(parseFilesLocation(serializeFilesLocation(aloneLocation(TODAY)), [ROOT])).toEqual(aloneLocation(TODAY));
    expect(new Set([filesLocationKey(stack), filesLocationKey(fileLocation(TODAY)), filesLocationKey(aloneLocation(TODAY))]).size).toBe(3);
    expect(locationPath(stack)).toBe(TODAY);
  });

  it('refuses unknown kinds and heads outside the opened folders', () => {
    expect(parseFilesLocation(`?mode=stack&kind=folder&file=${encodeURIComponent(TODAY)}`, [ROOT])).toBeNull();
    expect(parseFilesLocation(`?mode=stack&kind=daily&file=${encodeURIComponent('/Elsewhere/2026-10-29.md')}`, [ROOT])).toBeNull();
    expect(normalizeFilesLocation(stackLocation('daily', '/Vault/Library/daily/../daily/2026-10-29.md'), [ROOT])).toEqual(stackLocation('daily', TODAY));
  });

  it('follow a rename of the head', () => {
    expect(remapFilesLocation(stackLocation('daily', TODAY), '/Vault/Library', '/Vault/Archive')).toEqual(
      stackLocation('daily', '/Vault/Archive/daily/2026-10-29.md'),
    );
  });

  it('keep "alone" only on a stack head, so each place has one key', () => {
    expect(canonical(aloneLocation(NOTE))).toEqual(fileLocation(NOTE));
    // Daily pages are never upgraded by path: opened from anywhere but Today, they open alone.
    expect(canonical(fileLocation(TODAY))).toEqual(fileLocation(TODAY));
    expect(canonical(stackLocation('daily', TODAY))).toEqual(stackLocation('daily', TODAY));
  });

  it('turn every plain open of a recording summary or a thread card into its page, and keep "alone" there', () => {
    const recording = '/Vault/Library/recordings/2026-10-26 0930 Josh x Lucas (Meet).md';
    const transcript = '/Vault/Library/recordings/transcripts/2026-10-26 0930 Josh x Lucas (Meet) transcript.md';
    const card = '/Vault/Library/chats/sf-site-one.md';
    const session = '/Vault/Library/chats/sf-site-one/2026-10-21-claude-f30001cd.md';
    expect(canonical(fileLocation(recording))).toEqual(stackLocation('recording', recording));
    expect(canonical(aloneLocation(recording))).toEqual(aloneLocation(recording));
    expect(canonical(fileLocation(transcript))).toEqual(fileLocation(transcript));
    expect(canonical(fileLocation(card))).toEqual(stackLocation('chat', card));
    expect(canonical(aloneLocation(session))).toEqual(fileLocation(session));
    // A plain open, as from the tree, a link or the right sidebar, shows the page.
    useTabsStore.getState().open(fileLocation(recording));
    expect(tabFile(useTabsStore.getState().tabs[0])).toBe(recording);
    expect(useTabsStore.getState().tabs[0].history[0].location).toEqual(stackLocation('recording', recording));
    expect(locationName(stackLocation('recording', recording))).toBe('2026-10-26 0930 Josh x Lucas (Meet)');
    expect(locationName(stackLocation('chat', card))).toBe('sf-site-one');
  });

  it('name Today’s stream "Today" while its head is today, and by its date after', () => {
    expect(locationName(stackLocation('daily', TODAY), '2026-10-29')).toBe('Today');
    expect(locationName(stackLocation('daily', TODAY), '2026-10-30')).toBe('2026-10-29');
    expect(locationName(fileLocation(TODAY), '2026-10-29')).toBe('2026-10-29');
    expect(tabLabels([stackLocation('daily', OCT_25), fileLocation(OCT_25)], [ROOT]).map((label) => label.name)).toEqual(['2026-10-25', '2026-10-25']);
  });
});

describe('stack entries in tabs', () => {
  const state = () => useTabsStore.getState();

  it('show the head as the tab’s file, so the tree, Recent and Cmd+N follow it', () => {
    openTabs([stackLocation('daily', TODAY)]);
    expect(tabFile(state().tabs[0])).toBe(TODAY);
    expect(selectOpenedPath(state())).toBe(TODAY);
  });

  it('save a place by section, never as a plain scroll, and refuse a bad one', () => {
    openTabs([stackLocation('daily', TODAY)]);
    state().saveView(tabId(0), 0, { scrollTop: 900 });
    expect(state().tabs[0].history[0]).toEqual({ location: stackLocation('daily', TODAY) });
    state().saveView(tabId(0), 0, { stack: { anchor: OCT_25, offset: 120 } });
    expect(state().tabs[0].history[0].stack).toEqual({ anchor: OCT_25, offset: 120 });
    state().saveView(tabId(0), 0, { stack: { anchor: 'relative.md', offset: 5 } });
    state().saveView(tabId(0), 0, { stack: { anchor: OCT_25, offset: Number.NaN } });
    state().saveView(tabId(0), 0, { stack: { anchor: OCT_25, offset: 2e6 } });
    expect(state().tabs[0].history[0].stack).toEqual({ anchor: OCT_25, offset: 120 });
  });

  it('come back on relaunch with their place, and drop corrupt ones', async () => {
    writePref('tabs.session', {
      date: '2026-10-29',
      active: 0,
      tabs: [
        {
          index: 2,
          history: [
            { location: { mode: 'stack', kind: 'daily', file: TODAY }, stack: { anchor: OCT_25, offset: 40 } },
            { location: { mode: 'stack', kind: 'folder', file: TODAY } },
            { location: { mode: 'stack', kind: 'daily', file: TODAY }, stack: { anchor: OCT_25, offset: -3 } },
            { location: { mode: 'focus', file: TODAY, alone: true } },
          ],
        },
      ],
    });
    vi.resetModules();
    const restored: TabsStore = (await import('@/renderer/features/disk-explorer/store/tabsStore')).useTabsStore.getState();
    expect(restored.tabs[0].history).toEqual([
      { location: stackLocation('daily', TODAY), stack: { anchor: OCT_25, offset: 40 } },
      { location: stackLocation('daily', TODAY) },
      { location: fileLocation(TODAY) },
    ]);
    expect(restored.tabs[0].index).toBe(2);
    expect(restoredStackView({ anchor: OCT_25, offset: 1e7 })).toBeNull();
    // The line inside the section comes back too; a bad one is dropped on its own.
    expect(restoredStackView({ anchor: OCT_25, offset: 300, line: { pos: 120, into: 6.5 } })).toEqual({ anchor: OCT_25, offset: 300, line: { pos: 120, into: 6.5 } });
    expect(restoredStackView({ anchor: OCT_25, offset: 300, line: { pos: 1.5, into: 6 } })).toEqual({ anchor: OCT_25, offset: 300 });
  });

  it('remap a saved anchor when its file moves', () => {
    openTabs([stackLocation('daily', TODAY)]);
    state().saveView(tabId(0), 0, { stack: { anchor: OCT_25, offset: 10 } });
    const moved = remapTabsState(state(), { kind: 'move', oldPath: OCT_25, newPath: '/Vault/Archive/2026-10-25.md' });
    expect(moved.tabs[0].history[0].stack).toEqual({ anchor: '/Vault/Archive/2026-10-25.md', offset: 10 });
  });
});

describe('the right sidebar’s day in a stream', () => {
  it('follows the page at the top of the stream, and only for the active tab', () => {
    openTabs([stackLocation('daily', TODAY), fileLocation(NOTE)]);
    const stream = tabId(0);
    expect(useDaySidebarStore.getState().seenPath).toBe(TODAY);
    useStackStore.getState().setViewed(stream, OCT_25);
    expect(selectViewedPath(useStackStore.getState(), useTabsStore.getState())).toBe(OCT_25);
    expect(useDaySidebarStore.getState().seenPath).toBe(OCT_25);
    expect(shownDay(useDaySidebarStore.getState(), OCT_25, '2026-10-29')).toBe('2026-10-25');
    // Another tab shows its own page; the stream's viewed page does not leak into it.
    useTabsStore.getState().activate(tabId(1));
    expect(selectViewedPath(useStackStore.getState(), useTabsStore.getState())).toBeNull();
    expect(useDaySidebarStore.getState().seenPath).toBe(NOTE);
    // The note has no date, so the sidebar keeps the day it showed.
    expect(useDaySidebarStore.getState().lastDay).toBe('2026-10-25');
  });

  it('lets scrolling to another day clear a day picked with the arrows, as opening a page does', () => {
    openTabs([stackLocation('daily', TODAY)]);
    useDaySidebarStore.getState().pickDay('2026-10-20');
    expect(useDaySidebarStore.getState().pickedDay).toBe('2026-10-20');
    useStackStore.getState().setViewed(tabId(0), OCT_25);
    expect(useDaySidebarStore.getState().pickedDay).toBeNull();
    expect(shownDay(useDaySidebarStore.getState(), OCT_25, '2026-10-29')).toBe('2026-10-25');
  });

  it('goes back to the open page when the stack unmounts', () => {
    openTabs([stackLocation('daily', TODAY)]);
    useStackStore.getState().setViewed(tabId(0), OCT_25);
    useStackStore.getState().setViewed(tabId(0), null);
    expect(useDaySidebarStore.getState().seenPath).toBe(TODAY);
  });
});
