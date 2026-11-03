import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';

interface DayCardProps {
  id: string;
  title: string;
  /** The count at the end of the header while the card is open. */
  value: string;
  /** What the header says while the card is folded. */
  summary: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const cardStyles = 'flex-none rounded-card border border-page-ring bg-canvas p-1';

/**
 * One section of the day: a hairline card whose header folds it. The chevron
 * shows on hover, on focus, or while the card is folded.
 */
export function DayCard({ children, collapsed, id, onToggle, summary, title, value }: DayCardProps) {
  const bodyId = `day-card-${id}`;
  return (
    <section aria-label={title} className={cardStyles}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        title={`${collapsed ? 'Show' : 'Hide'} ${title.toLowerCase()}`}
        onClick={onToggle}
        className="group/head flex h-8 w-full items-center gap-0.5 rounded-row px-2 text-left outline-none transition-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      >
        <span className="whitespace-nowrap font-medium text-foreground">{title}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0 p-px text-icon transition-[transform,opacity] duration-quick ease-standard',
            !collapsed && 'rotate-90 opacity-0 group-hover/head:opacity-100 group-focus-visible/head:opacity-100',
          )}
        />
        <span
          className={cn(
            'ml-auto truncate whitespace-nowrap pl-2 tabular-nums text-foreground-tertiary',
            collapsed ? 'text-control' : 'text-2xs',
          )}
        >
          {collapsed ? summary : value}
        </span>
      </button>
      {collapsed ? null : (
        <div id={bodyId} className="flex flex-col gap-0.5 pt-0.5">
          {children}
        </div>
      )}
    </section>
  );
}

/** A section with nothing on a day that has other things: its muted title and one line, not a control. */
export function EmptyDayCard({ line, title }: { title: string; line: string }) {
  return (
    <section aria-label={title} className={cardStyles}>
      <div className="flex h-8 items-center gap-0.5 px-2">
        <span className="whitespace-nowrap text-foreground-tertiary">{title}</span>
        <span className="ml-auto truncate pl-2 text-control text-foreground-tertiary">{line}</span>
      </div>
    </section>
  );
}

/** The small grey label above a group of rows, such as "High priority". */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-0.5 pt-1.5 text-control font-medium text-foreground-tertiary first:pt-0.5">{children}</div>;
}

/** "Show N more", "Open full log": quiet text buttons at a card's foot. */
export const FootButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex h-row-compact items-center rounded-row px-2 text-control font-medium text-foreground-tertiary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
        className,
      )}
      {...props}
    />
  ),
);
FootButton.displayName = 'FootButton';

export function CardFoot({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

/** The 32px gutter that holds each row's time, so every card reads as a timeline. */
export function RowTime({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('w-8 flex-none text-2xs tabular-nums tracking-normal text-foreground-tertiary', className)}>
      {children}
    </span>
  );
}

/** A row inside a card, without its height. */
export const rowBaseStyles =
  'flex w-full items-center gap-2 rounded-row px-2 text-left text-foreground-secondary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus';

/** A one-line row inside a card. */
export const rowStyles = `${rowBaseStyles} h-row-compact`;
