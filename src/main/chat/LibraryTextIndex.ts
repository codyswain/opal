import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises';
import path from 'path';
import { classifyFile } from '@/common/fileKind';
import { isInsideRoot, normalizePath } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { scanRootsFor, walkRoot } from '@/main/fs/rootTraversal';
import { splitMarkdown } from '@/main/fs/MetadataCodec';
import { CHAT_INDEX_FILE_LIMIT, type IndexHit, type LibraryIndexStatus, type TextChunk } from '@/types/chat';
import { chunkText } from './chunkText';
import type { EmbeddingProvider } from './EmbeddingProvider';

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
}

interface IndexFile {
  version: 1;
  dimensions: number;
  files: IndexedFile[];
  chunks: StoredChunk[];
  lastIndexedAt: number | null;
}

export interface LibraryTextIndexDependencies {
  registry: RootRegistry;
  directory: string;
  provider: () => Promise<EmbeddingProvider>;
  onChanged?: () => void;
  now?: () => number;
}

const INDEXABLE = new Set(['markdown', 'text']);

/**
 * Chunks and vectors for the library's text, kept in memory and mirrored to
 * two files under the library directory. Updates embed only new or changed
 * files, so unchanged text never costs another API call.
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
  private loaded = false;

  constructor(private deps: LibraryTextIndexDependencies) {}

  private get metaFile(): string { return path.join(this.deps.directory, 'chunks.json'); }
  private get vectorFile(): string { return path.join(this.deps.directory, 'vectors.f32'); }

  status(): LibraryIndexStatus {
    return {
      files: this.files.size,
      chunks: this.chunks.size,
      staleFiles: this.stale.size,
      indexing: this.indexing !== null,
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
    this.indexing = this.run().finally(() => { this.indexing = null; this.deps.onChanged?.(); });
    this.deps.onChanged?.();
    return this.indexing;
  }

  search(vector: Float32Array, k: number, floor: number): IndexHit[] {
    if (vector.length !== this.dimensions) return [];
    const scored: IndexHit[] = [];
    for (const [id, stored] of this.vectors) {
      let dot = 0;
      for (let i = 0; i < vector.length; i += 1) dot += vector[i] * stored[i];
      if (dot < floor) continue;
      const chunk = this.chunks.get(id);
      if (!chunk) continue;
      scored.push({ path: chunk.path, chunkIndex: chunk.index, start: chunk.start, text: chunk.text, score: dot });
    }
    scored.sort((left, right) => right.score - left.score || (left.path < right.path ? -1 : 1) || left.chunkIndex - right.chunkIndex);
    return scored.slice(0, k);
  }

  private async run(): Promise<LibraryIndexStatus> {
    await this.load();
    this.error = null;
    this.skipped = [];
    try {
      const provider = await this.deps.provider();
      if (this.dimensions !== 0 && this.dimensions !== provider.dimensions) {
        this.files.clear(); this.chunks.clear(); this.vectors.clear();
      }
      this.dimensions = provider.dimensions;
      const seen = new Set<string>();
      const pending: { path: string; revision: string; chunks: TextChunk[] }[] = [];
      for (const root of scanRootsFor(this.deps.registry.list())) {
        await walkRoot(this.deps.registry, root, {
          onDirectory: () => undefined,
          onFile: async (file) => {
            if (!INDEXABLE.has(classifyFile(path.basename(file)))) return;
            seen.add(file);
            try {
              const info = await stat(file);
              if (info.size > CHAT_INDEX_FILE_LIMIT) { this.skipped.push({ path: file, reason: 'larger than 1 MiB' }); return; }
              const bytes = await readFile(file);
              const revision = createHash('sha256').update(bytes).digest('hex');
              if (this.files.get(file)?.revision === revision) return;
              const text = bodyOf(file, bytes);
              pending.push({ path: file, revision, chunks: chunkText(text) });
            } catch (error) {
              this.skipped.push({ path: file, reason: error instanceof Error ? error.message : String(error) });
            }
          },
          onError: (target, error) => { this.skipped.push({ path: target, reason: error instanceof Error ? error.message : String(error) }); },
        });
      }
      for (const file of [...this.files.keys()]) {
        if (!seen.has(file)) this.dropFile(file);
      }
      const texts = pending.flatMap((entry) => entry.chunks.map((chunk) => chunk.text));
      const vectors = texts.length > 0 ? await provider.embed(texts) : [];
      if (vectors.length !== texts.length) throw new Error('The embedding service returned the wrong number of vectors.');
      let cursor = 0;
      for (const entry of pending) {
        this.dropFile(entry.path);
        const chunkIds: number[] = [];
        for (const chunk of entry.chunks) {
          const id = this.nextId++;
          this.chunks.set(id, { id, path: entry.path, index: chunk.index, start: chunk.start, text: chunk.text });
          this.vectors.set(id, vectors[cursor++]);
          chunkIds.push(id);
        }
        this.files.set(entry.path, { path: entry.path, revision: entry.revision, chunkIds });
      }
      this.stale.clear();
      this.lastIndexedAt = (this.deps.now ?? Date.now)();
      await this.persist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    return this.status();
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

export function isIndexable(target: string, roots: readonly string[]): boolean {
  return INDEXABLE.has(classifyFile(path.basename(target))) && roots.some((root) => isInsideRoot(root, target));
}
