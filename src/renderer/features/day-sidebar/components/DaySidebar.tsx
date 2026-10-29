import * as React from 'react';
import { ChevronLeft, ChevronRight, Ellipsis, PanelRight } from 'lucide-react';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { focusFile } from '@/renderer/features/disk-explorer/navigation';
import {
  selectOpenedPath,
  useTabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import type { DayLogEntry, VaultDay } from '@/types/day';
import { addDays, dayName, pageDate, relativeDayName, shortDayName, shownDay, weekdayName } from '../dayRule';
import { useDay, useToday } from '../hooks/useDay';
import { useScrollFade } from '../hooks/useScrollFade';
import {
  DAY_SECTIONS,
  DAY_SECTION_TITLES,
  toggleDaySidebar,
  useDaySidebarStore,
  type DaySection,
} from '../store/daySidebarStore';
import { ChatRow } from './ChatRow';
import { CardFoot, DayCard, EmptyDayCard, FootButton } from './DayCard';
import { DaySidebarContext, useDaySidebarContext, vaultRelative, wantsNewTab } from './daySidebarContext';
import { DigestGroup, digestGroupLabel } from './DigestGroup';
import { HourGroup, LogEntry } from './LogEntry';
import { RecordingRow } from './RecordingRow';

/** What each card shows at rest; "Show N more" shows the rest. */
export const AT_REST = { activity: 3, chats: 3, recordings: 4, digest: 3 } as const;
/** Past this many entries the full log folds by hour. */
const FLAT_LOG_LIMIT = 40;
/** Below this width the header drops the weekday: "Oct 28 Yesterday". */
const WEEKDAY_FROM = 280;

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** Entries grouped by the hour they were written, newest hour first. */
function byHour(entries: readonly DayLogEntry[]): { hour: string; entries: DayLogEntry[] }[] {
  const groups: { hour: string; entries: DayLogEntry[] }[] = [];
  for (const entry of entries) {
    const hour = entry.time.slice(0, 2);
    const last = groups[groups.length - 1];
    if (last?.hour === hour) last.entries.push(entry);
    else groups.push({ hour, entries: [entry] });
  }
  return groups;
}

/** A key per entry that survives new lines arriving above it; a repeated line counts its copies. */
function entryKeys(entries: readonly DayLogEntry[]): Map<DayLogEntry, string> {
  const seen = new Map<string, number>();
  return new Map(
    entries.map((entry) => {
      const base = `${entry.time}|${entry.text}`;
      const copy = seen.get(base) ?? 0;
      seen.set(base, copy + 1);
      return [entry, `${base}|${copy}`];
    }),
  );
}

function useOpenSet() {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggle = React.useCallback(
    (key: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  return [open, toggle] as const;
}

interface CardProps {
  day: VaultDay;
  more: boolean;
  onMore: () => void;
}

function ActivityCard({ day, more, onMore }: CardProps) {
  const { openPath, root } = useDaySidebarContext();
  const collapsed = useDaySidebarStore((state) => state.collapsed.activity);
  const toggleCollapsed = useDaySidebarStore((state) => state.toggleCollapsed);
  const [open, toggleOpen] = useOpenSet();
  const [hours, toggleHour] = useOpenSet();
  const entries = day.entries;
  const keys = React.useMemo(() => entryKeys(entries), [entries]);
  if (entries.length === 0) return <EmptyDayCard title={DAY_SECTION_TITLES.activity} line="Nothing logged" />;

  const count = entries.length;
  const entryView = (entry: DayLogEntry) => {
    const key = keys.get(entry) ?? entry.time;
    return <LogEntry key={key} entry={entry} open={open.has(key)} onToggle={() => toggleOpen(key)} />;
  };
  let body: React.ReactNode;
  if (!more) {
    body = entries.slice(0, AT_REST.activity).map(entryView);
  } else if (count > FLAT_LOG_LIMIT) {
    body = (
      <>
        <div className="px-2 pb-0.5 pt-0.5 text-control font-medium text-foreground-tertiary">
          {plural(count, 'entry', 'entries')} by hour
        </div>
        {byHour(entries).map((group) => {
          const views = group.entries.map(entryView);
          if (group.entries.length <= 2) return views;
          const key = `${day.date}-${group.hour}`;
          return (
            <HourGroup key={key} hour={group.hour} entries={group.entries} open={hours.has(key)} onToggle={() => toggleHour(key)}>
              {views}
            </HourGroup>
          );
        })}
      </>
    );
  } else {
    body = entries.map(entryView);
  }
  const log = day.log;
  return (
    <DayCard
      id="activity"
      title={DAY_SECTION_TITLES.activity}
      value={count.toLocaleString()}
      summary={`${plural(count, 'entry', 'entries')}, last ${entries[0].time}`}
      collapsed={collapsed}
      onToggle={() => toggleCollapsed('activity')}
    >
      {body}
      <CardFoot>
        {count > AT_REST.activity ? (
          <FootButton
            aria-expanded={more}
            title={more ? 'Show the latest 3' : `Show all ${count} entries`}
            onClick={onMore}
          >
            {more ? 'Show fewer' : `Show ${(count - AT_REST.activity).toLocaleString()} more`}
          </FootButton>
        ) : null}
        {log ? (
          <FootButton
            className="ml-auto"
            title={`Opens ${vaultRelative(root, log)} in this tab, read-only. Cmd-click opens a new tab.`}
            onClick={(event) => openPath(log, event)}
            onAuxClick={(event) => event.button === 1 && openPath(log, event)}
          >
            Open full log
          </FootButton>
        ) : null}
      </CardFoot>
    </DayCard>
  );
}

function ChatsCard({ day, more, onMore }: CardProps) {
  const collapsed = useDaySidebarStore((state) => state.collapsed.chats);
  const toggleCollapsed = useDaySidebarStore((state) => state.toggleCollapsed);
  const count = day.chats.length;
  if (count === 0) return <EmptyDayCard title={DAY_SECTION_TITLES.chats} line="No chats" />;
  const fresh = day.chats.filter((chat) => chat.isNew).length;
  const shown = more ? day.chats : day.chats.slice(0, AT_REST.chats);
  return (
    <DayCard
      id="chats"
      title={DAY_SECTION_TITLES.chats}
      value={fresh ? `${fresh} new · ${count.toLocaleString()}` : count.toLocaleString()}
      summary={`${fresh} new, ${count - fresh} updated`}
      collapsed={collapsed}
      onToggle={() => toggleCollapsed('chats')}
    >
      {shown.map((chat) => (
        <ChatRow key={chat.path} chat={chat} />
      ))}
      {count > AT_REST.chats ? (
        <CardFoot>
          <FootButton aria-expanded={more} onClick={onMore}>{more ? 'Show fewer' : `Show ${count - AT_REST.chats} more`}</FootButton>
        </CardFoot>
      ) : null}
    </DayCard>
  );
}

function RecordingsCard({ day, more, onMore }: CardProps) {
  const collapsed = useDaySidebarStore((state) => state.collapsed.recordings);
  const toggleCollapsed = useDaySidebarStore((state) => state.toggleCollapsed);
  const [open, toggleOpen] = useOpenSet();
  const count = day.recordings.length;
  if (count === 0) return <EmptyDayCard title={DAY_SECTION_TITLES.recordings} line="No recordings" />;
  const minutes = day.recordings.reduce((sum, recording) => sum + (recording.durationMin ?? 0), 0);
  const shown = more ? day.recordings : day.recordings.slice(0, AT_REST.recordings);
  return (
    <DayCard
      id="recordings"
      title={DAY_SECTION_TITLES.recordings}
      value={count.toLocaleString()}
      summary={`${plural(count, 'recording', 'recordings')}, ${minutes} min`}
      collapsed={collapsed}
      onToggle={() => toggleCollapsed('recordings')}
    >
      {shown.map((recording) => (
        <RecordingRow
          key={recording.path}
          recording={recording}
          open={open.has(recording.path)}
          onToggle={() => toggleOpen(recording.path)}
        />
      ))}
      {count > AT_REST.recordings ? (
        <CardFoot>
          <FootButton aria-expanded={more} onClick={onMore}>{more ? 'Show fewer' : `Show ${count - AT_REST.recordings} more`}</FootButton>
        </CardFoot>
      ) : null}
    </DayCard>
  );
}

function DigestCard({ day, more, onMore }: CardProps) {
  const { openPath, root } = useDaySidebarContext();
  const collapsed = useDaySidebarStore((state) => state.collapsed.digest);
  const toggleCollapsed = useDaySidebarStore((state) => state.toggleCollapsed);
  const digest = day.digest;
  if (!digest) return <EmptyDayCard title={DAY_SECTION_TITLES.digest} line="No digest" />;
  const file = vaultRelative(root, digest.path);
  const open = (event: React.MouseEvent) => openPath(digest.path, event);
  const total = digest.groups.reduce((sum, group) => sum + group.items.length, 0);
  const first = digest.groups[0];
  const shownGroups = more || !first ? digest.groups : [{ ...first, items: first.items.slice(0, AT_REST.digest) }];
  const shown = shownGroups.reduce((sum, group) => sum + group.items.length, 0);
  const lead = !first
    ? 'No items'
    : first.level === 'top'
      ? digestGroupLabel('top')
      : `${first.items.length} ${digestGroupLabel(first.level).toLowerCase()}`;
  const rest = first ? total - first.items.length : 0;
  return (
    <DayCard
      id="digest"
      title={DAY_SECTION_TITLES.digest}
      value={total.toLocaleString()}
      summary={rest ? `${lead}, ${rest} more` : lead}
      collapsed={collapsed}
      onToggle={() => toggleCollapsed('digest')}
    >
      {shownGroups.map((group) => (
        <DigestGroup key={group.level} level={group.level} items={group.items} file={file} onOpen={open} />
      ))}
      <CardFoot>
        {total > shown || more ? (
          <FootButton aria-expanded={more} onClick={onMore}>{more ? 'Show fewer' : `Show ${total - shown} more`}</FootButton>
        ) : null}
        <FootButton
          className="ml-auto"
          title={`Opens ${file} in this tab. Cmd-click opens a new tab.`}
          onClick={open}
          onAuxClick={(event) => event.button === 1 && open(event)}
        >
          Open digest
        </FootButton>
      </CardFoot>
    </DayCard>
  );
}

const CARDS: Record<DaySection, React.ComponentType<CardProps>> = {
  activity: ActivityCard,
  chats: ChatsCard,
  recordings: RecordingsCard,
  digest: DigestCard,
};

function Note({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div title={title} className="px-[13px] pt-0.5 text-control text-foreground-tertiary">
      {children}
    </div>
  );
}

function NoteButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="rounded-sm font-medium text-foreground-secondary underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-focus"
      {...props}
    />
  );
}

/** The day's cards, or one line when there is nothing to show. Show N more resets with the day. */
function DayCards({ date, day, today }: { date: string; day: VaultDay; today: string }) {
  const sections = useDaySidebarStore((state) => state.sections);
  const [more, toggleMore] = useOpenSet();
  const nothing = day.entries.length === 0 && day.chats.length === 0 && day.recordings.length === 0 && !day.digest;
  if (nothing) {
    return date === today ? (
      <Note title="Entries appear as chats, hooks and routines write to today's log.">Nothing yet today.</Note>
    ) : (
      <Note>Nothing recorded on {dayName(date)}.</Note>
    );
  }
  const shown = DAY_SECTIONS.filter((section) => sections[section]);
  if (shown.length === 0) return <Note>Every section is hidden. Choose sections in the options menu.</Note>;
  return (
    <>
      {shown.map((section) => {
        const Card = CARDS[section];
        return <Card key={section} day={day} more={more.has(section)} onMore={() => toggleMore(section)} />;
      })}
    </>
  );
}

interface DaySidebarProps {
  /** The sidebar's width, which decides whether the weekday fits. */
  width: number;
}

/**
 * The right sidebar: one day of the vault beside the page. Its header holds
 * the day, previous and next day, the options menu and the toggle. A column
 * of cards below shows the day's activity log, chats, recordings and digest,
 * and reads again when any of them change on disk.
 */
export function DaySidebar({ width }: DaySidebarProps) {
  const { navigateFiles } = useShell();
  const today = useToday();
  const openedPath = useTabsStore(selectOpenedPath);
  const pickedDay = useDaySidebarStore((state) => state.pickedDay);
  const lastDay = useDaySidebarStore((state) => state.lastDay);
  const sections = useDaySidebarStore((state) => state.sections);
  const toggleSection = useDaySidebarStore((state) => state.toggleSection);
  const pickDay = useDaySidebarStore((state) => state.pickDay);
  const followPage = useDaySidebarStore((state) => state.followPage);
  const date = shownDay({ pickedDay, lastDay }, openedPath, today);
  const state = useDay(date);
  const column = React.useRef<HTMLDivElement>(null);
  useScrollFade(column);

  const openPath = React.useCallback(
    (path: string, event: React.MouseEvent) => {
      recordOpened(path);
      navigateFiles(focusFile(path), { newTab: wantsNewTab(event) });
    },
    [navigateFiles],
  );
  const context = React.useMemo(
    () => ({ root: state.status === 'ready' ? state.root : '', openPath }),
    [openPath, state],
  );

  const relative = relativeDayName(date, today);
  const roomy = width >= WEEKDAY_FROM;
  const pageDay = pageDate(openedPath);
  const isToday = date === today;

  return (
    <aside
      id="day-sidebar"
      data-testid="day-sidebar"
      aria-label="Day"
      className="flex h-full min-h-0 w-full flex-col bg-chrome text-foreground"
    >
      <div className="drag-handle flex h-header shrink-0 items-center px-2">
        <div
          title={`The sidebar shows ${dayName(date)}`}
          className={cn(
            'ml-[13px] flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap',
            roomy ? 'mr-2' : 'mr-0.5',
          )}
        >
          <span className="font-medium text-foreground">
            {roomy ? `${weekdayName(date)}, ` : ''}
            {shortDayName(date)}
          </span>
          {relative ? <span className="text-foreground-tertiary">{relative}</span> : null}
        </div>
        <div className="no-drag ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label="Previous day" onClick={() => pickDay(addDays(date, -1))}>
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </IconButton>
          <IconButton label="Next day" disabled={date >= today} onClick={() => pickDay(addDays(date, 1))}>
            <ChevronRight aria-hidden className="h-4 w-4" />
          </IconButton>
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="Sidebar options">
                <Ellipsis aria-hidden className="h-4 w-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end" className="w-[216px]">
              <MenuLabel>Show in this sidebar</MenuLabel>
              {DAY_SECTIONS.map((section) => (
                <MenuCheckboxItem
                  key={section}
                  checked={sections[section]}
                  onCheckedChange={() => toggleSection(section)}
                  // The menu stays open so several sections can change at once.
                  onSelect={(event) => event.preventDefault()}
                >
                  {DAY_SECTION_TITLES[section]}
                </MenuCheckboxItem>
              ))}
              <MenuSeparator />
              <MenuItem inset disabled={isToday} onSelect={() => pickDay(today)}>
                Go to today
              </MenuItem>
            </MenuContent>
          </Menu>
          <IconButton
            label="Hide right sidebar"
            shortcut="⌘⇧\"
            aria-controls="day-sidebar"
            aria-expanded
            onClick={() => toggleDaySidebar()}
          >
            <PanelRight aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div
        ref={column}
        className="day-column scrollbar-on-hover flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      >
        {pickedDay && pageDay && pickedDay !== pageDay ? (
          <Note>
            The open page is from {shortDayName(pageDay)}.{' '}
            <NoteButton onClick={followPage}>Show {shortDayName(pageDay)}</NoteButton>
          </Note>
        ) : null}
        {state.status === 'no-vault' ? <Note>Open your vault folder to see its days.</Note> : null}
        {state.status === 'error' ? <Note>{state.error}</Note> : null}
        {state.status === 'ready' ? (
          <DaySidebarContext.Provider value={context}>
            <DayCards key={date} date={date} day={state.day} today={today} />
          </DaySidebarContext.Provider>
        ) : null}
      </div>
    </aside>
  );
}
