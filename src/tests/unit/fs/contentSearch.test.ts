import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { contentExcerpt, searchCurrentText } from '@/main/fs/contentSearch';
import { RootRegistry } from '@/main/fs/RootRegistry';

const page = (text: string) => Buffer.from(text, 'utf8');

describe('contentExcerpt', () => {
  it('reads the excerpt from the body, never the frontmatter', () => {
    const excerpt = contentExcerpt(page('---\nwritten_by: mixed\ntags: [investors]\n---\n# Investors\n\nThe pre-seed round.\n'), 'investors');
    expect(excerpt).toBe('# Investors The pre-seed round.');
  });

  it('shows the property line when only the frontmatter matches', () => {
    expect(contentExcerpt(page('---\nwritten_by: mixed\n---\nBody text.\n'), 'mixed')).toBe('written_by: mixed');
  });

  it('treats an unclosed frontmatter block as text', () => {
    expect(contentExcerpt(page('---\nnot closed, foxglove'), 'foxglove')).toBe('--- not closed, foxglove');
  });

  it('finds nothing when the query is absent', () => {
    expect(contentExcerpt(page('---\na: b\n---\nbody'), 'zzz')).toBeNull();
  });
});

describe('searchCurrentText', () => {
  it('searches notes and documents, and skips other files', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-search-'));
    try {
      const registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
      await writeFile(path.join(tmp, 'note.md'), 'foxglove in a note');
      await writeFile(path.join(tmp, 'plan.mdo'), 'foxglove in a document');
      await writeFile(path.join(tmp, 'data.csv'), 'foxglove,in,a,table');
      await registry.add(tmp);
      const { hits } = await searchCurrentText(registry, 'foxglove');
      expect(hits.map((hit) => hit.name).sort()).toEqual(['note.md', 'plan.mdo']);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
