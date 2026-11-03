import { describe, expect, it } from 'vitest';
import { contentExcerpt } from '@/main/fs/contentSearch';

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
