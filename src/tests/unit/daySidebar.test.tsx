import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  DAY_SIDEBAR_PREFERENCE_KEY,
  DEFAULT_DAY_SIDEBAR_PREFERENCES,
  DaySidebar,
  afterDayPicked,
  afterPageOpened,
  daySidebarShown,
  daySidebarWidth,
  pageDate,
  cardRepeats,
  sanitizeDaySidebarPreferences,
  shownDay,
  toggleDaySidebar,
  useDaySidebarStore,
} from '@/renderer/features/day-sidebar';
import { DEFAULT_SHELL_PREFERENCES, ShellProvider, useShellStore } from '@/renderer/features/shell';
import { TooltipProvider } from '@/renderer/shared/ui';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import type { DayLogEntry, VaultDay, VaultDayChange } from '@/types/day';
import type { VaultAPI } from '@/types/vault';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { openTabs, openedPath, resetTabs, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const DAILY = `${ROOT}/Library/daily/2026-10-28.md`;
const LOG = `${ROOT}/Library/logs/2026-10-28 log.md`;
const DIGEST = `${ROOT}/Library/digests/2026-10-28 digest.md`;
const TASTE = `${ROOT}/Instructions/taste.md`;
const recording = (time: string, title: string) =>
  `${ROOT}/Library/recordings/2026-10-28 ${time.replace(':', '')} ${title} (Meet).md`;

const entry = (time: string, text: string, kind: string | null, links: DayLogEntry['links'] = []): DayLogEntry => ({
  time,
  until: null,
  text,
  kind,
  links,
});

function oct28(): VaultDay {
  return {
    date: '2026-10-28',
    daily: DAILY,
    log: LOG,
    entries: [
      entry(
        '22:54',
        'Froze FedEx Medium release v1, 67 Astra-labeled episodes (10.9 h) with 4 held out, and started its PI upload.',
        'agent turn',
        [
          { label: 'Opal status', target: 'Library/chats/opal-status', external: false, path: `${ROOT}/Library/chats/opal-status.md` },
          { label: 'FedEx dataset note', target: 'Library/parametric/fedex', external: false, path: `${ROOT}/Library/parametric/fedex.md` },
          { label: 'SW-640', target: 'https://linear.app/parametricpbc/issue/SW-640', external: true, path: null },
        ],
      ),
      entry('22:05', 'Finished the Opal design for saving, sync and a phone version.', 'agent turn'),
      entry('21:48', 'Set Opal to black and white only, per Cody.', '4 connector calls'),
      entry('13:10', 'Meet sync saved John / Cody Planning.', 'routine run', [
        { label: 'Planning', target: 'Library/recordings/x', external: false, path: recording('13:04', 'John Cody Planning') },
      ]),
      entry('08:54', 'The untethered SN1 ranked first for the SF mast and tether.', null),
    ],
    chats: [
      { path: `${ROOT}/Library/chats/model-training.md`, title: 'Model Training', status: 'active', tool: 'claude', isNew: false, created: '2026-10-20 10:00', last: '23:31', prompts: 4 },
      { path: `${ROOT}/Library/chats/opal-status.md`, title: 'Opal status', status: 'active', tool: 'claude', isNew: true, created: '2026-10-28 20:00', last: '23:07', prompts: 9 },
      { path: `${ROOT}/Library/chats/bit-shell.md`, title: 'Bit0.2 Shell', status: 'active', tool: 'codex', isNew: false, created: null, last: '22:12', prompts: 1 },
      { path: `${ROOT}/Library/chats/old.md`, title: 'Old thread', status: 'archived', tool: null, isNew: false, created: null, last: '09:00', prompts: 0 },
    ],
    recordings: [
      ['13:04', 'John Cody Planning', 137],
      ['11:15', 'Lucas x Cody 1-1 Synch', 32],
      ['09:30', 'Cody Nehemie', 7],
      ['08:59', 'Meeting with all Kigali Operators', 27],
      ['08:00', 'Standup', 12],
    ].map(([time, title, minutes]) => ({
      path: recording(String(time), String(title)),
      title: String(title),
      time: String(time),
      source: 'meet',
      durationMin: Number(minutes),
      speakers: [],
      attendees: ['john@example.com'],
      hasSummary: false,
      links: [{ label: 'Notes by Gemini', target: 'https://docs.google.com/document/d/1', external: true, path: null }],
    })),
    digest: {
      path: DIGEST,
      title: 'Digest',
      groups: [
        {
          level: 'top',
          items: [
            { text: 'Central processes the Oct 30 payroll at 2:00 PM today.', replyDrafted: false },
            { text: 'AWS ALB authentication certificates are due today.', replyDrafted: true },
            { text: 'Reply to Sol about the Brex request.', replyDrafted: false },
          ],
        },
        { level: 'high', items: [{ text: 'Check the SF nest rack.', replyDrafted: false }] },
        { level: 'low', items: [{ text: 'Read the blog draft.', replyDrafted: false }] },
      ],
      sections: [],
    },
  };
}

const empty = (date: string): VaultDay => ({ date, daily: null, log: null, entries: [], chats: [], recordings: [], digest: null });

let days: Record<string, VaultDay>;
let changed: ((change: VaultDayChange) => void) | null;

function installVaultApi() {
  changed = null;
  const api: VaultAPI = {
    discover: vi.fn(async () => ({ success: true as const, data: [{ path: ROOT, name: 'Vault' }] })),
    createDay: vi.fn(async () => ({ success: true as const, data: { path: DAILY } })),
    day: vi.fn(async (_root: string, date: string) => ({ success: true as const, data: days[date] ?? empty(date) })),
    onDayChanged: vi.fn((callback: (change: VaultDayChange) => void) => {
      changed = callback;
      return () => {
        changed = null;
      };
    }),
  };
  (window as unknown as { vaultAPI: VaultAPI }).vaultAPI = api;
  return api;
}

function renderSidebar(width = 300) {
  return render(
    <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TooltipProvider>
        <ShellProvider>
          <div style={{ height: 900, width }}>
            <DaySidebar width={width} />
          </div>
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const card = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 29, 9, 0));
  window.localStorage.clear();
  installActivityApi();
  days = { '2026-10-28': oct28() };
  installVaultApi();
  resetTabs();
  useShellStore.setState({ ...DEFAULT_SHELL_PREFERENCES, narrowLayout: false, narrowSidebarOpen: false });
  useDaySidebarStore.setState({ ...DEFAULT_DAY_SIDEBAR_PREFERENCES, pickedDay: null, lastDay: null, seenPath: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the day rule', () => {
  it('reads the day from daily pages, logs, recordings and digests only', () => {
    expect(pageDate(DAILY)).toBe('2026-10-28');
    expect(pageDate(LOG)).toBe('2026-10-28');
    expect(pageDate(DIGEST)).toBe('2026-10-28');
    expect(pageDate(recording('08:59', 'Kigali'))).toBe('2026-10-28');
    expect(pageDate(`${ROOT}/Inbox/Logs/2026-10-27.md`)).toBe('2026-10-27');
    expect(pageDate(TASTE)).toBeNull();
    expect(pageDate(`${ROOT}/Archive/Journal/2026/2026-01-03.md`)).toBeNull();
    expect(pageDate(`${ROOT}/docs/2026-10-29-library-daily-and-logs.md`)).toBeNull();
    expect(pageDate(`${ROOT}/Library/daily/2026-02-30.md`)).toBeNull();
    expect(pageDate(null)).toBeNull();
  });

  it('shows a picked day, else the page’s day, else the last day, else today', () => {
    const today = '2026-10-29';
    expect(shownDay({ pickedDay: null, lastDay: null }, TASTE, today)).toBe(today);
    expect(shownDay({ pickedDay: null, lastDay: '2026-10-20' }, TASTE, today)).toBe('2026-10-20');
    expect(shownDay({ pickedDay: null, lastDay: '2026-10-20' }, DAILY, today)).toBe('2026-10-28');
    expect(shownDay({ pickedDay: '2026-10-25', lastDay: null }, DAILY, today)).toBe('2026-10-25');
  });

  it('keeps the last day across undated pages, and lets today move on when nothing set a day', () => {
    expect(afterPageOpened({ pickedDay: null, lastDay: null }, null, TASTE)).toEqual({ pickedDay: null, lastDay: null });
    expect(afterPageOpened({ pickedDay: null, lastDay: null }, DAILY, TASTE)).toEqual({ pickedDay: null, lastDay: '2026-10-28' });
    expect(afterPageOpened({ pickedDay: '2026-10-25', lastDay: null }, DAILY, TASTE)).toEqual({ pickedDay: null, lastDay: '2026-10-25' });
    expect(afterPageOpened({ pickedDay: '2026-10-25', lastDay: null }, TASTE, LOG)).toEqual({ pickedDay: null, lastDay: '2026-10-28' });
  });

  it('holds a picked day on a dated page until the page’s own day is picked again', () => {
    const today = '2026-10-29';
    expect(afterDayPicked({ pickedDay: null, lastDay: null }, DAILY, '2026-10-27', today).pickedDay).toBe('2026-10-27');
    expect(afterDayPicked({ pickedDay: '2026-10-27', lastDay: null }, DAILY, '2026-10-28', today).pickedDay).toBeNull();
    expect(afterDayPicked({ pickedDay: null, lastDay: null }, TASTE, '2026-10-27', today)).toEqual({ pickedDay: null, lastDay: '2026-10-27' });
    expect(afterDayPicked({ pickedDay: null, lastDay: '2026-10-27' }, TASTE, today, today)).toEqual({ pickedDay: null, lastDay: null });
  });

  it('follows the active tab through the store', () => {
    const shown = () => {
      const state = useDaySidebarStore.getState();
      return shownDay(state, openedPath(), '2026-10-29');
    };
    openTabs([DAILY]);
    expect(shown()).toBe('2026-10-28');
    openTabs([TASTE]);
    expect(shown()).toBe('2026-10-28');
    act(() => useDaySidebarStore.getState().pickDay('2026-10-25'));
    expect(shown()).toBe('2026-10-25');
    openTabs([LOG.replace('2026-10-28', '2026-10-27')]);
    expect(shown()).toBe('2026-10-27');
  });
});

describe('day sidebar preferences', () => {
  it('starts open with every section shown and none folded', () => {
    expect(useDaySidebarStore.getState().hydrate()).toEqual(DEFAULT_DAY_SIDEBAR_PREFERENCES);
  });

  it('remembers open state, sections, folded cards and width', () => {
    const store = useDaySidebarStore.getState();
    store.setOpen(false);
    useDaySidebarStore.getState().toggleSection('chats');
    useDaySidebarStore.getState().toggleCollapsed('digest');
    useDaySidebarStore.getState().setWidth(333);
    const saved = readPref(DAY_SIDEBAR_PREFERENCE_KEY, null);
    expect(saved).toEqual({
      open: false,
      sections: { activity: true, chats: false, recordings: true, digest: true },
      collapsed: { activity: false, chats: false, recordings: false, digest: true },
      width: 333,
    });
    useDaySidebarStore.setState(DEFAULT_DAY_SIDEBAR_PREFERENCES);
    expect(useDaySidebarStore.getState().hydrate()).toEqual(saved);
  });

  it('keeps defaults for corrupt values and clamps the width', () => {
    writePref(DAY_SIDEBAR_PREFERENCE_KEY, { open: 'yes', sections: { chats: false, digest: 3 }, collapsed: null, width: 9000 });
    expect(useDaySidebarStore.getState().hydrate()).toEqual({
      ...DEFAULT_DAY_SIDEBAR_PREFERENCES,
      sections: { ...DEFAULT_DAY_SIDEBAR_PREFERENCES.sections, chats: false },
      width: 400,
    });
    expect(sanitizeDaySidebarPreferences('nonsense')).toEqual(DEFAULT_DAY_SIDEBAR_PREFERENCES);
  });

  it('is 300px wide on wide windows and 260px below 1200px, within the dragged width', () => {
    expect(daySidebarWidth(null, 1440)).toBe(300);
    expect(daySidebarWidth(null, 1100)).toBe(260);
    expect(daySidebarWidth(380, 1440)).toBe(380);
    expect(daySidebarWidth(380, 1100)).toBe(300);
  });

  it('gives way to the left sidebar below 1000px, and opening it there closes the left one', () => {
    expect(daySidebarShown(true, true, false, 1440)).toBe(true);
    expect(daySidebarShown(true, true, false, 900)).toBe(false);
    expect(daySidebarShown(true, false, false, 900)).toBe(true);
    expect(daySidebarShown(true, true, true, 700)).toBe(true);

    useShellStore.setState({ sidebarOpen: true });
    toggleDaySidebar(900);
    expect(useDaySidebarStore.getState().open).toBe(true);
    expect(useShellStore.getState().sidebarOpen).toBe(false);
    toggleDaySidebar(900);
    expect(useDaySidebarStore.getState().open).toBe(false);
    useShellStore.setState({ sidebarOpen: true });
    toggleDaySidebar(1440);
    expect(useShellStore.getState().sidebarOpen).toBe(true);
  });
});

describe('DaySidebar', () => {
  it('shows the day with Yesterday, and each card at rest with its count', async () => {
    openTabs([DAILY]);
    renderSidebar();
    expect(await screen.findByRole('region', { name: 'Activity log' })).toBeInTheDocument();
    expect(screen.getByText('Wed, Oct 28')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();

    // The sync line repeats the recording below, so the log counts 4 and shows 3.
    const log = card('Activity log');
    expect(within(log).getByRole('button', { name: /^Activity log/ })).toHaveTextContent('Activity log4');
    expect(within(log).getAllByRole('button', { expanded: false }).filter((button) => /^\d\d:\d\d/.test(button.textContent ?? ''))).toHaveLength(3);
    expect(within(log).getByRole('button', { name: 'Show 1 more' })).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: 'Open full log' })).toBeInTheDocument();
    // The first link at rest is the note, not the source chat.
    expect(within(log).getByRole('button', { name: 'FedEx dataset note' })).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: '+2' })).toBeInTheDocument();

    const chats = card('Chats');
    expect(within(chats).getByRole('button', { name: /^Chats/ })).toHaveTextContent('1 new · 4');
    expect(within(chats).getByText('Model Training')).toBeInTheDocument();
    expect(within(chats).getByText('New')).toBeInTheDocument();
    expect(within(chats).getByText('Codex')).toBeInTheDocument();
    expect(within(chats).queryByText('Old thread')).toBeNull();
    expect(within(chats).getByRole('button', { name: 'Show 1 more' })).toBeInTheDocument();

    const recordings = card('Recordings');
    expect(within(recordings).getByText('137 min')).toBeInTheDocument();
    expect(within(recordings).queryByText('Standup')).toBeNull();
    expect(within(recordings).getByRole('button', { name: 'Show 1 more' })).toBeInTheDocument();

    const digest = card('Digest');
    expect(within(digest).getByText('Top 3')).toBeInTheDocument();
    expect(within(digest).getByText('Reply drafted')).toBeInTheDocument();
    expect(within(digest).queryByText('Check the SF nest rack.')).toBeNull();
    expect(within(digest).getByRole('button', { name: 'Show 2 more' })).toBeInTheDocument();
  });

  it('shows the rest of a card, and puts it back at rest on another day', async () => {
    const user = userEvent.setup();
    openTabs([DAILY]);
    renderSidebar();
    const digest = await screen.findByRole('region', { name: 'Digest' });
    await user.click(within(digest).getByRole('button', { name: 'Show 2 more' }));
    expect(within(digest).getByText('High priority')).toBeInTheDocument();
    expect(within(digest).getByText('Read the blog draft.')).toBeInTheDocument();
    expect(within(digest).getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();

    await user.click(within(card('Recordings')).getByRole('button', { name: 'Show 1 more' }));
    expect(within(card('Recordings')).getByText('Standup')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByText('Nothing recorded on Tue, Oct 27.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show Oct 28' }));
    expect(await screen.findByRole('region', { name: 'Digest' })).toBeInTheDocument();
    expect(within(card('Digest')).getByRole('button', { name: 'Show 2 more' })).toBeInTheDocument();
  });

  it('opens a chat, the log and the digest in this tab, and in a new tab on Cmd-click', async () => {
    const user = userEvent.setup();
    openTabs([DAILY]);
    renderSidebar();
    const chats = await screen.findByRole('region', { name: 'Chats' });
    await user.click(within(chats).getByText('Opal status'));
    expect(tabPaths()).toEqual([`${ROOT}/Library/chats/opal-status.md`]);
    // An undated page keeps the day.
    expect(screen.getByText('Wed, Oct 28')).toBeInTheDocument();

    await user.keyboard('{Meta>}');
    await user.click(within(card('Activity log')).getByRole('button', { name: 'Open full log' }));
    await user.keyboard('{/Meta}');
    expect(tabPaths()).toEqual([`${ROOT}/Library/chats/opal-status.md`, LOG]);
    expect(openedPath()).toBe(LOG);

    await user.click(within(card('Digest')).getByText('Reply to Sol about the Brex request.'));
    expect(openedPath()).toBe(DIGEST);
  });

  it('opens a log entry in place with the full sentence and every link, and Escape closes it', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    openTabs([DAILY]);
    renderSidebar();
    const log = await screen.findByRole('region', { name: 'Activity log' });
    const head = within(log).getByRole('button', { name: /^22:54/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    await user.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(within(log).getByText('Agent turn')).toBeInTheDocument();
    // Vault files are buttons with a folder; external links are links with their service.
    expect(within(log).getByRole('button', { name: /FedEx dataset note\s*parametric/ })).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: /Opal status\s*chats/ })).toBeInTheDocument();
    const external = within(log).getByRole('link', { name: /SW-640\s*Linear/ });
    expect(external).toHaveAttribute('href', 'https://linear.app/parametricpbc/issue/SW-640');
    await user.click(external);
    expect(open).toHaveBeenCalledWith('https://linear.app/parametricpbc/issue/SW-640', '_blank');
    expect(tabPaths()).toEqual([DAILY]);

    head.focus();
    await user.keyboard('{Escape}');
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(head).toHaveFocus();
    expect(within(log).queryByText('Agent turn')).toBeNull();

    await user.click(within(log).getByRole('button', { name: /^21:48/ }));
    expect(within(log).getByText('4 connector calls folded into one entry')).toBeInTheDocument();
    open.mockRestore();
  });

  it('opens a recording in place to who was there, the note and its links', async () => {
    const user = userEvent.setup();
    openTabs([DAILY]);
    renderSidebar();
    const recordings = await screen.findByRole('region', { name: 'Recordings' });
    await user.click(within(recordings).getByRole('button', { name: /John Cody Planning/ }));
    expect(within(recordings).getByText('Google Meet, no notes yet')).toBeInTheDocument();
    expect(within(recordings).getByText('john@example.com')).toBeInTheDocument();
    expect(within(recordings).getByRole('link', { name: /Notes by Gemini\s*Google Docs/ })).toBeInTheDocument();
    await user.click(within(recordings).getByRole('button', { name: /Recording note/ }));
    expect(openedPath()).toBe(recording('13:04', 'John Cody Planning'));
  });

  it('folds a card to its summary and remembers it', async () => {
    const user = userEvent.setup();
    openTabs([DAILY]);
    renderSidebar();
    const recordings = await screen.findByRole('region', { name: 'Recordings' });
    await user.click(within(recordings).getByRole('button', { name: /^Recordings/ }));
    expect(within(recordings).getByRole('button', { name: /^Recordings/ })).toHaveAttribute('aria-expanded', 'false');
    expect(within(recordings).getByText('5 recordings, 215 min')).toBeInTheDocument();
    expect(within(recordings).queryByText('137 min')).toBeNull();
    expect(readPref<{ collapsed: Record<string, boolean> } | null>(DAY_SIDEBAR_PREFERENCE_KEY, null)?.collapsed.recordings).toBe(true);
  });

  it('chooses sections from the options menu, and Go to today moves to today', async () => {
    const user = userEvent.setup();
    openTabs([DAILY]);
    renderSidebar();
    await screen.findByRole('region', { name: 'Chats' });
    await user.click(screen.getByRole('button', { name: 'Sidebar options' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Chats' }));
    expect(screen.queryByRole('region', { name: 'Chats' })).toBeNull();
    expect(useDaySidebarStore.getState().sections.chats).toBe(false);
    // The menu stays open for the next choice.
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Go to today' }));
    expect(await screen.findByText('Nothing yet today.')).toBeInTheDocument();
    expect(screen.getByText('Thu, Oct 29')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
  });

  it('reads the day again when the main process says it changed, keeping an open entry open', async () => {
    const user = userEvent.setup();
    openTabs([DAILY]);
    const api = window.vaultAPI;
    renderSidebar();
    const log = await screen.findByRole('region', { name: 'Activity log' });
    expect(api.day).toHaveBeenCalledWith(ROOT, '2026-10-28');
    await user.click(within(log).getByRole('button', { name: /^22:05/ }));
    days['2026-10-28'] = { ...oct28(), entries: [entry('23:59', 'Appended while the sidebar was open.', 'agent turn'), ...oct28().entries] };
    await waitFor(() => expect(changed).not.toBeNull());
    act(() => changed?.({ root: ROOT, date: '2026-10-28' }));
    expect(await screen.findByText('Appended while the sidebar was open.')).toBeInTheDocument();
    expect(within(card('Activity log')).getByRole('button', { name: /^22:05/ })).toHaveAttribute('aria-expanded', 'true');
    act(() => changed?.({ root: ROOT, date: '2026-10-01' }));
    expect(api.day).toHaveBeenCalledTimes(2);
  });

  it('drops the weekday when narrow, and says so when no folder is a vault', async () => {
    vi.mocked(window.vaultAPI.discover).mockResolvedValue({ success: true, data: [] });
    openTabs([DAILY]);
    renderSidebar(260);
    expect(await screen.findByText('Open your vault folder to see its days.')).toBeInTheDocument();
    expect(screen.getByText('Oct 28')).toBeInTheDocument();
  });

  it('hides a sync line only while the card it repeats is shown', () => {
    const day = oct28();
    const sync = day.entries[3];
    const sections = { activity: true, chats: true, recordings: true, digest: true };
    const repeats = cardRepeats(day, sections);
    expect(repeats(sync)).toBe(true);
    expect(cardRepeats(day, { ...sections, recordings: false })(sync)).toBe(false);
    expect(repeats(day.entries[0])).toBe(false);
    expect(repeats(entry('07:37', 'Digest: payroll and certificates due today', null))).toBe(true);
    expect(cardRepeats({ ...day, digest: null }, sections)(entry('07:37', 'Digest: payroll', null))).toBe(false);
  });
});
