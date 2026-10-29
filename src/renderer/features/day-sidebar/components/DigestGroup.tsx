import * as React from 'react';
import { Check } from 'lucide-react';
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
  /** Ticks or clears a checkbox item. */
  onCheck: (item: DayDigestItem, checked: boolean) => void;
  /** Lines of checkbox items whose tick is being written. */
  busy: ReadonlySet<number>;
}

function ReplyDrafted() {
  return <span className="block pt-0.5 text-2xs tabular-nums text-foreground-tertiary">Reply drafted</span>;
}

/**
 * A checkbox item: the box, its one-line title, and its detail muted below,
 * clamped to two lines. The tooltip holds the whole detail, and a click on
 * the text shows all of it in place. Ticking writes the digest file.
 */
function DigestCheckbox({
  busy,
  item,
  level,
  onCheck,
}: {
  item: DayDigestItem;
  level: DayDigestGroup['level'];
  onCheck: (item: DayDigestItem, checked: boolean) => void;
  busy: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const checked = item.checked === true;
  const title = (
    <span className={cn('block', checked ? 'text-foreground-tertiary line-through' : WEIGHTS[level])}>{item.text}</span>
  );
  return (
    <div className="flex items-start gap-2 rounded-row px-2 py-1 transition-hover hover:bg-surface-hover">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={item.text}
        aria-busy={busy || undefined}
        disabled={busy}
        title={checked ? 'Clear the tick in the digest' : 'Tick it in the digest'}
        onClick={() => onCheck(item, !checked)}
        className={cn(
          'mt-[2px] flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[4px] border-[1.5px] outline-none transition-hover',
          'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
          checked ? 'border-foreground bg-foreground' : 'border-foreground-tertiary hover:border-foreground-secondary',
          busy && 'opacity-60',
        )}
      >
        {checked ? <Check aria-hidden strokeWidth={3.5} className="h-2.5 w-2.5 text-canvas" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        {item.detail ? (
          <button
            type="button"
            aria-expanded={open}
            title={item.detail}
            onClick={() => setOpen((current) => !current)}
            className="block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {title}
            <span
              data-testid="digest-detail"
              className={cn('block pt-0.5 text-control text-foreground-tertiary', !open && 'line-clamp-2')}
            >
              {item.detail}
            </span>
          </button>
        ) : (
          title
        )}
        {item.replyDrafted ? <ReplyDrafted /> : null}
      </div>
    </div>
  );
}

/**
 * One priority group of the digest. A checkbox item ticks in place; an item
 * from an older digest, which has no checkbox, opens the digest note.
 */
export function DigestGroup({ busy, file, items, level, onCheck, onOpen }: DigestGroupProps) {
  return (
    <>
      <GroupLabel>{LABELS[level]}</GroupLabel>
      {items.map((item, index) =>
        item.checked !== null && item.at ? (
          <DigestCheckbox
            key={`${item.at.line}:${item.text}`}
            item={item}
            level={level}
            onCheck={onCheck}
            busy={busy.has(item.at.line)}
          />
        ) : (
          <button
            key={`${index}:${item.text}`}
            type="button"
            title={`${LABELS[level]}. Opens ${file} in this tab. Cmd-click opens a new tab.`}
            onClick={onOpen}
            onAuxClick={(event) => event.button === 1 && onOpen(event)}
            className="group/item block w-full rounded-row px-2 py-1 text-left outline-none transition-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
          >
            <span className={cn('line-clamp-2 group-hover/item:text-foreground', WEIGHTS[level])}>{item.text}</span>
            {item.replyDrafted ? <ReplyDrafted /> : null}
          </button>
        ),
      )}
    </>
  );
}
