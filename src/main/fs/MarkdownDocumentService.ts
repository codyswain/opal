import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { lstat, open, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { classifyFile } from '@/common/fileKind';
import type { ActivityRecorder } from '@/main/activity/ActivityService';
import type { RootRegistry } from './RootRegistry';
import { MetadataError, assertNoSymlinks, splitMarkdown } from './MetadataCodec';
import { MutationQueue, filesystemMutationQueue } from './MutationQueue';
import type { MetadataService } from './MetadataService';
import { normalizePath } from './paths';
import { MARKDOWN_DOCUMENT_LIMIT, type MarkdownDocument, type MarkdownWriteResult } from '@/types/markdown';

/** Safe, user-facing errors; the IPC layer may show these messages verbatim. */
export class MarkdownError extends Error {
  constructor(message: string) { super(message); this.name = 'MarkdownError'; }
}
export class MarkdownConflictError extends MarkdownError {
  constructor() { super('This file changed on disk since you opened it.'); this.name = 'MarkdownConflictError'; }
}

export interface MarkdownDocumentServiceDependencies {
  registry: RootRegistry;
  queue?: MutationQueue;
  metadata?: Pick<MetadataService, 'invalidate'>;
  activity?: Pick<ActivityRecorder, 'noteEdited'>;
}

interface LoadedFile {
  resolved: string;
  bytes: Buffer;
  prefix: Buffer;
  bom: Buffer;
  newline: string;
  body: string;
  revision: string;
  hasFrontmatter: boolean;
}

function revisionOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The editor's view of a Markdown file: the body after any frontmatter block.
 * Writes keep the BOM, the frontmatter bytes and the newline style exactly,
 * replace the file atomically, and refuse to overwrite a file whose bytes
 * changed since the caller read it.
 */
export class MarkdownDocumentService {
  private readonly queue: MutationQueue;

  constructor(private deps: MarkdownDocumentServiceDependencies) {
    this.queue = deps.queue ?? filesystemMutationQueue;
  }

  async read(target: string): Promise<MarkdownDocument> {
    const loaded = await this.load(target);
    return {
      path: loaded.resolved,
      body: loaded.body,
      revision: loaded.revision,
      size: loaded.bytes.length,
      hasFrontmatter: loaded.hasFrontmatter,
    };
  }

  write(target: string, body: string, expectedRevision: string): Promise<MarkdownWriteResult> {
    return this.queue.run(async () => {
      if (typeof body !== 'string') throw new MarkdownError('Body must be text.');
      const loaded = await this.load(target);
      if (loaded.revision !== expectedRevision) throw new MarkdownConflictError();
      const normalized = body.replace(/\r\n/g, '\n');
      const withTrailingNewline =
        loaded.body.length === 0 || loaded.body.endsWith('\n')
          ? normalized.length === 0 || normalized.endsWith('\n') ? normalized : `${normalized}\n`
          : normalized;
      const bodyBytes = Buffer.from(
        loaded.newline === '\r\n' ? withTrailingNewline.replace(/\n/g, '\r\n') : withTrailingNewline,
        'utf8'
      );
      const next = Buffer.concat([loaded.prefix, bodyBytes]);
      if (next.length > MARKDOWN_DOCUMENT_LIMIT) throw new MarkdownError('This file is too large to save (16 MiB limit).');
      const temporary = path.join(path.dirname(loaded.resolved), `.opal-edit-${randomUUID()}`);
      let mode = 0o644;
      try { mode = (await stat(loaded.resolved)).mode & 0o777; } catch { /* keep default */ }
      try {
        const handle = await open(temporary, 'wx', mode);
        try { await handle.writeFile(next); await handle.sync(); } finally { await handle.close(); }
        const latest = revisionOf(await readFile(loaded.resolved));
        if (latest !== expectedRevision) throw new MarkdownConflictError();
        await rename(temporary, loaded.resolved);
      } finally {
        await unlink(temporary).catch(() => undefined);
        this.deps.metadata?.invalidate();
      }
      await this.deps.activity?.noteEdited(loaded.resolved);
      return { revision: revisionOf(next) };
    });
  }

  create(parentDir: string, baseName = 'Untitled'): Promise<{ path: string }> {
    return this.queue.run(async () => {
      const name = baseName.trim();
      if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) throw new MarkdownError(`"${baseName}" is not a valid file name`);
      const parent = await assertNoSymlinks(this.deps.registry, parentDir);
      const info = await stat(parent);
      if (!info.isDirectory()) throw new MarkdownError('Notes can only be created inside a folder.');
      for (let attempt = 1; attempt <= 500; attempt += 1) {
        const candidate = normalizePath(path.join(parent, attempt === 1 ? `${name}.md` : `${name} ${attempt}.md`));
        try {
          await lstat(candidate);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          await writeFile(candidate, '', { encoding: 'utf8', flag: 'wx' });
          this.deps.metadata?.invalidate();
          return { path: candidate };
        }
      }
      throw new MarkdownError('Could not find an unused name for the new note.');
    });
  }

  private async load(target: string): Promise<LoadedFile> {
    const resolved = await assertNoSymlinks(this.deps.registry, target);
    const info = await lstat(resolved);
    if (!info.isFile()) throw new MarkdownError('Only files can be edited.');
    if (classifyFile(path.basename(resolved)) !== 'markdown') throw new MarkdownError('Only Markdown files can be edited here.');
    if (info.size > MARKDOWN_DOCUMENT_LIMIT) throw new MarkdownError('This file is too large to edit (16 MiB limit).');
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try { bytes = await handle.readFile(); } finally { await handle.close(); }
    let split: { bodyOffset: number; bom: Buffer; newline: string; raw: string };
    try {
      split = splitMarkdown(bytes);
    } catch (error) {
      if (!(error instanceof MetadataError)) throw error;
      // An unclosed or oversized frontmatter block is edited as ordinary text.
      const hasBom = bytes.subarray(0, 3).equals(Buffer.from('﻿'));
      split = { bodyOffset: hasBom ? 3 : 0, bom: bytes.subarray(0, hasBom ? 3 : 0), newline: bytes.includes('\r\n') ? '\r\n' : '\n', raw: '' };
    }
    const prefix = bytes.subarray(0, split.bodyOffset);
    const bodyBytes = bytes.subarray(split.bodyOffset);
    let body: string;
    try {
      body = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes);
    } catch {
      throw new MarkdownError('This file is not valid UTF-8 text and cannot be edited here.');
    }
    return {
      resolved,
      bytes,
      prefix: Buffer.from(prefix),
      bom: Buffer.from(split.bom),
      newline: split.newline,
      body: body.replace(/\r\n/g, '\n'),
      revision: revisionOf(bytes),
      hasFrontmatter: split.bodyOffset > split.bom.length,
    };
  }
}
