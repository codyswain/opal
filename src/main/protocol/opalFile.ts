import { protocol } from 'electron';
import type { FileHandle } from 'fs/promises';
import { open } from 'fs/promises';
import { Readable } from 'stream';
import {
  OPAL_FILE_SCHEME,
  opalFileUrlToPath,
  contentTypeFor,
} from '@/common/opalFileUrl';

export { OPAL_FILE_SCHEME };
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
import { localObject, readPlaceholder } from '@/main/files/lfsPlaceholder';
import logger from '@/main/logger';

/**
 * Must run before app.whenReady(). Registering as `standard` gives the scheme
 * normal URL parsing and a proper origin; `stream` enables incremental bodies;
 * `secure` keeps it out of mixed-content warnings. bypassCSP is deliberately
 * NOT set — the scheme is added to the CSP allow-list in main.ts instead, so
 * the policy stays a real policy.
 */
export function registerOpalFileScheme(): void {
  const privileges = {
    standard: true,
    secure: true,
    stream: true,
    supportFetchAPI: true,
    corsEnabled: true,
  };

  protocol.registerSchemesAsPrivileged([
    { scheme: OPAL_FILE_SCHEME, privileges },
  ]);
}

export interface OpalFileProtocolDependencies {
  registry: RootRegistry;
}

/**
 * On every response. No Access-Control-Allow-Origin: the page reads file
 * bytes only through <img>, <video> and <embed>, never with fetch, so no
 * script can read a vault file it was not handed over IPC.
 */
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

/** Types that run script when loaded as a document. They never run any from here. */
const DOCUMENT_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/;
/**
 * The policy those types get: a sandbox (no script, no forms, an opaque
 * origin), and nothing loaded from anywhere, so a framed page can't reach
 * the web either. Inline styles and data: pictures still draw.
 */
export const DOCUMENT_POLICY = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const answer = (status: number, text: string) =>
  new Response(text, { status, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });

/** The bytes a Range header asks for, inclusive, or why it can't be answered with one part. */
export type RangeAsk = { start: number; end: number } | 'whole' | 'unsatisfiable';

/**
 * Reads `bytes=a-b`, `bytes=a-` and `bytes=-n` against a file of `size`
 * bytes. Several ranges, another unit or a malformed header ask for the
 * whole file, which RFC 9110 allows a server to send instead. A range that
 * starts at or past the end is unsatisfiable. A zero-byte file is always
 * sent whole, since no range of it exists.
 */
export function parseRange(header: string | null, size: number): RangeAsk {
  if (!header || size === 0) return 'whole';
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match) return 'whole';
  const [, first, last] = match;
  if (!first && !last) return 'whole';
  if (!first) {
    const suffix = Number(last);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last ? Number(last) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'whole';
  if (last && end < start) return 'whole';
  if (start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

/** A validator for the bytes served: the LFS object id, or the file's size and modified time. */
const etagFor = (size: number, mtimeMs: number, oid?: string) => `"${oid ?? `${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}`}"`;

/**
 * Whether If-Range still names these bytes. An entity tag must match
 * exactly; a date must equal Last-Modified, since a range of a file changed
 * since would splice two versions.
 */
function rangeStillValid(ifRange: string | null, etag: string, lastModified: string): boolean {
  if (!ifRange) return true;
  const value = ifRange.trim();
  if (value.startsWith('"') || value.startsWith('W/')) return value === etag;
  return value === lastModified;
}

/**
 * Answers one opal-file request: the file at the URL's path, or its Git LFS
 * object, whole or one byte range of it. Each request opens the file and
 * reads its size from the open handle, so a file replaced between two
 * requests is served as it is now, and never half old and half new.
 */
export async function serveOpalFile(request: Request, deps: OpalFileProtocolDependencies): Promise<Response> {
  let requestedPath: string;
  try {
    requestedPath = opalFileUrlToPath(request.url);
  } catch {
    return answer(400, 'Bad asset URL');
  }

  let resolved: string;
  try {
    // Same guard as the IPC surface. Without it this protocol would serve
    // any file the user can read to anything running in the renderer.
    resolved = await deps.registry.assertAllowed(requestedPath);
  } catch (error) {
    if (error instanceof PathNotAllowedError) return answer(403, 'Forbidden');
    logger.error('opal-file: failed to authorize request', error);
    return answer(500, 'Internal error');
  }

  let handle: FileHandle | null = null;
  try {
    handle = await open(resolved, 'r');
    let info = await handle.stat();
    if (info.isDirectory()) {
      await handle.close();
      return answer(400, 'Not a file');
    }

    // A Git LFS placeholder shows its bytes from git's object store once
    // they are on this Mac. Until then it is not found, and the page asks
    // the file store whether it can be downloaded.
    let oid: string | undefined;
    const placeholder = info.size < 1024 ? await readPlaceholder(resolved).catch(() => null) : null;
    if (placeholder) {
      const object = await localObject(resolved, placeholder);
      await handle.close();
      handle = null;
      if (!object) return answer(404, 'Not downloaded');
      handle = await open(object, 'r');
      info = await handle.stat();
      oid = placeholder.oid;
    }

    const size = info.size;
    const type = contentTypeFor(resolved);
    const etag = etagFor(size, info.mtimeMs, oid);
    const lastModified = info.mtime.toUTCString();
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      // Bytes are addressed by path, and the path's contents can change,
      // so revalidate rather than cache indefinitely.
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': lastModified,
    };
    // HTML and SVG from the vault never run as a page: no script, no forms, its own origin.
    if (DOCUMENT_TYPES.test(type)) headers['Content-Security-Policy'] = DOCUMENT_POLICY;

    const ask = rangeStillValid(request.headers.get('if-range'), etag, lastModified)
      ? parseRange(request.headers.get('range'), size)
      : 'whole';
    if (ask === 'unsatisfiable') {
      await handle.close();
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
    }

    const { start, end } = ask === 'whole' ? { start: 0, end: size - 1 } : ask;
    const length = Math.max(0, end - start + 1);
    headers['Content-Length'] = String(length);
    if (ask !== 'whole') headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    const status = ask === 'whole' ? 200 : 206;

    if (request.method === 'HEAD' || length === 0) {
      await handle.close();
      return new Response(null, { status, headers });
    }
    // The stream owns the handle from here and closes it when done or cancelled.
    const body = Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream;
    handle = null;
    return new Response(body, { status, headers });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') logger.error(`opal-file: failed to read ${resolved}`, error);
    return answer(404, 'Not found');
  }
}

/** Must run after app.whenReady(). */
export function registerOpalFileProtocol(deps: OpalFileProtocolDependencies): void {
  protocol.handle(OPAL_FILE_SCHEME, (request) => serveOpalFile(request, deps));
}
