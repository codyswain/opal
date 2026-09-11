/**
 * Dropping a file anywhere the app does not handle it would otherwise make the
 * browser navigate to that file. Handled drops (moving items between folders)
 * call preventDefault themselves and are unaffected by this window-level guard.
 */
export function installDropGuard(target: Window): () => void {
  const prevent = (event: Event) => {
    event.preventDefault();
  };
  target.addEventListener('dragover', prevent);
  target.addEventListener('drop', prevent);
  return () => {
    target.removeEventListener('dragover', prevent);
    target.removeEventListener('drop', prevent);
  };
}
