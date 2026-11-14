import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Without this, tailwind-merge reads the token font sizes as text colors and
// drops `text-ui` whenever a `text-foreground` class follows it, and keeps
// two token weights on one row.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['2xs', 'metadata', 'label', 'control', 'ui', 'ui-heading'] },
      ],
      // The sidebar's weights are tokens, so a selected row's weight replaces the label's.
      'font-weight': [{ font: ['sidebar-label', 'sidebar-active'] }],
    },
  },
});

/** Composes conditional classes and resolves conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
