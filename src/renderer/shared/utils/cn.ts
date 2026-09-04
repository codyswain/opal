import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Composes conditional classes and resolves conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
