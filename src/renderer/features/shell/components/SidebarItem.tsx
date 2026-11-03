import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';

interface SidebarItemProps {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  trailing?: React.ReactNode;
  /** Gets the click, so Cmd+click and middle-click can open a new tab. */
  onActivate?: (event: React.MouseEvent) => void;
  className?: string;
}

const rowStyles = [
  'group flex h-row-compact w-full min-w-0 items-center gap-2 rounded-row px-2',
  'text-left text-ui font-medium text-foreground-secondary outline-none',
  'transition-hover hover:bg-surface-hover hover:text-foreground',
  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
].join(' ');

function ItemContents({
  icon: Icon,
  label,
  trailing,
}: Pick<SidebarItemProps, 'icon' | 'label' | 'trailing'>) {
  return (
    <>
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-icon" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? (
        <span className="shrink-0 text-metadata tabular-nums text-foreground-tertiary">
          {trailing}
        </span>
      ) : null}
    </>
  );
}

export function SidebarItem({
  active,
  className,
  icon,
  label,
  onActivate,
  trailing,
}: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      onAuxClick={(event) => {
        if (event.button === 1) onActivate?.(event);
      }}
      aria-pressed={active || undefined}
      className={cn(
        rowStyles,
        active === true && 'bg-surface-selected text-foreground',
        className
      )}
    >
      <ItemContents icon={icon} label={label} trailing={trailing} />
    </button>
  );
}

export type { SidebarItemProps };
