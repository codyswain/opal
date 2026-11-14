import * as React from 'react';
import { cn } from '@/renderer/shared/utils';

interface SidebarSectionProps {
  children: React.ReactNode;
  className?: string;
}

export function SidebarSection({ children, className }: SidebarSectionProps) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-0.5 px-sidebar-inset', className)}>
      {children}
    </section>
  );
}

export type { SidebarSectionProps };
