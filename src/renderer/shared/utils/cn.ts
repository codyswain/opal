/**
 * Utility function to conditionally join classNames together
 * @param {...string} classes - List of class names
 * @returns {string} Joined class names string
 */
export function cn(...classes: string[]): string {
  return classes.filter(Boolean).join(' ');
}
