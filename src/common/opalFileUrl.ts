import { extensionOf } from '@/common/fileKind';

export const OPAL_FILE_SCHEME = 'opal-file';

/**
 * Assets stream over a custom protocol rather than crossing IPC as base64.
 *
 * The alternative — reading a file, base64-encoding it (+33%), sending it as
 * a string, and decoding it in the renderer — costs several copies of every
 * byte and is unusable for a folder of photos. With a protocol, <img src>
 * pulls bytes straight off disk and Chromium handles decode and caching.
 *
 * The whole absolute path is carried as the URL path, percent-encoded. The
 * host component is left empty ('opal-file:///Users/...') so the URL parses
 * as a standard hierarchical URL.
 */
export function toOpalFileUrl(absolutePath: string): string {
  const encoded = absolutePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${OPAL_FILE_SCHEME}://${encoded}`;
}

export function opalFileUrlToPath(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== `${OPAL_FILE_SCHEME}:`) {
    throw new Error(`Unexpected scheme on asset URL: ${parsed.protocol}`);
  }
  // A registered "standard" scheme parses the first segment as the host, so
  // the absolute path is host + pathname recombined.
  const raw = `${parsed.host}${parsed.pathname}`;
  return decodeURIComponent(raw);
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
  aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus',
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8',
};

export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[extensionOf(name)] ?? 'application/octet-stream';
}
