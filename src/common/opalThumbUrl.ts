export const OPAL_THUMB_SCHEME = 'opal-thumb';

/**
 * Thumbnails get their own scheme rather than a query parameter on opal-file://
 * so the two protocol handlers stay separate: one streams original bytes, the
 * other may generate a file before responding.
 */
export function toOpalThumbUrl(absolutePath: string): string {
  const encoded = absolutePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${OPAL_THUMB_SCHEME}://${encoded}`;
}

export function opalThumbUrlToPath(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== `${OPAL_THUMB_SCHEME}:`) {
    throw new Error(`Unexpected scheme on thumbnail URL: ${parsed.protocol}`);
  }

  const raw = `${parsed.host}${parsed.pathname}`;
  const decoded = decodeURIComponent(raw);
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}
