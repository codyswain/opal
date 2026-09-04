import * as React from 'react';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Dot } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';

const Menu = MenuPrimitive.Root;
const MenuTrigger = MenuPrimitive.Trigger;
const MenuGroup = MenuPrimitive.Group;
const MenuPortal = MenuPrimitive.Portal;
const MenuSub = MenuPrimitive.Sub;
const MenuRadioGroup = MenuPrimitive.RadioGroup;

const itemStyles = [
  'relative flex h-row-compact cursor-default select-none items-center rounded-row px-2',
  'text-control text-foreground-secondary outline-none',
  'transition-colors duration-hover ease-standard',
  'focus:bg-surface-hover focus:text-foreground',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
].join(' ');

const contentStyles = [
  'z-50 min-w-44 overflow-hidden rounded-overlay',
  'border border-border-subtle bg-surface-raised p-1 text-foreground shadow-overlay',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'duration-overlay ease-standard',
].join(' ');

const MenuContent = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(({ className, collisionPadding = 8, sideOffset = 6, ...props }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      ref={ref}
      collisionPadding={collisionPadding}
      sideOffset={sideOffset}
      className={cn(contentStyles, className)}
      {...props}
    />
  </MenuPrimitive.Portal>
));
MenuContent.displayName = MenuPrimitive.Content.displayName;

interface MenuItemProps
  extends React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item> {
  inset?: boolean;
  tone?: 'default' | 'destructive';
}

const MenuItem = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Item>,
  MenuItemProps
>(({ className, inset, tone = 'default', ...props }, ref) => (
  <MenuPrimitive.Item
    ref={ref}
    className={cn(
      itemStyles,
      inset && 'pl-7',
      tone === 'destructive' &&
        'text-danger focus:bg-danger/10 focus:text-danger',
      className
    )}
    {...props}
  />
));
MenuItem.displayName = MenuPrimitive.Item.displayName;

const MenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>
>(({ checked, children, className, ...props }, ref) => (
  <MenuPrimitive.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(itemStyles, 'pl-7 pr-2', className)}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenuPrimitive.ItemIndicator>
        <Check aria-hidden className="h-3.5 w-3.5" />
      </MenuPrimitive.ItemIndicator>
    </span>
    {children}
  </MenuPrimitive.CheckboxItem>
));
MenuCheckboxItem.displayName = MenuPrimitive.CheckboxItem.displayName;

const MenuRadioItem = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>
>(({ children, className, ...props }, ref) => (
  <MenuPrimitive.RadioItem
    ref={ref}
    className={cn(itemStyles, 'pl-7 pr-2', className)}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenuPrimitive.ItemIndicator>
        <Dot aria-hidden className="h-4 w-4 fill-current" />
      </MenuPrimitive.ItemIndicator>
    </span>
    {children}
  </MenuPrimitive.RadioItem>
));
MenuRadioItem.displayName = MenuPrimitive.RadioItem.displayName;

const MenuLabel = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <MenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-2 py-1 text-metadata font-medium text-foreground-tertiary',
      inset && 'pl-7',
      className
    )}
    {...props}
  />
));
MenuLabel.displayName = MenuPrimitive.Label.displayName;

const MenuSeparator = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border-subtle', className)}
    {...props}
  />
));
MenuSeparator.displayName = MenuPrimitive.Separator.displayName;

function MenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      className={cn(
        'ml-auto pl-4 font-mono text-metadata text-foreground-tertiary',
        className
      )}
      {...props}
    />
  );
}
MenuShortcut.displayName = 'MenuShortcut';

const MenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ children, className, inset, ...props }, ref) => (
  <MenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      itemStyles,
      'data-[state=open]:bg-surface-hover data-[state=open]:text-foreground',
      inset && 'pl-7',
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight aria-hidden className="ml-auto h-3.5 w-3.5" />
  </MenuPrimitive.SubTrigger>
));
MenuSubTrigger.displayName = MenuPrimitive.SubTrigger.displayName;

const MenuSubContent = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>
>(({ className, collisionPadding = 8, sideOffset = 4, ...props }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.SubContent
      ref={ref}
      collisionPadding={collisionPadding}
      sideOffset={sideOffset}
      className={cn(contentStyles, className)}
      {...props}
    />
  </MenuPrimitive.Portal>
));
MenuSubContent.displayName = MenuPrimitive.SubContent.displayName;

export {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuPortal,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
};
export type { MenuItemProps };
