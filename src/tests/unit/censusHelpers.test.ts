import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { addsOnly, expectTyped } from '@/tests/fidelity/censusHelpers';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '' });
});

function state(doc: string, anchor = 0): EditorState {
  const created = EditorState.create({ doc, selection: { anchor }, extensions: markdownEditorExtensions(DOC) });
  ensureSyntaxTree(created, created.doc.length, 5_000);
  return created.update({}).state;
}

describe('the typing census check', () => {
  it('fails a typed backslash that was dropped or escapes what follows it', () => {
    const before = state('x!\n', 1);
    expect(expectTyped(before, state('x\\!\n'), '\\', 1, { escapes: '\\' })).not.toEqual([]);
    expect(expectTyped(before, state('x!\n'), '\\', 1, { escapes: '\\' })).not.toEqual([]);
    expect(expectTyped(before, state('x\\\\!\n'), '\\', 1, { escapes: '\\' })).toEqual([]);
  });

  it('allows escapes added among the typed characters, never a typed character lost', () => {
    expect(addsOnly('1984. A', '1984\\. A', '\\')).toBe(true);
    expect(addsOnly('a\\b', 'ab', '\\')).toBe(false);
    expect(addsOnly('a*b', 'a\\*b', '\\')).toBe(true);
  });
});
