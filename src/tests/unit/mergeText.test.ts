import { describe, expect, it } from 'vitest';
import { mergeText } from '@/renderer/features/disk-explorer/components/editor/mergeText';

const BASE = '# Day\n\n## Notes\nOne\nTwo\n\n## Activity Log\n- 09:00 First\n';

describe('mergeText', () => {
  it('combines an edit with an append elsewhere, in either order of sides', () => {
    const mine = BASE.replace('Two', 'Two, edited');
    const disk = `${BASE}- 09:05 Second\n`;
    const expected = '# Day\n\n## Notes\nOne\nTwo, edited\n\n## Activity Log\n- 09:00 First\n- 09:05 Second\n';
    expect(mergeText(BASE, mine, disk)).toEqual({ clean: true, text: expected });
    expect(mergeText(BASE, disk, mine)).toEqual({ clean: true, text: expected });
  });

  it('lets an insertion sit next to a change and counts the same change once', () => {
    expect(mergeText('a\nb\nc', 'a\nB\nc', 'a\nb\nnew\nc')).toEqual({ clean: true, text: 'a\nB\nnew\nc' });
    expect(mergeText('a\nb\nc', 'new\na\nb\nc', 'A\nb\nc')).toEqual({ clean: true, text: 'new\nA\nb\nc' });
    expect(mergeText('a\nb', 'a\nB', 'a\nB')).toEqual({ clean: true, text: 'a\nB' });
    // Text without a final newline still merges by line.
    expect(mergeText('a\nb', 'A\nb', 'a\nb\nc')).toEqual({ clean: true, text: 'A\nb\nc' });
  });

  it('conflicts on changes to the same line, keeping every clean change on both sides', () => {
    const result = mergeText('Title\n\nShared\nEnd\n', 'Title!\n\nMine\nEnd\n', 'Title\n\nTheirs\nEnd\nMore\n');
    expect(result).toEqual({ clean: false, mine: 'Title!\n\nMine\nEnd\nMore\n', disk: 'Title!\n\nTheirs\nEnd\nMore\n' });
  });

  it('conflicts on two insertions at the same place, and on a change inside a change from the other side', () => {
    expect(mergeText('a\nb', 'a\nmine\nb', 'a\ntheirs\nb')).toEqual({ clean: false, mine: 'a\nmine\nb', disk: 'a\ntheirs\nb' });
    expect(mergeText('a\nb\nc\nd', 'a\nX\nd', 'a\nb\nY\nd')).toEqual({ clean: false, mine: 'a\nX\nd', disk: 'a\nb\nY\nd' });
  });
});
