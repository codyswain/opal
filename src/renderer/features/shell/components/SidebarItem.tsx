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
  /** The native tooltip. */
  title?: string;
  disabled?: boolean;
}

const rowStyles = [
  'group flex h-row-compact w-full min-w-0 items-center gap-sidebar-icon-gap rounded-sidebar-row px-2',
  'text-left text-ui font-sidebar-label text-sidebar-label outline-none',
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
      <Icon aria-hidden className="stroke-sidebar-icon h-sidebar-icon w-sidebar-icon shrink-0 text-sidebar-icon" />
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
  title,
  disabled,
}: SidebarItemProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onActivate}
      onAuxClick={(event) => {
        if (event.button === 1) onActivate?.(event);
      }}
      aria-pressed={active || undefined}
      className={cn(
        rowStyles,
        active === true && 'bg-sidebar-selected font-sidebar-active text-foreground',
        disabled && 'pointer-events-none',
        className
      )}
    >
      <ItemContents icon={icon} label={label} trailing={trailing} />
    </button>
  );
}

export type { SidebarItemProps };
