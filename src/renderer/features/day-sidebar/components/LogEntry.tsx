import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';
import type { DayLogEntry } from '@/types/day';
import { sortDayLinks } from '../dayLinks';
import { RowTime } from './DayCard';
import { LinkChip, LinkList } from './DayLinks';

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** "Agent turn", or for a folded entry "4 connector calls folded into one entry, 08:55 to 09:02". Old lines have no kind. */
export function entryMeta(entry: Pick<DayLogEntry, 'kind' | 'time' | 'until'>): string | null {
  if (!entry.kind) return null;
  const folded = /^\d+ /.test(entry.kind);
  if (!folded) return entry.kind.charAt(0).toUpperCase() + entry.kind.slice(1);
  return `${entry.kind} folded into one entry${entry.until ? `, ${entry.time} to ${entry.until}` : ''}`;
}

/** Escape closes an open entry or recording and puts focus back on its row. */
export function closeOnEscape(open: boolean, close: () => void, head: React.RefObject<HTMLButtonElement>) {
  return (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    head.current?.focus();
  };
}

interface LogEntryProps {
  entry: DayLogEntry;
  open: boolean;
  onToggle: () => void;
}

/**
 * One line of the activity log. At rest the sentence is clamped to three
 * lines, with its first link under it; the writer puts the outcome in the
 * first 12 words, so the clamp never hides it. Opened in place, it shows the
 * whole sentence, its kind and every link.
 */
export function LogEntry({ entry, onToggle, open }: LogEntryProps) {
  const head = React.useRef<HTMLButtonElement>(null);
  const links = React.useMemo(() => sortDayLinks(entry.links), [entry.links]);
  const meta = entryMeta(entry);
  const title = open
    ? 'Hide the details'
    : `Show the full entry${links.length ? ` and its ${plural(links.length, 'link', 'links')}` : ''}`;

  return (
    <div
      onKeyDown={closeOnEscape(open, onToggle, head)}
      className="group/entry rounded-row transition-hover hover:bg-surface-hover"
    >
      <button
        ref={head}
        type="button"
        aria-expanded={open}
        title={title}
        onClick={onToggle}
        className="grid w-full grid-cols-[32px_minmax(0,1fr)] items-baseline gap-x-2 rounded-row px-2 py-[3px] text-left text-foreground-secondary outline-none group-hover/entry:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      >
        <RowTime className="leading-[18px]">{entry.time}</RowTime>
        <span className={cn(open ? 'block text-foreground' : 'line-clamp-3')}>{entry.text}</span>
      </button>
      {open ? (
        meta || links.length ? (
          <div className="pb-1.5 pl-12 pr-2">
            {meta ? <div className="pb-1 pt-0.5 text-2xs tabular-nums text-foreground-tertiary">{meta}</div> : null}
            <LinkList links={links} />
          </div>
        ) : null
      ) : links.length ? (
        <div className="-mt-0.5 flex min-w-0 items-center gap-0.5 pb-1 pl-12 pr-2">
          <LinkChip link={links[0]} />
          {links.length > 1 ? (
            <button
              type="button"
              title={`Show all ${links.length} links`}
              onClick={onToggle}
              className="h-[18px] flex-none rounded-sm px-[5px] text-2xs tabular-nums text-foreground-tertiary outline-none transition-hover hover:bg-surface-active hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
            >
              +{links.length - 1}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface HourGroupProps {
  hour: string;
  entries: readonly DayLogEntry[];
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** On a busy day the full log folds by hour: one row per hour with its count and latest line. */
export function HourGroup({ children, entries, hour, onToggle, open }: HourGroupProps) {
  const count = plural(entries.length, 'entry', 'entries');
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        title={`${open ? 'Fold' : 'Show'} the ${count} from ${hour}:00 to ${hour}:59`}
        onClick={onToggle}
        className="grid w-full grid-cols-[32px_minmax(0,1fr)_16px] items-start gap-x-2 rounded-row px-2 py-1 text-left text-foreground-secondary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      >
        <RowTime className="leading-[18px]">{hour}:00</RowTime>
        <span className="min-w-0">
          <span className="block">{count}</span>
          {open ? null : (
            <span className="block truncate text-control text-foreground-tertiary">{entries[0]?.text}</span>
          )}
        </span>
        <ChevronRight
          aria-hidden
          className={cn('mt-px h-4 w-4 text-icon transition-transform duration-quick ease-standard', open && 'rotate-90')}
        />
      </button>
      {open ? children : null}
    </div>
  );
}
