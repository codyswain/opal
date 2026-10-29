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

export { Badge, Kbd, badgeVariants };
export type { BadgeProps };
