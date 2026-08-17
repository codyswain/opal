import { readdir, stat, open } from 'fs/promises';
import path from 'path';
import { classifyFile } from '@/common/fileKind';
import { normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import type { DiskEntry, DirectoryListing } from '@/types/disk';

export interface DiskReaderDependencies {
  registry: RootRegistry;
}

export interface ReadDirectoryOptions {
  /** Include dotfiles. Default false. */
  includeHidden?: boolean;
}

export interface TextFileContents {
  path: string;
  text: string;
  /** True when the file was longer than maxBytes and `text` is a prefix. */
  truncated: boolean;
  /** Full size on disk, regardless of truncation. */
  size: number;
}

/**
 * Previews must never load a multi-gigabyte log into the renderer, so reads are
 * capped. 2 MB is far more text than any preview can usefully display and small
 * enough to cross IPC without a stall.
 */
const DEFAULT_MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * Reads one directory level at a time. Never recurses.
 *
 * Laziness is a product decision, not just an optimization: Opal must be able
 * to point at a huge tree and stay responsive without indexing anything the
 * user did not ask it to index.
 */
export class DiskReader {
  private deps: DiskReaderDependencies;

  constructor(deps: DiskReaderDependencies) {
    this.deps = deps;
  }

  async readDirectory(
    dirPath: string,
    options: ReadDirectoryOptions = {}
  ): Promise<DirectoryListing> {
    const resolved = await this.deps.registry.assertAllowed(dirPath);

    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new Error(`Cannot list because it is not a directory: ${dirPath}`);
    }

    const dirents = await readdir(resolved, { withFileTypes: true });
    const entries: DiskEntry[] = [];

    for (const dirent of dirents) {
      if (!options.includeHidden && dirent.name.startsWith('.')) continue;

      const childPath = normalizePath(path.join(resolved, dirent.name));

      // A child can vanish between readdir and stat (an external tool deleting
      // during a browse). One missing entry must not fail the whole listing.
      try {
        const childInfo = await stat(childPath);
        const isDirectory = childInfo.isDirectory();
        entries.push({
          path: childPath,
          name: dirent.name,
          kind: isDirectory ? 'directory' : classifyFile(dirent.name),
          isDirectory,
          size: isDirectory ? 0 : childInfo.size,
          mtimeMs: childInfo.mtimeMs,
        });
      } catch {
        continue;
      }
    }

    entries.sort(compareEntries);
    return { path: resolved, entries };
  }

  async statEntry(target: string): Promise<DiskEntry> {
    const resolved = await this.deps.registry.assertAllowed(target);
    const info = await stat(resolved);
    const isDirectory = info.isDirectory();
    const name = path.basename(resolved);

    return {
      path: resolved,
      name,
      kind: isDirectory ? 'directory' : classifyFile(name),
      isDirectory,
      size: isDirectory ? 0 : info.size,
      mtimeMs: info.mtimeMs,
    };
  }

  async readTextFile(
    target: string,
    options: { maxBytes?: number } = {}
  ): Promise<TextFileContents> {
    const resolved = await this.deps.registry.assertAllowed(target);

    const info = await stat(resolved);
    if (info.isDirectory()) {
      throw new Error(`Cannot read as text because it is not a file: ${target}`);
    }

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES;
    const truncated = info.size > maxBytes;

    // Read only the prefix rather than the whole file, so an enormous file
    // costs a fixed amount of memory instead of its full size.
    const handle = await open(resolved, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(info.size, maxBytes));
      await handle.read(buffer, 0, buffer.length, 0);
      return {
        path: resolved,
        text: buffer.toString('utf-8'),
        truncated,
        size: info.size,
      };
    } finally {
      await handle.close();
    }
  }
}

/** Directories first, then case-insensitive name order — Finder's convention. */
function compareEntries(a: DiskEntry, b: DiskEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
