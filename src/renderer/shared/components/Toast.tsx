import React from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast, type ToasterProps } from 'sonner';

/** Toasts look like menus: the raised surface, the overlay hairline and UI text, all neutral. */
const TOAST_STYLE = {
  '--normal-bg': 'hsl(var(--surface-raised))',
  '--normal-border': 'hsl(var(--border-overlay))',
  '--normal-text': 'hsl(var(--text-primary))',
  '--border-radius': 'var(--radius-overlay)',
  fontFamily: 'var(--font-sans)',
} as React.CSSProperties;

export function Toaster(props: ToasterProps) {
  return <SonnerToaster style={TOAST_STYLE} {...props} />;
}

export const toast = sonnerToast;
