import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { LibraryTextIndex } from '@/main/chat/LibraryTextIndex';
import type { EmbeddingProvider } from '@/main/chat/EmbeddingProvider';
import { normalize } from '@/main/chat/EmbeddingProvider';
import { RootRegistry } from '@/main/fs/RootRegistry';

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
  index = new LibraryTextIndex({ registry, directory: path.join(tmp, 'library', 'index'), provider: async () => provider, onChanged, now: () => now });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('LibraryTextIndex', () => {
  it('starts empty, indexes Markdown and text without frontmatter, skips large and non-text files, and persists', async () => {
    await index.load();
    expect(index.status()).toMatchObject({ ready: false, files: 0, chunks: 0, indexing: false });
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
});
