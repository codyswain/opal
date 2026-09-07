import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { LibraryTextIndex } from '@/main/chat/LibraryTextIndex';
import type { EmbeddingProvider } from '@/main/chat/EmbeddingProvider';
import { normalize } from '@/main/chat/EmbeddingProvider';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { PAGE_BREAK } from '@/main/chat/pdfText';
import { CHAT_EMBED_BATCH } from '@/types/chat';

/** Stands in for pdf.js: the file's bytes are the "extracted" text, `\f` marks pages; `[scan]` has no text. */
const fakePdf = async (bytes: Uint8Array): Promise<string> => {
  const text = Buffer.from(bytes).toString('utf8');
  return text === '[scan]' ? '' : text;
};

/**
 * A deterministic stand-in for OpenAI: a bag-of-characters vector, so texts
 * sharing words score higher, and every call is counted.
 */
function fakeProvider(): EmbeddingProvider & { calls: string[][] } {
  const calls: string[][] = [];
  // Each distinct word owns a dimension, so unrelated texts score exactly zero.
  const vocabulary = new Map<string, number>();
  return {
    dimensions: 256,
    calls,
    async embed(texts) {
      calls.push([...texts]);
      return texts.map((text) => {
        const vector = new Float32Array(256);
        for (const word of text.toLowerCase().split(/\W+/)) {
          if (!word) continue;
          if (!vocabulary.has(word)) vocabulary.set(word, vocabulary.size % 256);
          vector[vocabulary.get(word) as number] += 1;
        }
        return normalize(vector);
      });
    },
  };
}

let tmp: string;
let root: string;
let registry: RootRegistry;
let provider: ReturnType<typeof fakeProvider>;
let index: LibraryTextIndex;
const onChanged = vi.fn();
let now = 1_800_000_000_000;
const item = (name: string) => path.join(root, name);

beforeEach(async () => {
  onChanged.mockClear();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-chat-index-'));
  root = path.join(tmp, 'root');
  await mkdir(path.join(root, 'Deep'), { recursive: true });
  await writeFile(item('atlas.md'), '---\ntags: [research]\n---\n# Atlas\n\nThe atlas project maps mountains and rivers.\n');
  await writeFile(item('recipes.md'), '# Recipes\n\nSourdough bread needs flour water salt and patience.\n');
  await writeFile(item('Deep/notes.txt'), 'Meeting notes about mountains funding.');
  await writeFile(item('photo.jpg'), 'jpg');
  await writeFile(item('huge.md'), 'x'.repeat(1024 * 1024 + 10));
  registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  root = await registry.add(root);
  provider = fakeProvider();
  index = new LibraryTextIndex({ registry, directory: path.join(tmp, 'library', 'index'), provider: async () => provider, onChanged, now: () => now, extractPdf: fakePdf, progressIntervalMs: 0 });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('LibraryTextIndex', () => {
  it('starts empty, indexes Markdown and text without frontmatter, skips large and non-text files, and persists', async () => {
    await index.load();
    expect(index.status()).toMatchObject({ ready: false, files: 0, chunks: 0, indexing: false, progress: null, cancelled: false });
    const status = await index.update();
    expect(status).toMatchObject({ ready: true, files: 3, chunks: 3, staleFiles: 0, error: null, lastIndexedAt: now });
    expect(status.skipped).toEqual([{ path: item('huge.md'), reason: 'larger than 1 MiB' }]);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].some((text) => text.includes('tags:'))).toBe(false);
    expect(provider.calls[0].some((text) => text.includes('atlas project'))).toBe(true);
    expect(onChanged).toHaveBeenCalled();
    expect((await readdir(path.join(tmp, 'library', 'index'))).sort()).toEqual(['chunks.json', 'vectors.f32']);
    // A fresh instance reads the persisted index without embedding again.
    const reloaded = new LibraryTextIndex({ registry, directory: path.join(tmp, 'library', 'index'), provider: async () => provider });
    await reloaded.load();
    expect(reloaded.status()).toMatchObject({ ready: true, files: 3, chunks: 3 });
    const [query] = await provider.embed(['mountains']);
    const hits = reloaded.search(query, 3, 0);
    expect(hits).toHaveLength(3);
    expect([item('atlas.md'), item('Deep/notes.txt')]).toContain(hits[0].path);
    expect(hits.at(-1)?.path).toBe(item('recipes.md'));
    expect(reloaded.search(query, 1, 0)).toHaveLength(1);
  });

  it('re-embeds only changed files, drops removed ones, and counts stale directories until updated', async () => {
    await index.update();
    provider.calls.length = 0;
    await writeFile(item('recipes.md'), '# Recipes\n\nNow with rye.\n');
    await rm(item('Deep/notes.txt'));
    await writeFile(item('Deep/new.md'), 'Brand new note.');
    onChanged.mockClear();
    index.markChanged([root, item('Deep')]);
    expect(index.status().staleFiles).toBeGreaterThan(0);
    expect(onChanged).toHaveBeenCalledTimes(1);
    now += 60_000;
    const status = await index.update();
    expect(status).toMatchObject({ files: 3, staleFiles: 0, lastIndexedAt: now });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].sort()).toEqual(['# Recipes\n\nNow with rye.', 'Brand new note.']);
    const [query] = await provider.embed(['funding meeting']);
    expect(index.search(query, 5, 0).map((hit) => hit.path)).not.toContain(item('Deep/notes.txt'));
  });

  it('reports provider failures without losing the previous index and serializes concurrent updates', async () => {
    await index.update();
    const failing = new LibraryTextIndex({
      registry, directory: path.join(tmp, 'library', 'index'), provider: async () => { throw new Error('No key'); },
    });
    const [a, b] = await Promise.all([failing.update(), failing.update()]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ error: 'No key', ready: true, files: 3 });
    expect(failing.status().indexing).toBe(false);
  });

  it('ignores stale marks before anything is indexed and rejects vectors of another size', async () => {
    index.markChanged([root]);
    expect(index.status().staleFiles).toBe(0);
    await index.update();
    expect(index.search(new Float32Array(8), 3, 0)).toEqual([]);
  });

  it('indexes PDF text with page numbers, skips scans and unreadable PDFs, and surfaces the page on hits', async () => {
    await writeFile(item('paper.pdf'), `Mountains are mapped by the atlas team.${PAGE_BREAK}Rivers appear on the second page.`);
    await writeFile(item('scan.pdf'), '[scan]');
    const broken = new LibraryTextIndex({
      registry, directory: path.join(tmp, 'library', 'index'), provider: async () => provider, now: () => now,
      extractPdf: async (bytes) => { if (Buffer.from(bytes).toString('utf8') === '[scan]') throw new Error('Invalid PDF structure.'); return fakePdf(bytes); },
    });
    const status = await index.update();
    expect(status.files).toBe(4);
    expect(status.skipped).toEqual(expect.arrayContaining([{ path: item('scan.pdf'), reason: 'no text layer (scanned document?)' }]));
    const [query] = await provider.embed(['rivers second page']);
    const hit = index.search(query, 1, 0)[0];
    expect(hit).toMatchObject({ path: item('paper.pdf'), page: 1 });
    // A fresh instance sees the same page numbers from disk.
    const reloaded = new LibraryTextIndex({ registry, directory: path.join(tmp, 'library', 'index'), provider: async () => provider });
    await reloaded.load();
    expect(reloaded.search(query, 1, 0)[0]?.page).toBe(1);
    const brokenStatus = await broken.update();
    expect(brokenStatus.skipped).toEqual(expect.arrayContaining([{ path: item('scan.pdf'), reason: 'Invalid PDF structure.' }]));
  });

  it('reports progress through scanning, reading and embedding, in batches', async () => {
    for (let i = 0; i < 70; i += 1) await writeFile(item(`note-${i}.md`), `Note ${i} about topic ${i % 7}.`);
    const phases: string[] = [];
    const embedding: number[] = [];
    onChanged.mockImplementation(() => {
      const progress = index.status().progress;
      if (!progress) return;
      if (phases.at(-1) !== progress.phase) phases.push(progress.phase);
      if (progress.phase === 'embedding') embedding.push(progress.done);
    });
    const status = await index.update();
    expect(phases).toEqual(['scanning', 'reading', 'embedding']);
    expect(status).toMatchObject({ files: 73, progress: null, indexing: false, cancelled: false });
    expect(provider.calls.map((call) => call.length)).toEqual([CHAT_EMBED_BATCH, 73 - CHAT_EMBED_BATCH]);
    expect(embedding).toContain(CHAT_EMBED_BATCH);
    expect(embedding.at(-1)).toBe(73);
  });

  it('cancel keeps the files already embedded, marks the rest as changes, and the next update finishes them', async () => {
    for (let i = 0; i < 70; i += 1) await writeFile(item(`note-${i}.md`), `Note ${i} about topic ${i % 7}.`);
    const original = provider.embed.bind(provider);
    let cancelAfter: Promise<unknown> | null = null;
    provider.embed = async (texts) => {
      const vectors = await original(texts);
      // Ask to stop while the first batch is in flight; the second never starts.
      if (!cancelAfter) cancelAfter = index.cancel();
      return vectors;
    };
    const status = await index.update();
    expect(status.cancelled).toBe(true);
    expect(status.indexing).toBe(false);
    expect(status.error).toBeNull();
    expect(status.ready).toBe(true);
    expect(status.files).toBe(CHAT_EMBED_BATCH);
    expect(status.staleFiles).toBe(73 - CHAT_EMBED_BATCH);
    expect(provider.calls).toHaveLength(1);
    expect(await cancelAfter).toBe(status);
    // The committed part survived on disk.
    const reloaded = new LibraryTextIndex({ registry, directory: path.join(tmp, 'library', 'index'), provider: async () => provider });
    await reloaded.load();
    expect(reloaded.status()).toMatchObject({ files: CHAT_EMBED_BATCH, ready: true });
    provider.embed = original;
    const finished = await index.update();
    expect(finished).toMatchObject({ files: 73, staleFiles: 0, cancelled: false });
    expect(provider.calls.at(-1)).toHaveLength(73 - CHAT_EMBED_BATCH);
  });

  it('cancel while idle returns the current status', async () => {
    expect(await index.cancel()).toEqual(index.status());
  });
});
