/** Collection items share shortcuts; independent controls and editors keep theirs. */
export function shouldIgnoreShortcutTarget(
  target: HTMLElement | null
): boolean {
  if (!target || typeof target.closest !== 'function') return false;
  if (
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], [role="menuitem"], [data-disk-shortcuts-ignore="true"]'
    )
  )
    return true;
  return (
    !!target.closest('button, a, [role="button"], [role="tab"]') &&
    !target.closest('[data-disk-collection-item="true"]')
  );
}
