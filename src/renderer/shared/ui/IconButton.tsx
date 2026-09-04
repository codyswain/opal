import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/renderer/shared/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center rounded-control text-icon',
    'transition-colors duration-hover ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
    'focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      size: {
        compact: 'h-control-compact w-control-compact',
        default: 'h-control w-control',
      },
      variant: {
        ghost: 'bg-transparent hover:bg-surface-hover hover:text-foreground',
        subtle:
          'bg-surface-hover text-foreground-secondary hover:bg-surface-active hover:text-foreground',
        outline:
          'border border-border bg-surface hover:bg-surface-hover hover:text-foreground',
        destructive:
          'text-danger hover:bg-danger/10 hover:text-danger active:bg-danger/15',
      },
      active: {
        true: 'bg-surface-active text-foreground',
        false: '',
      },
    },
    defaultVariants: {
      size: 'compact',
      variant: 'ghost',
      active: false,
    },
  }
);

interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  label: string;
  shortcut?: React.ReactNode;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>['side'];
  children: React.ReactNode;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      active,
      children,
      className,
      label,
      shortcut,
      size,
      tooltipSide,
      type = 'button',
      variant,
      ...props
    },
    ref
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type={type}
          aria-label={label}
          aria-pressed={active ?? undefined}
          className={cn(
            iconButtonVariants({ active, size, variant }),
            className
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        <span>{label}</span>
        {shortcut ? (
          <span
            aria-hidden
            className="ml-2 font-mono text-metadata text-foreground-tertiary"
          >
            {shortcut}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
);
IconButton.displayName = 'IconButton';

export { IconButton, iconButtonVariants };
export type { IconButtonProps };
