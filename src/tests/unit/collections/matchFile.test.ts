import { describe, expect, it } from 'vitest';
import { MatchTier, matchTier, type MatchTarget } from '@/main/collections/matchFile';

const file = (relativePath: string, title: string | null = null): MatchTarget =>
  ({ name: relativePath.split('/').pop() ?? relativePath, relativePath, title });

describe('matchTier', () => {
  it('ranks the exact name, then a prefix, then a word start, then a substring', () => {
    expect(matchTier('Ada Lovelace', file('Library/people/Ada Lovelace.md'))).toBe(MatchTier.Exact);
    expect(matchTier('Ada Lovelace', file('Library/offers/Ada Lovelace Offer Letter.pdf'))).toBe(MatchTier.Prefix);
    expect(matchTier('Ada Lovelace', file('Library/1-on-1s/2026-10-27 Ada Lovelace (draft).md'))).toBe(MatchTier.WordStart);
    expect(matchTier('lace', file('Library/people/Ada Lovelace.md'))).toBe(MatchTier.Substring);
  });

  it('ignores case and treats dashes, underscores and spaces as the same', () => {
    expect(matchTier('opal status', file('Library/chats/opal-status.md'))).toBe(MatchTier.Exact);
    expect(matchTier('OPAL_STATUS', file('Library/chats/opal-status.md'))).toBe(MatchTier.Exact);
    expect(matchTier('box anatomy', file('diagrams/freight_v2_box_anatomy.png'))).toBe(MatchTier.WordStart);
  });

  it('finds every word in any order, in the name first and then anywhere in the path', () => {
    expect(matchTier('freight dataset', file('Library/parametric/freight-large-dataset.md'))).toBe(MatchTier.NameWords);
    expect(matchTier('hopper grace', file('Library/people/grace hopper.md'))).toBe(MatchTier.NameWords);
    expect(matchTier('people grace', file('Library/people/grace hopper.md'))).toBe(MatchTier.PathWords);
    expect(matchTier('people/grace', file('Library/people/grace hopper.md'))).toBe(MatchTier.PathWords);
    expect(matchTier('hopper ada', file('Library/people/grace hopper.md'))).toBeNull();
  });

  it('matches every word in the frontmatter title like the name', () => {
    const session = file('Library/chats/garden/2026-09-28-codex-01a0e734.md', 'Garden plan for spring');
    expect(matchTier('spring plan', session)).toBe(MatchTier.NameWords);
    expect(matchTier('chats spring', session)).toBe(MatchTier.PathWords);
    expect(matchTier('autumn', session)).toBeNull();
  });

  it('leaves the extension out unless the query has a dot', () => {
    expect(matchTier('plan', file('notes/plan.md'))).toBe(MatchTier.Exact);
    expect(matchTier('md', file('notes/plan.md'))).toBeNull();
    expect(matchTier('plan.md', file('notes/plan.md'))).toBe(MatchTier.Exact);
    expect(matchTier('.png', file('photos/cover.png'))).toBe(MatchTier.Substring);
    // Only a short trailing part without spaces is an extension.
    expect(matchTier('v1.2 notes', file('v1.2 notes'))).toBe(MatchTier.Exact);
    expect(matchTier('notes', file('v1.2 notes'))).toBe(MatchTier.WordStart);
  });

  it('matches the name the tree shows like the file name', () => {
    const day: MatchTarget = { ...file('Library/daily/2026-10-30.md'), label: '10-30 Fri' };
    expect(matchTier('10-30 Fri', day)).toBe(MatchTier.Exact);
    expect(matchTier('10-30', day)).toBe(MatchTier.Prefix);
    expect(matchTier('fri', day)).toBe(MatchTier.WordStart);
    expect(matchTier('2026-10-30', day)).toBe(MatchTier.Exact);
    expect(matchTier('fri 10', day)).toBe(MatchTier.NameWords);
    expect(matchTier('sat', day)).toBeNull();
  });

  it('compares decomposed and composed accents as the same name', () => {
    expect(matchTier('Café', file('Café.md'))).toBe(MatchTier.Exact);
  });

  it('matches nothing for empty text', () => {
    expect(matchTier('  -  ', file('notes/plan.md'))).toBeNull();
  });
});
