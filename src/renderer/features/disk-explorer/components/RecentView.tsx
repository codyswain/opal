import React, { useEffect, useMemo, useState } from 'react';
import type { RecentItem } from '@/types/activity';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import { fileTreeLabel } from '@/common/fileKind';
import { Button } from '@/renderer/shared/ui';
import { recordOpened } from '../activity/recordActivity';
import { groupRecent, recentTime } from '../activity/recentGroups';
import { focusFile } from '../navigation/filesLocation';
import { useDiskStore } from '../store/diskStore';
import { useRecentStore } from '../store/recentStore';
import { vaultFolder, vaultRelativePath } from './tabLabels';

/** Re-renders so the day groups move on at midnight. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Up and Down move between rows, Home and End jump to the ends. */
function moveFocus(event: React.KeyboardEvent<HTMLElement>) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-recent-row]')];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'ArrowDown' ? at + 1
    : event.key === 'ArrowUp' ? at - 1
    : event.key === 'Home' ? 0
    : event.key === 'End' ? rows.length - 1
    : null;
  if (next === null || !rows[next]) return;
  event.preventDefault();
  rows[next].focus();
}

/** Files opened or edited in the last 30 days, newest first, grouped by day. */
export const RecentView: React.FC = () => {
  const { navigateFiles } = useShell();
  const roots = useDiskStore((state) => state.roots);
  const result = useRecentStore((state) => state.result);
  const loading = useRecentStore((state) => state.loading);
  const error = useRecentStore((state) => state.error);
  const load = useRecentStore((state) => state.load);
  const now = useNow();

  // Activity and disk changes both alter the list; reload while it shows.
  useEffect(() => {
    void load();
    const offActivity = window.activityAPI.onChanged(() => { void load(); });
    const offDisk = window.diskAPI.onChanged(() => { void load(); });
    return () => {
      offActivity();
      offDisk();
    };
  }, [load]);

  const groups = useMemo(() => groupRecent(result?.items ?? [], now), [result, now]);

  const open = (item: RecentItem, newTab: boolean) => {
    recordOpened(item.entry.path);
    navigateFiles(focusFile(item.entry.path), { newTab });
  };

  let body: React.ReactNode;
  if (error && !result) {
    body = (
      <div className="flex items-center gap-3 px-2">
        <p role="alert" className="text-ui text-foreground-secondary">{error}</p>
        <Button size="compact" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  } else if (!result) {
    body = loading ? <p role="status" className="px-2 text-ui text-foreground-tertiary">Loading…</p> : null;
  } else if (groups.length === 0) {
    body = <p className="px-2 text-ui text-foreground-tertiary">Files you open or edit show up here.</p>;
  } else {
    body = (
      <div onKeyDown={moveFocus}>
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="pb-4">
            <h2 className="px-2 pb-1 text-label text-foreground-tertiary">{group.label}</h2>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.entry.path}>
                  <RecentRow item={item} roots={roots} now={now} onOpen={open} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="recent" className="mx-auto max-w-reading px-6 pb-24 pt-10">
      <h1 className="px-2 pb-6 text-xl font-semibold text-foreground">Recent</h1>
      {result?.warnings.map((warning) => (
        <p key={warning} role="status" className="px-2 pb-4 text-ui text-foreground-secondary">
          {warning}
        </p>
      ))}
      {body}
    </div>
  );
};

interface RecentRowProps {
  item: RecentItem;
  roots: readonly string[];
  now: number;
  onOpen: (item: RecentItem, newTab: boolean) => void;
}

const RecentRow: React.FC<RecentRowProps> = ({ item, roots, now, onOpen }) => {
  const { path, name, kind } = item.entry;
  return (
    <button
      type="button"
      data-recent-row
      data-testid={`recent-row-${path}`}
      title={vaultRelativePath(path, roots)}
      onClick={(event) => onOpen(item, event.metaKey || event.ctrlKey)}
      onAuxClick={(event) => {
        if (event.button === 1) onOpen(item, true);
      }}
      className="flex h-row w-full min-w-0 items-center gap-3 rounded-row px-2 text-left text-ui outline-none transition-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
    >
      <span className="min-w-0 truncate text-foreground">{fileTreeLabel(name, kind)}</span>
      <span className="min-w-0 flex-1 truncate text-foreground-tertiary">{vaultFolder(path, roots)}</span>
      <span className="shrink-0 text-metadata tabular-nums text-foreground-tertiary">
        {recentTime(item.touchedAt, now)}
      </span>
    </button>
  );
};
