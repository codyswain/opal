import * as React from 'react';
import { cn } from '@/renderer/shared/utils';
import type { DayDigestGroup, DayDigestItem } from '@/types/day';
import { GroupLabel } from './DayCard';

const LABELS: Record<DayDigestGroup['level'], string> = {
  top: 'Top 3',
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

/** Priority shows by group, order and weight, never by colour or a mark. */
const WEIGHTS: Record<DayDigestGroup['level'], string> = {
  top: 'font-medium text-foreground',
  high: 'font-medium text-foreground',
  medium: 'text-foreground-secondary',
  low: 'text-foreground-tertiary',
};

export const digestGroupLabel = (level: DayDigestGroup['level']) => LABELS[level];

interface DigestGroupProps {
  level: DayDigestGroup['level'];
  items: readonly DayDigestItem[];
  /** The digest note's path as the tooltip names it. */
  file: string;
  onOpen: (event: React.MouseEvent) => void;
}

/** One priority group of the digest. Each item opens the digest note. */
export function DigestGroup({ file, items, level, onOpen }: DigestGroupProps) {
  return (
    <>
      <GroupLabel>{LABELS[level]}</GroupLabel>
      {items.map((item, index) => (
        <button
          key={`${index}:${item.text}`}
          type="button"
          title={`${LABELS[level]}. Opens ${file} in this tab. Cmd-click opens a new tab.`}
          onClick={onOpen}
          onAuxClick={(event) => event.button === 1 && onOpen(event)}
          className="group/item block w-full rounded-row px-2 py-1 text-left outline-none transition-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        >
          <span className={cn('line-clamp-2 group-hover/item:text-foreground', WEIGHTS[level])}>{item.text}</span>
          {item.replyDrafted ? (
            <span className="block pt-0.5 text-2xs tabular-nums text-foreground-tertiary">Reply drafted</span>
          ) : null}
        </button>
      ))}
    </>
  );
}
