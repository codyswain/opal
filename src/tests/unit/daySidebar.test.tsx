import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DAY_SIDEBAR_PREFERENCE_KEY,
  DEFAULT_DAY_SIDEBAR_PREFERENCES,
  DaySidebar,
  afterDayPicked,
  afterPageOpened,
  dailyPageDate,
  daySidebarShown,
  daySidebarWidth,
  pageDate,
  sanitizeDaySidebarPreferences,
  shownDay,
  toggleDaySidebar,
  useDaySidebarStore,
} from '@/renderer/features/day-sidebar';
import { DEFAULT_SHELL_PREFERENCES, ShellProvider, useShellStore } from '@/renderer/features/shell';
import { TooltipProvider } from '@/renderer/shared/ui';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import type { DayChat, DayDigestItem, DayLogEntry, VaultDay, VaultDayChange } from '@/types/day';
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

/** An item from a digest written before checkboxes. */
const oldItem = (text: string, replyDrafted = false): DayDigestItem => ({ text, detail: null, replyDrafted, checked: null, at: null });

/** A checkbox item on `line` of the digest's body. */
const box = (line: number, text: string, detail: string | null, checked = false, replyDrafted = false): DayDigestItem => ({
  text,
  detail,
  replyDrafted,
  checked,
  at: { line, raw: `- [${checked ? 'x' : ' '}] **${text}**` },
});

const chat = (slug: string, title: string, last: string, extra: Partial<DayChat> = {}): DayChat => ({
  path: `${ROOT}/Library/chats/${slug}.md`,
  title,
  status: 'active',
  tool: 'claude',
  isNew: false,
  created: null,
  last,
  prompts: 1,
  ...extra,
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
    documents: [
      { path: `${ROOT}/Library/parametric/fedex.md`, label: 'FedEx dataset note', last: '22:54' },
      ...['21:30', '20:30', '19:30', '18:30', '17:30', '16:30', '15:30'].map((last, index) => ({
        path: `${ROOT}/Library/notes/note-${index}.md`,
        label: `Note ${index + 1}`,
        last,
      })),
      { path: `${ROOT}/Library/parametric/briefs/gob-deck.pptx`, label: 'Gob deck', last: '09:10' },
    ],
    chats: [
      chat('model-training', 'Model Training', '23:31', { created: '2026-10-20 10:00', prompts: 4 }),
      chat('opal-status', 'Opal status', '23:07', { isNew: true, created: '2026-10-28 20:00', prompts: 9 }),
      chat('bit-shell', 'Bit0.2 Shell', '22:12', { tool: 'codex' }),
      ...['21:00', '20:00', '19:00', '18:00', '17:00'].map((last, index) => chat(`thread-${index}`, `Thread ${index + 1}`, last)),
      chat('old', 'Old thread', '09:00', { status: 'archived', tool: null, prompts: 0 }),
      chat('older', 'Older thread', '08:00'),
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
    people: [
      { path: `${ROOT}/Library/people/Lucas Czajka.md`, label: 'Lucas Czajka', last: '11:15' },
      { path: `${ROOT}/Library/people/John Newsom.md`, label: 'John', last: '08:00' },
    ],
    digest: {
      path: DIGEST,
      title: 'Digest',
      groups: [
        {
          level: 'top',
          items: [
            oldItem('Central processes the Oct 30 payroll at 2:00 PM today.'),
            oldItem('AWS ALB authentication certificates are due today.', true),
            oldItem('Reply to Sol about the Brex request.'),
          ],
        },
        { level: 'high', items: [oldItem('Check the SF nest rack.')] },
        { level: 'low', items: [oldItem('Read the blog draft.')] },
      ],
      sections: [],
    },
  };
}

const empty = (date: string): VaultDay => ({ date, daily: null, log: null, entries: [], documents: [], chats: [], recordings: [], people: [], digest: null });

let days: Record<string, VaultDay>;
let changed: ((change: VaultDayChange) => void) | null;

function installVaultApi() {
  changed = null;
  const api: VaultAPI = {
    discover: vi.fn(async () => ({ success: true as const, data: [{ path: ROOT, name: 'Vault' }] })),
    createDay: vi.fn(async () => ({ success: true as const, data: { path: DAILY } })),
    day: vi.fn(async (_root: string, date: string) => ({ success: true as const, data: days[date] ?? empty(date) })),
    stack: vi.fn(async () => ({ success: false as const, error: 'No stacks here.' })),
    checkDigestItem: vi.fn(async (_root: string, _path: string, line: number, raw: string, checked: boolean) => ({
      success: true as const,
      data: { line, raw: raw.replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]'), checked },
    })),
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
  useDaySidebarStore.setState({ ...DEFAULT_DAY_SIDEBAR_PREFERENCES, pickedDay: null, lastDay: null, seenPath: null, narrowOpen: false });
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
    expect(pageDate(`${ROOT}/Library/recordings/transcripts/2026-10-27 0859 Kigali (Meet) transcript.md`)).toBe('2026-10-27');
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
    const today = '2026-10-29';
    expect(afterPageOpened({ pickedDay: null, lastDay: null }, null, TASTE, today)).toEqual({ pickedDay: null, lastDay: null });
    expect(afterPageOpened({ pickedDay: null, lastDay: null }, DAILY, TASTE, today)).toEqual({ pickedDay: null, lastDay: '2026-10-28' });
    expect(afterPageOpened({ pickedDay: '2026-10-25', lastDay: null }, DAILY, TASTE, today)).toEqual({ pickedDay: null, lastDay: '2026-10-25' });
    expect(afterPageOpened({ pickedDay: '2026-10-25', lastDay: null }, TASTE, LOG, today)).toEqual({ pickedDay: null, lastDay: '2026-10-28' });
    // Today's page keeps no day, so the sidebar follows today.
    expect(afterPageOpened({ pickedDay: null, lastDay: null }, `${ROOT}/Library/daily/${today}.md`, TASTE, today)).toEqual({ pickedDay: null, lastDay: null });
  });

  it('moves on at midnight on an undated page opened from today’s page', () => {
    vi.setSystemTime(new Date(2026, 9, 29, 23, 59));
    openTabs([`${ROOT}/Library/daily/2026-10-29.md`]);
    openTabs([TASTE]);
    const state = useDaySidebarStore.getState();
    expect(shownDay(state, openedPath(), '2026-10-29')).toBe('2026-10-29');
    expect(shownDay(state, openedPath(), '2026-10-30')).toBe('2026-10-30');
  });

  it('reads the day Today opens from daily pages only', () => {
    expect(dailyPageDate(DAILY)).toBe('2026-10-28');
    expect(dailyPageDate(`${ROOT}/Inbox/Logs/2026-10-27.md`)).toBe('2026-10-27');
    expect(dailyPageDate(LOG)).toBeNull();
    expect(dailyPageDate(DIGEST)).toBeNull();
    expect(dailyPageDate(`${ROOT}/Library/daily/2026-02-30.md`)).toBeNull();
    expect(dailyPageDate(null)).toBeNull();
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
      sections: { activity: true, documents: true, chats: false, recordings: true, people: true, digest: true },
      collapsed: { activity: false, documents: false, chats: false, recordings: false, people: false, digest: true },
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

  it('gives way to the left sidebar below 1120px, and opening it there closes the left one', () => {
    const open = { open: true, narrowOpen: false };
    expect(daySidebarShown(open, true, false, 1440)).toBe(true);
    expect(daySidebarShown(open, true, false, 1120)).toBe(true);
    expect(daySidebarShown(open, true, false, 1100)).toBe(false);
    expect(daySidebarShown(open, false, false, 1100)).toBe(true);

    useShellStore.setState({ sidebarOpen: true });
    toggleDaySidebar(1100);
    expect(useDaySidebarStore.getState().open).toBe(true);
    expect(useShellStore.getState().sidebarOpen).toBe(false);
    toggleDaySidebar(1100);
    expect(useDaySidebarStore.getState().open).toBe(false);
    useShellStore.setState({ sidebarOpen: true });
    toggleDaySidebar(1440);
    expect(useShellStore.getState().sidebarOpen).toBe(true);
  });

  it('is an overlay in the narrow layout that shows only while asked for, one overlay at a time', () => {
    expect(daySidebarShown({ open: true, narrowOpen: false }, false, true, 700)).toBe(false);
    expect(daySidebarShown({ open: false, narrowOpen: true }, false, true, 700)).toBe(true);

    useShellStore.setState({ narrowLayout: true, narrowSidebarOpen: true });
    toggleDaySidebar(700);
    expect(useDaySidebarStore.getState().narrowOpen).toBe(true);
    expect(useShellStore.getState().narrowSidebarOpen).toBe(false);
    // The saved open state is for wider windows, and the overlay is never saved.
    expect(useDaySidebarStore.getState().open).toBe(true);
    expect(readPref(DAY_SIDEBAR_PREFERENCE_KEY, null)).toBeNull();

    act(() => useShellStore.getState().toggleSidebar());
    expect(useDaySidebarStore.getState().narrowOpen).toBe(false);
    toggleDaySidebar(700);
    expect(useDaySidebarStore.getState().narrowOpen).toBe(true);
    act(() => useShellStore.getState().setNarrowLayout(false));
    expect(useDaySidebarStore.getState().narrowOpen).toBe(false);
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

    // Every line of the log counts, the sync line for a recording below too.
    const log = card('Activity log');
    expect(within(log).getByRole('button', { name: /^Activity log/ })).toHaveTextContent('Activity log5');
    expect(within(log).getAllByRole('button', { expanded: false }).filter((button) => /^\d\d:\d\d/.test(button.textContent ?? ''))).toHaveLength(3);
    expect(within(log).getByRole('button', { name: 'Show 2 more' })).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: 'Open full log' })).toBeInTheDocument();
    // The first link at rest is the note, not the source chat.
    expect(within(log).getByRole('button', { name: 'FedEx dataset note' })).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: '+2' })).toBeInTheDocument();

    // The digest first, then what the day touched, its chats, recordings and people, and the activity log last.
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([
      'Digest',
      'Documents',
      'Chats',
      'Recordings',
      'People',
      'Activity log',
    ]);

    const people = card('People');
    expect(within(people).getByRole('button', { name: /^People/ })).toHaveTextContent('People2');
    expect(within(people).getByRole('button', { name: /Lucas Czajka/ })).toHaveTextContent('11:15Lucas Czajka');

    const documents = card('Documents');
    expect(within(documents).getByRole('button', { name: /^Documents/ })).toHaveTextContent('Documents9');
    expect(within(documents).getByText('FedEx dataset note')).toBeInTheDocument();
    // Eight at rest, the latest touched first.
    expect(within(documents).getByText('Note 7')).toBeInTheDocument();
    expect(within(documents).queryByText('Gob deck')).toBeNull();
    expect(within(documents).getByRole('button', { name: 'Show 1 more' })).toBeInTheDocument();

    const chats = card('Chats');
    expect(within(chats).getByRole('button', { name: /^Chats/ })).toHaveTextContent('1 new · 10');
    expect(within(chats).getByText('Model Training')).toBeInTheDocument();
    expect(within(chats).getByText('New')).toBeInTheDocument();
    expect(within(chats).getByText('Codex')).toBeInTheDocument();
    // Eight at rest.
    expect(within(chats).getByText('Thread 5')).toBeInTheDocument();
    expect(within(chats).queryByText('Old thread')).toBeNull();
    expect(within(chats).getByRole('button', { name: 'Show 2 more' })).toBeInTheDocument();

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

  it('opens a document in this tab, and names a file that is not Markdown by its extension', async () => {
    const user = userEvent.setup();
    openTabs([DAILY]);
    renderSidebar();
    const documents = await screen.findByRole('region', { name: 'Documents' });
    await user.click(within(documents).getByRole('button', { name: 'Show 1 more' }));
    const deck = within(documents).getByRole('button', { name: /Gob deck/ });
    expect(deck).toHaveTextContent('09:10Gob deckpptx');
    expect(within(documents).getByRole('button', { name: /FedEx dataset note/ })).not.toHaveTextContent('md');

    await user.click(within(documents).getByText('FedEx dataset note'));
    expect(openedPath()).toBe(`${ROOT}/Library/parametric/fedex.md`);
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

  it('opens a recording page in this tab, and in a new tab on Cmd-click', async () => {
    const user = userEvent.setup();
    openTabs([DAILY]);
    renderSidebar();
    const recordings = await screen.findByRole('region', { name: 'Recordings' });
    const row = within(recordings).getByRole('button', { name: /John Cody Planning/ });
    expect(row).not.toHaveAttribute('aria-expanded');
    expect(row.title).toContain('Google Meet, no notes yet.\njohn@example.com');
    await user.click(row);
    expect(tabPaths()).toEqual([recording('13:04', 'John Cody Planning')]);

    await user.keyboard('{Meta>}');
    await user.click(within(card('Recordings')).getByRole('button', { name: /Lucas x Cody/ }));
    await user.keyboard('{/Meta}');
    expect(tabPaths()).toEqual([recording('13:04', 'John Cody Planning'), recording('11:15', 'Lucas x Cody 1-1 Synch')]);
  });

  it('shows the digest as checkboxes with their detail, and writes a tick to the digest file', async () => {
    const user = userEvent.setup();
    const LONG = 'Ask Orrick at the 2:00 monthly check-in, then reply before your PTO starts at 3:30.';
    days['2026-10-28'] = {
      ...oct28(),
      digest: {
        path: DIGEST,
        title: 'Digest',
        groups: [
          {
            level: 'top',
            items: [
              box(4, 'Answer Tom on the 409A price and early exercise', LONG, false, true),
              box(7, 'Tell Richard Hurley that Friday 2pm PT works', null, true),
            ],
          },
          { level: 'high', items: [box(12, 'Grant Sol access to the Onshape static-neck document', 'He asked on HW-196.')] },
        ],
        sections: ['Yesterday', 'Top 3', 'Also worth doing'],
      },
    };
    openTabs([DAILY]);
    const api = window.vaultAPI;
    renderSidebar();
    const digest = await screen.findByRole('region', { name: 'Digest' });
    const tom = within(digest).getByRole('checkbox', { name: 'Answer Tom on the 409A price and early exercise' });
    const rich = within(digest).getByRole('checkbox', { name: 'Tell Richard Hurley that Friday 2pm PT works' });
    expect(tom).toHaveAttribute('aria-checked', 'false');
    expect(rich).toHaveAttribute('aria-checked', 'true');
    expect(within(digest).getByText('Reply drafted')).toBeInTheDocument();

    // The detail is muted and clamped; its tooltip has all of it, and a click shows it in place.
    const detail = within(digest).getByText(LONG);
    expect(detail).toHaveClass('line-clamp-2', 'text-foreground-tertiary');
    // A long title is clamped too.
    expect(within(digest).getByText('Answer Tom on the 409A price and early exercise')).toHaveClass('line-clamp-2');
    const text = within(digest).getByRole('button', { name: /^Answer Tom/ });
    expect(text).toHaveAttribute('title', LONG);
    await user.click(text);
    expect(text).toHaveAttribute('aria-expanded', 'true');
    expect(detail).not.toHaveClass('line-clamp-2');
    // Reading the detail never ticks the box or opens the digest.
    expect(tom).toHaveAttribute('aria-checked', 'false');
    expect(tabPaths()).toEqual([DAILY]);

    await user.click(tom);
    expect(api.checkDigestItem).toHaveBeenCalledWith(ROOT, DIGEST, 4, '- [ ] **Answer Tom on the 409A price and early exercise**', true);
    await waitFor(() => expect(tom).toHaveAttribute('aria-checked', 'true'));
    // A second click before the day is read again sends the line as it is now.
    await user.click(tom);
    await waitFor(() =>
      expect(api.checkDigestItem).toHaveBeenLastCalledWith(ROOT, DIGEST, 4, '- [x] **Answer Tom on the 409A price and early exercise**', false),
    );
    await waitFor(() => expect(tom).toHaveAttribute('aria-checked', 'false'));
  });

  it('puts a tick back and says why when the main process refuses it', async () => {
    const user = userEvent.setup();
    days['2026-10-28'] = {
      ...oct28(),
      digest: { path: DIGEST, title: 'Digest', groups: [{ level: 'top', items: [box(4, 'Answer Tom', null)] }], sections: [] },
    };
    vi.mocked(installVaultApi().checkDigestItem).mockResolvedValue({
      success: false,
      error: 'This item changed in the digest since it was read.',
    });
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 0);
    openTabs([DAILY]);
    renderSidebar();
    const tom = await screen.findByRole('checkbox', { name: 'Answer Tom' });
    await user.click(tom);
    await waitFor(() => expect(error).toHaveBeenCalledWith('This item changed in the digest since it was read.'));
    expect(tom).toHaveAttribute('aria-checked', 'false');
    expect(tom).toBeEnabled();
    error.mockRestore();
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

});
