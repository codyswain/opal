import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/renderer/shared/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control',
    'text-control font-medium outline-none transition-colors duration-hover ease-standard',
    'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
    'focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        secondary:
          'bg-surface-hover text-foreground hover:bg-surface-active active:bg-surface-selected',
        outline:
          'border border-border bg-surface text-foreground-secondary hover:bg-surface-hover hover:text-foreground',
        ghost:
          'bg-transparent text-foreground-secondary hover:bg-surface-hover hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        compact: 'h-control-compact px-2',
        default: 'h-control px-3',
        sm: 'h-control-compact px-2',
        lg: 'h-9 px-4 text-ui',
        icon: 'h-control w-control p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;
type ButtonSize = NonNullable<ButtonVariantProps['size']>;

interface ButtonBaseProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<ButtonVariantProps, 'size'> {
  asChild?: boolean;
}

type ButtonProps = ButtonBaseProps &
  (
    | {
        size: 'icon';
        'aria-label': string;
      }
    | {
        size?: Exclude<ButtonSize, 'icon'>;
      }
  );

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { asChild = false, className, size, type = 'button', variant, ...props },
    ref
  ) => {
    const Component = asChild ? Slot : 'button';
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ className, size, variant }))}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
export type { ButtonProps };
