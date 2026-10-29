import * as React from 'react';
import { cn } from '@/renderer/shared/utils';

interface SidebarSectionProps {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SidebarSection({
  action,
  children,
  className,
  contentClassName,
  title,
}: SidebarSectionProps) {
  return (
    <section className={cn('min-w-0', className)}>
      {title ? (
        <div className="flex h-row-compact items-center gap-2 pl-3.5 pr-2">
          <h2 className="min-w-0 flex-1 truncate text-label text-foreground-tertiary">
            {title}
          </h2>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn('flex min-w-0 flex-col gap-0.5 px-2', contentClassName)}>
        {children}
      </div>
    </section>
  );
}

export type { SidebarSectionProps };
