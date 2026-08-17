import { protocol } from 'electron';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import {
  OPAL_FILE_SCHEME,
  opalFileUrlToPath,
  contentTypeFor,
} from '@/common/opalFileUrl';
import {
  OPAL_THUMB_SCHEME,
  opalThumbUrlToPath,
} from '@/common/opalThumbUrl';
import type { ThumbnailService } from '@/main/fs/ThumbnailService';

export { OPAL_FILE_SCHEME, OPAL_THUMB_SCHEME };
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { PathNotAllowedError } from '@/main/fs/RootRegistry';
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
    { scheme: OPAL_THUMB_SCHEME, privileges },
  ]);
}

export interface OpalFileProtocolDependencies {
  registry: RootRegistry;
}

/** Must run after app.whenReady(). */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

export function registerOpalFileProtocol(deps: OpalFileProtocolDependencies): void {
  protocol.handle(OPAL_FILE_SCHEME, async (request) => {
    let requestedPath: string;
    try {
      requestedPath = opalFileUrlToPath(request.url);
    } catch {
      return new Response('Bad asset URL', { status: 400, headers: CORS_HEADERS });
    }

    let resolved: string;
    try {
      // Same guard as the IPC surface. Without it this protocol would serve
      // any file the user can read to anything running in the renderer.
      resolved = await deps.registry.assertAllowed(requestedPath);
    } catch (error) {
      if (error instanceof PathNotAllowedError) {
        return new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
      }
      logger.error('opal-file: failed to authorize request', error);
      return new Response('Internal error', { status: 500, headers: CORS_HEADERS });
    }

    try {
      const info = await stat(resolved);
      if (info.isDirectory()) {
        return new Response('Not a file', { status: 400, headers: CORS_HEADERS });
      }

      const body = Readable.toWeb(createReadStream(resolved)) as ReadableStream;

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentTypeFor(resolved),
          'Content-Length': String(info.size),
          // Bytes are addressed by path, and the path's contents can change,
          // so revalidate rather than cache indefinitely.
          'Cache-Control': 'no-cache',
          ...CORS_HEADERS,
        },
      });
    } catch (error) {
      logger.error(`opal-file: failed to read ${resolved}`, error);
      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }
  });
}

export function registerOpalThumbProtocol(deps: { thumbnails: ThumbnailService }): void {
  protocol.handle(OPAL_THUMB_SCHEME, async (request) => {
    let requestedPath: string;
    try {
      requestedPath = opalThumbUrlToPath(request.url);
    } catch {
      return new Response('Bad thumbnail URL', { status: 400 });
    }

    try {
      // getThumbnailPath performs the root check itself, so there is no
      // separate guard to keep in sync here.
      const cachePath = await deps.thumbnails.getThumbnailPath(requestedPath);
      const body = Readable.toWeb(createReadStream(cachePath)) as ReadableStream;
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          // The cache key already includes mtime and size, so a given URL's
          // bytes never change and may be cached aggressively.
          'Cache-Control': 'max-age=31536000, immutable',
        },
      });
    } catch (error) {
      if (error instanceof PathNotAllowedError) {
        return new Response('Forbidden', { status: 403 });
      }
      // A missing thumbnail is normal for unsupported formats; the renderer
      // falls back to a kind icon on error.
      return new Response('No thumbnail', { status: 404 });
    }
  });
}
