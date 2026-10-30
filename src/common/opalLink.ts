export const OPAL_LINK_SCHEME = 'opal';

/** What the renderer does with a link: open the file, or say why it cannot. */
export type OpenPageRequest = { path: string } | { error: string };

/**
 * The path in `opal://open?path=<path>`, or null for any other URL. The path
 * is relative to the vault, or absolute. A `+` in it must be sent as `%2B`,
 * since query strings read `+` as a space.
 */
export function opalLinkPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${OPAL_LINK_SCHEME}:` || parsed.host !== 'open') return null;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return null;
  const target = parsed.searchParams.get('path');
  return target?.trim() ? target : null;
}
