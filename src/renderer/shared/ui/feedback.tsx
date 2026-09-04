import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/renderer/shared/utils';

const badgeVariants = cva(
  'inline-flex h-5 items-center rounded-full px-1.5 text-metadata font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-hover text-foreground-secondary',
        info: 'bg-info/10 text-info',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        danger: 'bg-danger/10 text-danger',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props} />
  );
}

function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-row border border-border-subtle',
        'bg-surface-hover px-1 font-mono text-metadata text-foreground-tertiary',
        className
      )}
      {...props}
    />
  );
}

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}

function EmptyState({
  action,
  className,
  compact = false,
  description,
  Icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'grid flex-1 place-items-center',
        compact ? 'p-4' : 'p-6',
        className
      )}
      {...props}
    >
      <div className="flex max-w-xs flex-col items-center gap-2 text-center">
        <span aria-hidden className="text-foreground-tertiary">
          <Icon className={compact ? 'h-6 w-6' : 'h-8 w-8'} />
        </span>
        <p
          data-testid="empty-state-title"
          className="text-ui font-medium text-foreground"
        >
          {title}
        </p>
        {description ? (
          <p className="text-control text-foreground-secondary">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-1">{action}</div> : null}
      </div>
    </div>
  );
}

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      data-testid="skeleton"
      className={cn(
        'animate-pulse rounded-control bg-surface-active/70',
        className
      )}
      {...props}
    />
  );
}

function GallerySkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 p-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="aspect-square" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export { Badge, EmptyState, GallerySkeleton, Kbd, Skeleton, badgeVariants };
export type { BadgeProps, EmptyStateProps };
