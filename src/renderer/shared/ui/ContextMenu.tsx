import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cn } from '@/renderer/shared/utils';

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuGroup = ContextMenuPrimitive.Group;

const itemStyles = [
  'relative flex h-row-compact cursor-default select-none items-center gap-2 rounded-row px-2',
  'text-control text-foreground-secondary outline-none',
  'transition-colors duration-hover ease-standard',
  'focus:bg-surface-hover focus:text-foreground',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
].join(' ');

const contentStyles = [
  'z-50 min-w-48 overflow-hidden rounded-overlay',
  'border border-border-subtle bg-surface-raised p-1 text-foreground shadow-overlay',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'duration-overlay ease-standard',
].join(' ');

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, collisionPadding = 8, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content ref={ref} collisionPadding={collisionPadding} className={cn(contentStyles, className)} {...props} />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = 'ContextMenuContent';

interface ContextMenuItemProps extends React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> {
  tone?: 'default' | 'destructive';
}

const ContextMenuItem = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Item>, ContextMenuItemProps>(
  ({ className, tone = 'default', ...props }, ref) => (
    <ContextMenuPrimitive.Item
      ref={ref}
      className={cn(itemStyles, tone === 'destructive' && 'text-danger focus:bg-danger/10 focus:text-danger', className)}
      {...props}
    />
  )
);
ContextMenuItem.displayName = 'ContextMenuItem';

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border-subtle', className)} {...props} />
));
ContextMenuSeparator.displayName = 'ContextMenuSeparator';

const ContextMenuShortcut: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ className, ...props }) => (
  <span className={cn('ml-auto pl-4 text-2xs tracking-wide text-foreground-tertiary', className)} {...props} />
);

export { ContextMenu, ContextMenuTrigger, ContextMenuGroup, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut };
