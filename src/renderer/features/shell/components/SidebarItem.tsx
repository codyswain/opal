import * as React from 'react';
import { NavLink, type To } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';

interface SidebarItemProps {
  label: string;
  icon: LucideIcon;
  to?: To;
  active?: boolean;
  trailing?: React.ReactNode;
  onActivate?: () => void;
  className?: string;
}

const rowStyles = [
  'group flex h-row-compact w-full min-w-0 items-center gap-2 rounded-row px-2',
  'text-left text-ui text-foreground-secondary outline-none',
  'transition-colors duration-hover ease-standard',
  'hover:bg-surface-hover hover:text-foreground',
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
        <span className="shrink-0 text-metadata text-foreground-tertiary">
          {trailing}
        </span>
      ) : null}
    </>
  );
}

export function SidebarItem({
  active = false,
  className,
  icon,
  label,
  onActivate,
  to,
  trailing,
}: SidebarItemProps) {
  if (to) {
    return (
      <NavLink
        to={to}
        onClick={onActivate}
        className={({ isActive }) =>
          cn(
            rowStyles,
            (isActive || active) &&
              'bg-surface-selected text-foreground',
            className
          )
        }
      >
        <ItemContents icon={icon} label={label} trailing={trailing} />
      </NavLink>
    );
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      aria-pressed={active || undefined}
      className={cn(
        rowStyles,
        active && 'bg-surface-selected text-foreground',
        className
      )}
    >
      <ItemContents icon={icon} label={label} trailing={trailing} />
    </button>
  );
}

export type { SidebarItemProps };
