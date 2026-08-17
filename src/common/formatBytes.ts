const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Human-readable byte count. Shared by the list view, the detail pane, and the
 * Quick Look header, so it lives in common/ rather than inside a component.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1
  );
  const value = bytes / 1024 ** exponent;

  // Number() strips a trailing '.0' so 2048 reads as "2 KB", not "2.0 KB".
  const rounded = exponent === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${UNITS[exponent]}`;
}
