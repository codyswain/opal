import { protocol } from 'electron';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import {
  OPAL_FILE_SCHEME,
  opalFileUrlToPath,
  contentTypeFor,
} from '@/common/opalFileUrl';

export { OPAL_FILE_SCHEME };
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
  protocol.registerSchemesAsPrivileged([
    {
      scheme: OPAL_FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export interface OpalFileProtocolDependencies {
  registry: RootRegistry;
}

/** Must run after app.whenReady(). */
export function registerOpalFileProtocol(deps: OpalFileProtocolDependencies): void {
  protocol.handle(OPAL_FILE_SCHEME, async (request) => {
    let requestedPath: string;
    try {
      requestedPath = opalFileUrlToPath(request.url);
    } catch {
      return new Response('Bad asset URL', { status: 400 });
    }

    let resolved: string;
    try {
      // Same guard as the IPC surface. Without it this protocol would serve
      // any file the user can read to anything running in the renderer.
      resolved = await deps.registry.assertAllowed(requestedPath);
    } catch (error) {
      if (error instanceof PathNotAllowedError) {
        return new Response('Forbidden', { status: 403 });
      }
      logger.error('opal-file: failed to authorize request', error);
      return new Response('Internal error', { status: 500 });
    }

    try {
      const info = await stat(resolved);
      if (info.isDirectory()) {
        return new Response('Not a file', { status: 400 });
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
        },
      });
    } catch (error) {
      logger.error(`opal-file: failed to read ${resolved}`, error);
      return new Response('Not found', { status: 404 });
    }
  });
}
