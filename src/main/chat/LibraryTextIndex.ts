import { matchingSnippet, searchCurrentText } from './contentSearch';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises';
import path from 'path';
import { classifyFile } from '@/common/fileKind';
import { isInsideRoot, normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { scanRootsFor, walkRoot } from '@/main/fs/rootTraversal';
import { splitMarkdown } from '@/main/fs/MetadataCodec';
import {
  CHAT_EMBED_BATCH,
  CHAT_INDEX_FILE_LIMIT,
  CHAT_INDEX_PDF_LIMIT,
  type ContentSearchResult,
  type IndexHit,
  type IndexProgress,
  type LibraryIndexStatus,
  type TextChunk,
} from '@/types/chat';
import { readDatedNotes, type DateRequest, type DatedContext } from './datedNotes';
import { chunkText } from './chunkText';
import type { EmbeddingProvider } from './EmbeddingProvider';
import { extractPdfText, isPdf, pageAt, type ExtractPdfOptions } from './pdfText';

interface IndexedFile {
  path: string;
  revision: string;
  chunkIds: number[];
}

interface StoredChunk {
  id: number;
  path: string;
  index: number;
  start: number;
  text: string;
  page?: number;
}

interface IndexFile {
  version: 1;
  dimensions: number;
  files: IndexedFile[];
  chunks: StoredChunk[];
  lastIndexedAt: number | null;
}

interface PendingFile {
  path: string;
  revision: string;
  chunks: (TextChunk & { page?: number })[];
}

export interface LibraryTextIndexDependencies {
  registry: RootRegistry;
  directory: string;
  provider: () => Promise<EmbeddingProvider>;
  onChanged?: () => void;
  now?: () => number;
  /** Text of a PDF; replaceable in tests. */
  extractPdf?: (bytes: Uint8Array, options: ExtractPdfOptions) => Promise<string>;
  /** Milliseconds between progress notifications and between mid-run saves. */
  progressIntervalMs?: number;
  persistIntervalMs?: number;
}

const INDEXABLE = new Set(['markdown', 'text', 'pdf']);

class Cancelled extends Error {}

/**
 * Chunks and vectors for the library's text, kept in memory and mirrored to
 * two files under the library directory. Updates embed only new or changed
 * files, so unchanged text never costs another API call. An update reports
 * progress, saves as it goes, and can be cancelled: files already embedded
 * are kept and the rest stay counted as changes.
 */
export class LibraryTextIndex {
  private files = new Map<string, IndexedFile>();
  private chunks = new Map<number, StoredChunk>();
  private vectors = new Map<number, Float32Array>();
  private nextId = 1;
  private dimensions = 0;
  private lastIndexedAt: number | null = null;
  private error: string | null = null;
  private skipped: { path: string; reason: string }[] = [];
  private stale = new Set<string>();
  private indexing: Promise<LibraryIndexStatus> | null = null;
  private progress: IndexProgress | null = null;
  private cancelRequested = false;
  private cancelled = false;
  private lastNotified = 0;
  private loaded = false;

  constructor(private deps: LibraryTextIndexDependencies) {}

  private get metaFile(): string { return path.join(this.deps.directory, 'chunks.json'); }
  private get vectorFile(): string { return path.join(this.deps.directory, 'vectors.f32'); }
  private get now(): number { return (this.deps.now ?? Date.now)(); }

  status(): LibraryIndexStatus {
    return {
      files: this.files.size,
      chunks: this.chunks.size,
      staleFiles: this.stale.size,
      indexing: this.indexing !== null,
      progress: this.progress ? { ...this.progress } : null,
      cancelled: this.cancelled,
      lastIndexedAt: this.lastIndexedAt,
      error: this.error,
      skipped: [...this.skipped],
      ready: this.lastIndexedAt !== null,
    };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const meta = JSON.parse(await readFile(this.metaFile, 'utf8')) as IndexFile;
      if (meta.version !== 1 || !Array.isArray(meta.files) || !Array.isArray(meta.chunks)) return;
      const raw = await readFile(this.vectorFile);
      const floats = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
      if (floats.length !== meta.chunks.length * meta.dimensions) return;
      this.dimensions = meta.dimensions;
      meta.files.forEach((file) => this.files.set(file.path, file));
      meta.chunks.forEach((chunk, position) => {
        this.chunks.set(chunk.id, chunk);
        this.vectors.set(chunk.id, floats.slice(position * meta.dimensions, (position + 1) * meta.dimensions));
        this.nextId = Math.max(this.nextId, chunk.id + 1);
      });
      this.lastIndexedAt = meta.lastIndexedAt;
    } catch {
      // A missing or unreadable index simply means nothing is indexed yet.
    }
  }

  /** Watcher hook: files under these directories are re-checked on the next update. */
  markChanged(directories: readonly string[]): void {
    if (this.lastIndexedAt === null) return;
    let changed = false;
    for (const directory of directories) {
      const normalized = normalizePath(directory);
      for (const file of this.files.keys()) {
        if (path.dirname(file) === normalized && !this.stale.has(file)) { this.stale.add(file); changed = true; }
      }
      // New files in a known directory count too; one entry per directory suffices.
      if (!this.stale.has(normalized)) { this.stale.add(normalized); changed = true; }
    }
    if (changed) this.deps.onChanged?.();
  }

  update(): Promise<LibraryIndexStatus> {
    if (this.indexing) return this.indexing;
    this.cancelRequested = false;
    this.cancelled = false;
    this.indexing = (async () => {
      try {
        await this.run();
      } finally {
        this.indexing = null;
        this.progress = null;
      }
      this.deps.onChanged?.();
      return this.status();
    })();
    this.deps.onChanged?.();
    return this.indexing;
  }

  /** Stops the running update after the current step; resolves with the final status. */
  async cancel(): Promise<LibraryIndexStatus> {
    if (!this.indexing) return this.status();
    this.cancelRequested = true;
    return this.indexing;
  }

  async searchContent(query: unknown, deep: unknown = false): Promise<ContentSearchResult> {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || typeof deep !== 'boolean') throw new Error('Invalid content search.');
    if (deep) return searchCurrentText(this.deps.registry, query.trim());
    await this.load();
    const result: ContentSearchResult = { hits: [], incomplete: false };
    const seen = new Set<string>();
    for (const chunk of this.chunks.values()) {
      if (seen.has(chunk.path) || !isIndexable(chunk.path, this.deps.registry.list())) continue;
      const excerpt = matchingSnippet(chunk.text, query.trim());
      if (!excerpt) continue;
      if (result.hits.length >= 50) { result.incomplete = true; break; }
      seen.add(chunk.path);
      result.hits.push({ path: chunk.path, name: path.basename(chunk.path), excerpt });
    }
    return result;
  }

  readDated(request: DateRequest): Promise<DatedContext> { return readDatedNotes(this.deps.registry, request); }

  search(vector: Float32Array, k: number, floor: number): IndexHit[] {
    if (vector.length !== this.dimensions) return [];
    const scored: IndexHit[] = [];
    for (const [id, stored] of this.vectors) {
      let dot = 0;
      for (let i = 0; i < vector.length; i += 1) dot += vector[i] * stored[i];
      if (dot < floor) continue;
      const chunk = this.chunks.get(id);
      if (!chunk) continue;
      scored.push({ path: chunk.path, chunkIndex: chunk.index, start: chunk.start, text: chunk.text, score: dot, ...(chunk.page ? { page: chunk.page } : {}) });
    }
    scored.sort((left, right) => right.score - left.score || (left.path < right.path ? -1 : 1) || left.chunkIndex - right.chunkIndex);
    return scored.slice(0, k);
  }

  private async run(): Promise<void> {
    await this.load();
    this.error = null;
    this.skipped = [];
    let remaining: PendingFile[] = [];
    try {
      const provider = await this.deps.provider();
      if (this.dimensions !== 0 && this.dimensions !== provider.dimensions) {
        this.files.clear(); this.chunks.clear(); this.vectors.clear();
      }
      this.dimensions = provider.dimensions;

      const candidates = await this.scan();
      const seen = new Set(candidates);
      for (const file of [...this.files.keys()]) {
        if (!seen.has(file)) this.dropFile(file);
      }
      remaining = await this.read(candidates);
      await this.embed(provider, remaining);
      this.stale.clear();
      this.lastIndexedAt = this.now;
      await this.persist();
    } catch (error) {
      if (error instanceof Cancelled) {
        this.cancelled = true;
        // What was embedded is kept; the rest shows up as pending changes.
        this.stale = new Set(remaining.map((entry) => entry.path));
        if (this.files.size > 0 || this.lastIndexedAt !== null) this.lastIndexedAt = this.now;
        try { await this.persist(); } catch (persistError) { this.error = describe(persistError); }
      } else {
        this.error = describe(error);
      }
    }
  }

  /** Every indexable file under the opened roots. */
  private async scan(): Promise<string[]> {
    const files: string[] = [];
    this.report({ phase: 'scanning', done: 0, total: 0, currentFile: null }, true);
    for (const root of scanRootsFor(this.deps.registry.list())) {
      await walkRoot(this.deps.registry, root, {
        onDirectory: () => { this.checkCancelled(); },
        onFile: async (file) => {
          if (!INDEXABLE.has(classifyFile(path.basename(file)))) return;
          files.push(file);
          this.report({ phase: 'scanning', done: files.length, total: 0, currentFile: null });
        },
        onError: (target, error) => { this.skipped.push({ path: target, reason: describe(error) }); },
      });
    }
    return files;
  }

  /** Reads, hashes and chunks files whose bytes changed since they were indexed. */
  private async read(candidates: string[]): Promise<PendingFile[]> {
    const pending: PendingFile[] = [];
    this.report({ phase: 'reading', done: 0, total: candidates.length, currentFile: null }, true);
    for (const [position, file] of candidates.entries()) {
      this.checkCancelled();
      this.report({ phase: 'reading', done: position, total: candidates.length, currentFile: file });
      try {
        const pdf = isPdf(file);
        const info = await stat(file);
        const limit = pdf ? CHAT_INDEX_PDF_LIMIT : CHAT_INDEX_FILE_LIMIT;
        if (info.size > limit) { this.skipped.push({ path: file, reason: `larger than ${pdf ? '25' : '1'} MiB` }); continue; }
        const bytes = await readFile(file);
        const revision = createHash('sha256').update(bytes).digest('hex');
        if (this.files.get(file)?.revision === revision) continue;
        if (pdf) {
          const extract = this.deps.extractPdf ?? extractPdfText;
          const text = await extract(bytes, { maxCharacters: CHAT_INDEX_FILE_LIMIT, isCancelled: () => this.cancelRequested });
          this.checkCancelled();
          if (text.trim().length === 0) { this.skipped.push({ path: file, reason: 'no text layer (scanned document?)' }); continue; }
          const chunks = chunkText(text.slice(0, CHAT_INDEX_FILE_LIMIT)).map((chunk) => ({ ...chunk, page: pageAt(text, chunk.start) }));
          pending.push({ path: file, revision, chunks });
        } else {
          pending.push({ path: file, revision, chunks: chunkText(bodyOf(file, bytes)) });
        }
      } catch (error) {
        this.skipped.push({ path: file, reason: describe(error) });
      }
    }
    return pending;
  }

  /**
   * Embeds in fixed batches and commits a file as soon as all its passages
   * have vectors. `remaining` is trimmed in place so a cancellation knows
   * what was left.
   */
  private async embed(provider: EmbeddingProvider, remaining: PendingFile[]): Promise<void> {
    const total = remaining.reduce((sum, entry) => sum + entry.chunks.length, 0);
    let done = 0;
    let lastPersist = this.now;
    this.report({ phase: 'embedding', done, total, currentFile: remaining[0]?.path ?? null }, true);
    const buffered = new Map<string, Float32Array[]>();
    const sent = new Map<string, number>();
    while (remaining.length > 0) {
      this.checkCancelled();
      // Take up to one batch of passages, possibly spanning several files.
      const batch: { file: PendingFile; text: string }[] = [];
      for (const entry of remaining) {
        let count = sent.get(entry.path) ?? 0;
        while (count < entry.chunks.length && batch.length < CHAT_EMBED_BATCH) {
          batch.push({ file: entry, text: entry.chunks[count].text });
          count += 1;
        }
        sent.set(entry.path, count);
        if (batch.length >= CHAT_EMBED_BATCH) break;
      }
      if (batch.length === 0) {
        // Only files without passages are left; commit them as empty.
        for (const entry of remaining.splice(0)) this.commit(entry, []);
        break;
      }
      const vectors = await provider.embed(batch.map((item) => item.text));
      if (vectors.length !== batch.length) throw new Error('The embedding service returned the wrong number of vectors.');
      batch.forEach((item, position) => {
        const list = buffered.get(item.file.path) ?? [];
        list.push(vectors[position]);
        buffered.set(item.file.path, list);
      });
      done += batch.length;
      while (remaining.length > 0) {
        const head = remaining[0];
        const vectorsFor = buffered.get(head.path) ?? [];
        if (vectorsFor.length < head.chunks.length) break;
        this.commit(head, vectorsFor);
        buffered.delete(head.path);
        remaining.shift();
      }
      this.report({ phase: 'embedding', done, total, currentFile: remaining[0]?.path ?? null });
      if (this.now - lastPersist >= (this.deps.persistIntervalMs ?? 15_000)) {
        await this.persist();
        lastPersist = this.now;
      }
    }
  }

  private commit(entry: PendingFile, vectors: Float32Array[]): void {
    this.dropFile(entry.path);
    const chunkIds: number[] = [];
    entry.chunks.forEach((chunk, position) => {
      const id = this.nextId++;
      this.chunks.set(id, { id, path: entry.path, index: chunk.index, start: chunk.start, text: chunk.text, ...(chunk.page ? { page: chunk.page } : {}) });
      this.vectors.set(id, vectors[position]);
      chunkIds.push(id);
    });
    this.files.set(entry.path, { path: entry.path, revision: entry.revision, chunkIds });
  }

  private checkCancelled(): void {
    if (this.cancelRequested) throw new Cancelled();
  }

  private report(progress: IndexProgress, force = false): void {
    this.progress = progress;
    const interval = this.deps.progressIntervalMs ?? 250;
    if (!force && this.now - this.lastNotified < interval) return;
    this.lastNotified = this.now;
    this.deps.onChanged?.();
  }

  private dropFile(file: string): void {
    const existing = this.files.get(file);
    if (!existing) return;
    for (const id of existing.chunkIds) { this.chunks.delete(id); this.vectors.delete(id); }
    this.files.delete(file);
  }

  private async persist(): Promise<void> {
    await mkdir(this.deps.directory, { recursive: true });
    const chunks = [...this.chunks.values()];
    const floats = new Float32Array(chunks.length * this.dimensions);
    chunks.forEach((chunk, position) => floats.set(this.vectors.get(chunk.id) as Float32Array, position * this.dimensions));
    const meta: IndexFile = { version: 1, dimensions: this.dimensions, files: [...this.files.values()], chunks, lastIndexedAt: this.lastIndexedAt };
    const metaTemp = `${this.metaFile}.${randomUUID()}.tmp`;
    const vectorTemp = `${this.vectorFile}.${randomUUID()}.tmp`;
    await writeFile(vectorTemp, Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength));
    await writeFile(metaTemp, JSON.stringify(meta), 'utf8');
    await rename(vectorTemp, this.vectorFile);
    await rename(metaTemp, this.metaFile);
  }
}

/** Markdown bodies are indexed without their frontmatter block. */
function bodyOf(file: string, bytes: Buffer): string {
  if (classifyFile(path.basename(file)) === 'markdown') {
    try {
      const split = splitMarkdown(bytes);
      return bytes.subarray(split.bodyOffset).toString('utf8');
    } catch {
      return bytes.toString('utf8');
    }
  }
  return bytes.toString('utf8');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isIndexable(target: string, roots: readonly string[]): boolean {
  return INDEXABLE.has(classifyFile(path.basename(target))) && roots.some((root) => isInsideRoot(root, target));
}
