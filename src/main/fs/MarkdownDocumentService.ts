import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { appendFile, lstat, mkdir, open, rename, stat, unlink, writeFile, type FileHandle } from 'fs/promises';
import path from 'path';
import { isMap, isNode, parseDocument, type Document } from 'yaml';
import { classifyFile } from '@/common/fileKind';
import { isFsPathAtOrBelow } from '@/common/fsPaths';
import type { ActivityRecorder } from '@/main/activity/ActivityService';
import type { RootRegistry } from './RootRegistry';
import { MetadataError, assertNoSymlinks, splitMarkdown } from './MetadataCodec';
import { MutationQueue, filesystemMutationQueue } from './MutationQueue';
import type { MetadataService } from './MetadataService';
import { type PageHistory, pageCreated } from './pageCreated';
import { normalizePath } from './paths';
import {
  MARKDOWN_DOCUMENT_LIMIT,
  type MarkdownCopyLabel,
  type MarkdownDocument,
  type MarkdownProperties,
  type MarkdownWriteResult,
  type PageProperty,
} from '@/types/markdown';

/** Safe, user-facing errors; the IPC layer may show these messages verbatim. */
export class MarkdownError extends Error {
  constructor(message: string) { super(message); this.name = 'MarkdownError'; }
}
export class MarkdownConflictError extends MarkdownError {
  constructor(message = 'This file changed on disk since you opened it.') { super(message); this.name = 'MarkdownConflictError'; }
}

/** The line a `replaceLine` call changes: its 0-based index in the file, its text now and its new text. */
export interface LineEdit {
  index: number;
  expected: string;
  replacement: string;
}

export interface MarkdownDocumentServiceDependencies {
  registry: RootRegistry;
  queue?: MutationQueue;
  metadata?: Pick<MetadataService, 'invalidate'>;
  activity?: Pick<ActivityRecorder, 'noteEdited'>;
  /** Where a copy of a page's text goes when the note's own folder cannot take it. */
  recoveryDir?: string;
  /** Git history, for when a page without a stated time was created. */
  history?: Pick<PageHistory, 'addedAt'>;
}

/** A Markdown file split the way the editor sees it. */
export interface ParsedMarkdown {
  /** The BOM and frontmatter bytes, written back untouched. */
  prefix: Buffer;
  /** The body as decoded, with its own line endings. */
  source: string;
  /** The body with CRLF line endings as LF: the text the editor holds. */
  body: string;
  /** The line ending new lines get on write. */
  newline: string;
  hasFrontmatter: boolean;
  /** Top-level frontmatter keys, which Obsidian calls properties. */
  properties: number;
  /** The same keys with their values as text, for the properties block. */
  frontmatter: PageProperty[];
}

interface LoadedFile extends ParsedMarkdown {
  resolved: string;
  bytes: Buffer;
  revision: string;
}

function revisionOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The editor's view of a Markdown file: the body after any frontmatter block.
 * Writes keep the BOM, the frontmatter bytes and every unchanged byte of the
 * body exactly, replace the file atomically, and refuse to overwrite a file
 * whose bytes changed since the caller read it.
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
      properties: loaded.properties,
    };
  }

  /** The page's frontmatter as text and its file's path, times and size, for the properties block. */
  async properties(target: string): Promise<MarkdownProperties> {
    const loaded = await this.load(target);
    const info = await stat(loaded.resolved);
    const { root, relativePath } = this.place(loaded.resolved);
    return {
      path: loaded.resolved,
      relativePath,
      properties: loaded.frontmatter,
      created: await pageCreated(loaded.frontmatter, root, relativePath, this.deps.history),
      modifiedMs: info.mtimeMs,
      size: info.size,
    };
  }

  write(target: string, body: string, expectedRevision: string): Promise<MarkdownWriteResult> {
    return this.queue.run(async () => {
      if (typeof body !== 'string') throw new MarkdownError('Body must be text.');
      const loaded = await this.load(target);
      if (loaded.revision !== expectedRevision) throw new MarkdownConflictError();
      return this.replace(loaded, joinMarkdown(loaded, body.replace(/\r\n/g, '\n')));
    });
  }

  /**
   * Changes one line of a file and leaves every other byte as it is, under
   * the same queue and atomic replace as `write`. `pick` sees the file's
   * whole text as it is now, BOM and frontmatter included, and names the
   * line; the write is refused when that line no longer reads `expected`.
   */
  replaceLine(target: string, pick: (text: string) => LineEdit): Promise<MarkdownWriteResult> {
    return this.queue.run(async () => {
      const loaded = await this.load(target);
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(loaded.bytes);
      } catch {
        throw new MarkdownError('This file is not valid UTF-8 text and cannot be edited here.');
      }
      const { index, expected, replacement } = pick(text);
      if (/[\r\n]/.test(expected) || /[\r\n]/.test(replacement)) throw new MarkdownError('A line cannot hold a line break.');
      const fileLines = text.split('\n');
      const current = fileLines[index];
      if (!Number.isInteger(index) || current === undefined || current.replace(/\r$/, '') !== expected) {
        throw new MarkdownConflictError('This line changed on disk since it was read.');
      }
      fileLines[index] = current.endsWith('\r') ? `${replacement}\r` : replacement;
      return this.replace(loaded, Buffer.from(fileLines.join('\n'), 'utf8'));
    });
  }

  /**
   * Replaces the loaded file with `next` atomically, and refuses when the
   * file's bytes changed since it was loaded. Runs inside the queue.
   */
  private async replace(loaded: LoadedFile, next: Buffer): Promise<MarkdownWriteResult> {
    // Saving text that matches the file leaves the file alone.
    if (next.equals(loaded.bytes)) return { revision: loaded.revision };
    if (next.length > MARKDOWN_DOCUMENT_LIMIT) throw new MarkdownError('This file is too large to save (16 MiB limit).');
    const temporary = path.join(path.dirname(loaded.resolved), `.opal-edit-${randomUUID()}`);
    let mode = 0o644;
    try { mode = (await stat(loaded.resolved)).mode & 0o777; } catch { /* keep default */ }
    // Held open across the rename, so lines appended to the old file after the check can still be read.
    const original = await open(loaded.resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const handle = await open(temporary, 'wx', mode);
      try { await handle.writeFile(next); await handle.sync(); } finally { await handle.close(); }
      const checked = await original.readFile();
      if (revisionOf(checked) !== loaded.revision) throw new MarkdownConflictError();
      await rename(temporary, loaded.resolved);
      await carryOverAppend(original, checked, loaded.resolved);
    } finally {
      await original.close();
      await unlink(temporary).catch(() => undefined);
      this.deps.metadata?.invalidate();
    }
    await this.deps.activity?.noteEdited(loaded.resolved);
    // The revision of what this save wrote: a carried-over append differs from it, so the page merges it in.
    return { revision: revisionOf(next) };
  }

  create(parentDir: string, baseName = 'Untitled'): Promise<{ path: string }> {
    return this.queue.run(async () => {
      const name = validName(baseName);
      const parent = await assertNoSymlinks(this.deps.registry, parentDir);
      const info = await stat(parent);
      if (!info.isDirectory()) throw new MarkdownError('Notes can only be created inside a folder.');
      const created = await writeNewNote(parent, name, '');
      this.deps.metadata?.invalidate();
      return { path: created };
    });
  }

  /**
   * Keeps text a page could not save to its note: writes it to a new
   * "<name> (<label>).md" next to the note, or in the recovery folder when
   * that folder is gone, outside the opened roots or not writable.
   */
  saveCopy(target: string, body: string, label: MarkdownCopyLabel): Promise<{ path: string }> {
    return this.queue.run(async () => {
      if (typeof body !== 'string') throw new MarkdownError('Body must be text.');
      const name = validName(`${path.basename(target).replace(/\.md$/i, '')} (${label})`);
      try {
        const parent = await assertNoSymlinks(this.deps.registry, path.dirname(target));
        const copy = await writeNewNote(parent, name, body);
        this.deps.metadata?.invalidate();
        return { path: copy };
      } catch (error) {
        if (!this.deps.recoveryDir) throw error;
        await mkdir(this.deps.recoveryDir, { recursive: true });
        return { path: await writeNewNote(this.deps.recoveryDir, name, body) };
      }
    });
  }

  /** The innermost opened folder that holds `resolved`, and the path below it. */
  private place(resolved: string): { root: string | null; relativePath: string } {
    const root = this.deps.registry.list()
      .filter((candidate) => isFsPathAtOrBelow(candidate, resolved))
      .sort((a, b) => b.length - a.length)[0];
    return root
      ? { root, relativePath: path.relative(root, resolved).split(path.sep).join('/') }
      : { root: null, relativePath: resolved };
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
    return { ...parseMarkdown(bytes), resolved, bytes, revision: revisionOf(bytes) };
  }
}

/**
 * The vault's hook appends to notes with ">>" and no lock. An append that
 * landed between the revision check and the rename went to the file the
 * rename replaced; it is added to the end of the new one. Only a pure append
 * carries over.
 */
async function carryOverAppend(original: FileHandle, checked: Buffer, target: string): Promise<void> {
  const { size } = await original.stat();
  if (size <= checked.length) return;
  const now = Buffer.alloc(size);
  await original.read(now, 0, size, 0);
  if (now.subarray(0, checked.length).equals(checked)) await appendFile(target, now.subarray(checked.length));
}

function validName(baseName: string): string {
  const name = baseName.trim();
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) throw new MarkdownError(`"${baseName}" is not a valid file name`);
  return name;
}

/** Writes `body` to a new "<name>.md" in `folder`, or "<name> 2.md" and on while a name is taken. */
async function writeNewNote(folder: string, name: string, body: string): Promise<string> {
  for (let attempt = 1; attempt <= 500; attempt += 1) {
    const candidate = normalizePath(path.join(folder, attempt === 1 ? `${name}.md` : `${name} ${attempt}.md`));
    try {
      await writeFile(candidate, body, { encoding: 'utf8', flag: 'wx' });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new MarkdownError('Could not find an unused name for the new note.');
}

/** Splits file bytes into the untouched prefix and the body the editor edits. */
export function parseMarkdown(bytes: Buffer): ParsedMarkdown {
  const hasBom = bytes.subarray(0, 3).equals(Buffer.from('\ufeff'));
  const bomLength = hasBom ? 3 : 0;
  let split: { raw: string; bodyOffset: number; newline: string };
  try {
    split = splitMarkdown(bytes);
  } catch (error) {
    if (!(error instanceof MetadataError)) throw error;
    // An unclosed or oversized frontmatter block is edited as ordinary text.
    split = { raw: '', bodyOffset: bomLength, newline: bytes.includes('\r\n') ? '\r\n' : '\n' };
  }
  const frontmatter = frontmatterEntries(split.raw);
  // A "---" block that is not YAML properties, such as a rule typed above
  // some text, stays in the page as text.
  if (frontmatter === null) split = { ...split, raw: '', bodyOffset: bomLength };
  let source: string;
  try {
    // ignoreBOM keeps a U+FEFF that starts the body; the file's own BOM is in the prefix.
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(split.bodyOffset));
  } catch {
    throw new MarkdownError('This file is not valid UTF-8 text and cannot be edited here.');
  }
  return {
    prefix: Buffer.from(bytes.subarray(0, split.bodyOffset)),
    source,
    body: source.replace(/\r\n/g, '\n'),
    newline: split.newline,
    hasFrontmatter: split.bodyOffset > bomLength,
    properties: frontmatter?.length ?? 0,
    frontmatter: frontmatter ?? [],
  };
}

/**
 * Top-level frontmatter keys and their values as text, which Obsidian calls
 * properties: none for an empty block, null when the block is not a YAML map.
 */
function frontmatterEntries(raw: string): PageProperty[] | null {
  if (!raw.trim()) return [];
  const document = parseDocument(raw);
  const contents = document.contents;
  if (!isMap(contents)) return null;
  return contents.items.map((pair) => ({
    key: propertyText(plainValue(document, pair.key)),
    values: propertyValues(plainValue(document, pair.value)),
  }));
}

/** A YAML node as plain data; an alias that expands too far stays as written. */
function plainValue(document: Document, value: unknown): unknown {
  if (!isNode(value)) return value;
  try {
    return value.toJS(document);
  } catch {
    return String(value);
  }
}

function propertyValues(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.filter((item) => item !== null && item !== undefined && item !== '').map(propertyText);
}

function propertyText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

/**
 * The file bytes for an edited body. Only the span between the first and the
 * last changed character is new: the text around it keeps its original bytes
 * and line endings, and line breaks inside it take the file's newline.
 */
export function joinMarkdown(parsed: ParsedMarkdown, body: string): Buffer {
  const before = parsed.body;
  const shortest = Math.min(before.length, body.length);
  let start = 0;
  while (start < shortest && before.charCodeAt(start) === body.charCodeAt(start)) start += 1;
  let end = 0;
  while (end < shortest - start && before.charCodeAt(before.length - 1 - end) === body.charCodeAt(body.length - 1 - end)) end += 1;
  const changed = body.slice(start, body.length - end);
  const source =
    parsed.source.slice(0, sourceOffset(parsed.source, start)) +
    (parsed.newline === '\r\n' ? changed.replace(/\n/g, '\r\n') : changed) +
    parsed.source.slice(sourceOffset(parsed.source, before.length - end));
  return Buffer.concat([parsed.prefix, Buffer.from(source, 'utf8')]);
}

/** Maps an offset in the LF body to the same place in the source text. */
function sourceOffset(source: string, offset: number): number {
  let crlfs = 0;
  for (let at = source.indexOf('\r\n'); at !== -1 && at - crlfs < offset; at = source.indexOf('\r\n', at + 2)) crlfs += 1;
  return offset + crlfs;
}
