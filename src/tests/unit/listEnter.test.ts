import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { insertNewlineInList, markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';

const PAGE = '/Vault/Library/daily/2026-10-31.md';

/**
 * Presses Enter at the "|" in `text` and gives back the page with "|" at the
 * caret, or null when the command leaves the key to a plain newline.
 */
function enter(text: string): string | null {
  const at = text.indexOf('|');
  const state = EditorState.create({
    doc: text.slice(0, at) + text.slice(at + 1),
    selection: { anchor: at },
    extensions: markdownEditorExtensions(PAGE),
  });
  let next: EditorState | null = null;
  if (!insertNewlineInList({ state, dispatch: (tr) => { next = tr.state; } })) return null;
  const done = next as unknown as EditorState;
  const doc = done.doc.toString();
  const head = done.selection.main.head;
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

describe('Enter in a list', () => {
  it('moves an empty nested task, bullet or numbered item out one level', () => {
    expect(enter('- [ ] Email Tom\n  - [ ] Draft\n  - [ ] |')).toBe('- [ ] Email Tom\n  - [ ] Draft\n- [ ] |');
    expect(enter('- a\n  - b\n  - |')).toBe('- a\n  - b\n- |');
    expect(enter('- a\n  - b\n    - c\n    - |')).toBe('- a\n  - b\n    - c\n  - |');
    expect(enter('- a\n\t- b\n\t- |')).toBe('- a\n\t- b\n- |');
  });

  it('takes the marker of the list it moves into, numbered and renumbered', () => {
    expect(enter('1. a\n   1. x\n   2. |\n2. b')).toBe('1. a\n   1. x\n2. |\n3. b');
    expect(enter('1. a\n   - x\n   - |\n2. b')).toBe('1. a\n   - x\n2. |\n3. b');
    expect(enter('- [x] Done\n  - [ ] Sub\n  - [ ] |')).toBe('- [x] Done\n  - [ ] Sub\n- [ ] |');
  });

  it('ends the list on an empty top-level item, leaving an empty line and a tight list', () => {
    expect(enter('- [ ] one\n- [ ] |')).toBe('- [ ] one\n|');
    expect(enter('- [ ] |')).toBe('|');
    expect(enter('- a\n- |')).toBe('- a\n|');
    expect(enter('* a\n* |')).toBe('* a\n|');
    expect(enter('1. a\n2. |')).toBe('1. a\n|');
    expect(enter('1. a\n2. |\n3. b')).toBe('1. a\n|\n2. b');
  });

  it('works inside quotes and callouts, keeping the quote', () => {
    expect(enter('> - [ ] a\n> - [ ] |')).toBe('> - [ ] a\n> |');
    expect(enter('> [!ai] AI\n> - [ ] a\n> - [ ] |')).toBe('> [!ai] AI\n> - [ ] a\n> |');
    expect(enter('> [!ai] AI\n> - [ ] a\n>   - [ ] b\n>   - [ ] |')).toBe('> [!ai] AI\n> - [ ] a\n>   - [ ] b\n> - [ ] |');
    expect(enter('> [!ai] AI\n> - [ ] a|')).toBe('> [!ai] AI\n> - [ ] a\n> - [ ] |');
  });

  it('continues a non-empty item, splitting it at the caret', () => {
    expect(enter('- [ ] one|')).toBe('- [ ] one\n- [ ] |');
    expect(enter('- [x] one|')).toBe('- [x] one\n- [ ] |');
    expect(enter('- [ ] buy |milk')).toBe('- [ ] buy\n- [ ] |milk');
    expect(enter('- [ ] a\n  - [ ] buy |milk')).toBe('- [ ] a\n  - [ ] buy\n  - [ ] |milk');
    expect(enter('1. a|\n2. b')).toBe('1. a\n2. |\n3. b');
    expect(enter('- a\n  more|')).toBe('- a\n  more\n  |');
  });

  it('never leaves a line of only spaces', () => {
    expect(enter('- a\n\n  - b\n\n  - c|')).toBe('- a\n\n  - b\n\n  - c\n\n  - |');
    expect(enter('- [ ] one\n- [ ] |  ')).toBe('- [ ] one\n|');
  });

  it('leaves Enter outside lists and quotes to a plain newline', () => {
    expect(enter('Plain text|')).toBeNull();
    expect(enter('- a\n|')).toBeNull();
    expect(enter('- a\n\nPlain|')).toBeNull();
  });
});
