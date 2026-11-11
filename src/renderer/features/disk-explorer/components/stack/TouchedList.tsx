import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleDot, FileText, Folder, GitPullRequest, Newspaper, NotebookText, type LucideIcon } from 'lucide-react';
import { mondayOf, weekDates } from '@/common/touchedModel';
import type { TouchedItem, TouchedKind, TouchedWeek } from '@/types/touched';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/renderer/shared/ui/ContextMenu';
import { useHiddenStore } from '../../store/hiddenStore';
import './touched.css';
import './touchedPalette.css';

const ICONS: Record<TouchedKind, LucideIcon> = {
  file: FileText,
  folder: Folder,
  doc: NotebookText,
  issue: CircleDot,
  pr: GitPullRequest,
};

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** One day's rows, the week they come from, and which day of it the page is. */
export interface TouchedDay {
  week: TouchedWeek;
  /** 0 for Monday. */
  day: number;
  rows: TouchedItem[];
  /** The day's digest file, linked as the first row; null for none. */
  digest: string | null;
}

interface Tip {
  text: string;
  heading: string;
  left: number;
  top: number;
}

const tipDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * The touched list under a daily page: a link to the day's digest, then the
 * most important things the day's agent turns worked on, each with the days
 * of its week it was touched. A click opens the file the way a link in a page does, or the
 * URL in the browser.
 */
export const TouchedList = memo(function TouchedList({
  touched,
  openPath,
}: {
  touched: TouchedDay;
  openPath: (path: string, newTab: boolean) => void;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  // A file row's menu offers Hide; other rows have no menu.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const openMenu = (event: React.MouseEvent) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-touched-file]');
    if (!row?.dataset.touchedFile) {
      event.preventDefault();
      return;
    }
    setTip(null);
    setMenuPath(row.dataset.touchedFile);
  };
  const dates = weekDates(touched.week.monday);
  const { digest } = touched;
  const open = (item: TouchedItem, event: React.MouseEvent) => {
    event.preventDefault();
    if (item.path) openPath(item.path, event.metaKey || event.ctrlKey || event.button === 1);
    // The main process sends web links to the default browser.
    else if (item.url) window.open(item.url, '_blank');
  };
  const showTip = (item: TouchedItem, day: number, target: HTMLElement) => {
    const hit = item.days[day];
    if (!hit) return;
    const box = target.getBoundingClientRect();
    setTip({
      heading: `${tipDate(dates[day])}, ${hit.lines} log ${hit.lines === 1 ? 'line' : 'lines'}`,
      text: hit.text,
      left: Math.max(8, Math.min(box.left - 140, window.innerWidth - 308)),
      top: box.bottom + 8,
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={openMenu}>
        <aside className="opal-touched" aria-label="Touched this day">
          {touched.rows.length > 0 ? (
            <div className="opal-touched-head" aria-hidden>
              <span className="opal-touched-week">
                {LETTERS.map((letter, index) => (
                  <span key={index} data-today={index === touched.day ? '' : undefined}>{letter}</span>
                ))}
              </span>
            </div>
          ) : null}
          {digest ? (
            <button
              type="button"
              className="opal-touched-row"
              onClick={(event) => openPath(digest, event.metaKey || event.ctrlKey)}
              onAuxClick={(event) => event.button === 1 && openPath(digest, true)}
            >
              <Newspaper aria-hidden className="opal-touched-icon" />
              <span className="opal-touched-name">Digest</span>
            </button>
          ) : null}
          {touched.rows.map((item) => {
            const Icon = ICONS[item.kind];
            const label = `${item.id ? `${item.id} ` : ''}${item.name}`.trim();
            return (
              <button
                key={item.key}
                type="button"
                data-touched-key={item.key}
                data-touched-file={item.kind === 'file' && item.path ? item.path : undefined}
                className="opal-touched-row"
                aria-label={label}
                onClick={(event) => open(item, event)}
                onAuxClick={(event) => event.button === 1 && open(item, event)}
              >
                <Icon aria-hidden className="opal-touched-icon" />
                <span className="opal-touched-name" title={label}>
                  {item.id ? <span className="opal-touched-id">{item.id}</span> : null}
                  {item.name}
                </span>
                <span className="opal-touched-week" onPointerLeave={() => setTip(null)}>
                  {item.days.map((hit, day) => (
                    <i
                      key={day}
                      data-hit={hit ? '' : undefined}
                      style={hit && item.colour !== null ? { backgroundColor: `var(--touched-${item.colour})` } : undefined}
                      onPointerEnter={hit ? (event) => showTip(item, day, event.currentTarget) : () => setTip(null)}
                    />
                  ))}
                </span>
              </button>
            );
          })}
          {tip
            ? createPortal(
              <div role="tooltip" className="opal-touched-tip" style={{ left: tip.left, top: tip.top }}>
                <b>{tip.heading}</b>
                {tip.text}
              </div>,
              document.body,
            )
            : null}
        </aside>
      </ContextMenuTrigger>
      {menuPath ? (
        <ContextMenuContent data-testid="touched-menu">
          <ContextMenuItem onSelect={() => void useHiddenStore.getState().hide(menuPath)}>Hide</ContextMenuItem>
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
});

/**
 * Pointer handlers for the stack's content: pointing at a touched row keeps
 * that item's rows on every day at full strength and dims the rest. They set
 * attributes on the page, so the stack does not render again.
 */
export const touchedHover = {
  onPointerOver(event: React.PointerEvent<HTMLElement>) {
    const content = event.currentTarget;
    const row = (event.target as Element).closest<HTMLElement>('.opal-touched-row');
    const key = row?.dataset.touchedKey ?? null;
    if ((content.dataset.touchedHover ?? null) === key) return;
    if (key === null) delete content.dataset.touchedHover;
    else content.dataset.touchedHover = key;
    for (const each of content.querySelectorAll<HTMLElement>('.opal-touched-row')) {
      each.toggleAttribute('data-match', key !== null && each.dataset.touchedKey === key);
    }
  },
  onPointerLeave(event: React.PointerEvent<HTMLElement>) {
    const content = event.currentTarget;
    if (content.dataset.touchedHover === undefined) return;
    delete content.dataset.touchedHover;
    for (const each of content.querySelectorAll<HTMLElement>('.opal-touched-row[data-match]')) each.removeAttribute('data-match');
  },
};

/**
 * The touched weeks of the daily pages a stack shows, by Monday, asked for
 * once each and again when the main process says a week changed.
 */
export function useTouchedWeeks(root: string | null, dates: readonly string[]): ReadonlyMap<string, TouchedWeek> {
  const [weeks, setWeeks] = useState<ReadonlyMap<string, TouchedWeek>>(() => new Map());
  const asked = useRef(new Set<string>());
  const rootRef = useRef(root);
  const mondays = [...new Set(dates.map(mondayOf))].sort().join(',');

  const load = useCallback(async (from: string, monday: string) => {
    const result = await window.vaultAPI.touchedWeek(from, monday);
    if (rootRef.current !== from || !result.success) return;
    setWeeks((known) => new Map(known).set(monday, result.data));
  }, []);

  useEffect(() => {
    rootRef.current = root;
    asked.current.clear();
    setWeeks(new Map());
    if (!root || !window.vaultAPI?.onTouchedChanged) return;
    return window.vaultAPI.onTouchedChanged((change) => {
      if (change.root === root && asked.current.has(change.monday)) void load(root, change.monday);
    });
  }, [root, load]);

  useEffect(() => {
    if (!root || !window.vaultAPI?.touchedWeek) return;
    for (const monday of mondays ? mondays.split(',') : []) {
      if (asked.current.has(monday)) continue;
      asked.current.add(monday);
      void load(root, monday);
    }
  }, [root, mondays, load]);

  return weeks;
}
