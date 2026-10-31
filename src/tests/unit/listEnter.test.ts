import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
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
  return withCaret(next as unknown as EditorState);
}

function withCaret(state: EditorState): string {
  const doc = state.doc.toString();
  const head = state.selection.main.head;
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

/**
 * Presses `key` at the "|" in `text` through the page editor's keymap, so
 * the binding is what runs, and gives back the page with "|" at the caret.
 */
function press(text: string, key: string, init: KeyboardEventInit = {}): string {
  const at = text.indexOf('|');
  const view = new EditorView({
    state: EditorState.create({ doc: text.slice(0, at) + text.slice(at + 1), selection: { anchor: at }, extensions: markdownEditorExtensions(PAGE) }),
  });
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...init }), 'editor');
  const pressed = withCaret(view.state);
  view.destroy();
  return pressed;
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

  it('ends the list on an empty top-level item, with a blank line before the caret and a tight list', () => {
    // Text typed straight after a list item would belong to that item.
    expect(enter('- [ ] one\n- [ ] |')).toBe('- [ ] one\n\n|');
    expect(enter('- [ ] one\n  - [ ] deep\n- [ ] |')).toBe('- [ ] one\n  - [ ] deep\n\n|');
    expect(enter('- [ ] |')).toBe('|');
    expect(enter('- a\n- |')).toBe('- a\n\n|');
    expect(enter('* a\n* |')).toBe('* a\n\n|');
    expect(enter('1. a\n2. |')).toBe('1. a\n\n|');
    expect(enter('- a\n\n- |')).toBe('- a\n\n|');
    // A list below starts again after its own blank line.
    expect(enter('1. a\n2. |\n3. b')).toBe('1. a\n\n|\n\n2. b');
  });

  it('works inside quotes and callouts, keeping the quote', () => {
    expect(enter('> - [ ] a\n> - [ ] |')).toBe('> - [ ] a\n>\n> |');
    expect(enter('> [!ai] AI\n> - [ ] a\n> - [ ] |')).toBe('> [!ai] AI\n> - [ ] a\n>\n> |');
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
    expect(enter('- [ ] one\n- [ ] |  ')).toBe('- [ ] one\n\n|');
  });

  it('moves an empty item out a level in a quote whose line above was indented before its ">"', () => {
    // Tab used to indent before the ">"; the stock command then gave the item its own marker back.
    expect(enter('> [!ai] AI\n> - [ ] y\n  > - [ ] z\n>   - [ ] |')).toBe('> [!ai] AI\n> - [ ] y\n  > - [ ] z\n> - [ ] |');
  });

  it('leaves Enter outside lists and quotes to a plain newline', () => {
    expect(enter('Plain text|')).toBeNull();
    expect(enter('- a\n|')).toBeNull();
    expect(enter('- a\n\nPlain|')).toBeNull();
  });
});

describe('list keys in the page editor', () => {
  // Each pair differs from what markdown()'s own keymap would do, so these fail if it runs first.
  it('runs this Enter, not the stock one', () => {
    expect(press('- [ ] a\n- [ ] |', 'Enter')).toBe('- [ ] a\n\n|');
    expect(press('- [ ] Email Tom\n  - [ ] Draft\n  - [ ] |', 'Enter')).toBe('- [ ] Email Tom\n  - [ ] Draft\n- [ ] |');
    expect(press('Plain|', 'Enter')).toBe('Plain\n|');
  });

  it('takes a marker off with Backspace, leaving no spaces on a top-level line', () => {
    expect(press('- a\n  - |', 'Backspace')).toBe('- a\n  |');
    expect(press('- [ ] a\n- [ ] |', 'Backspace')).toBe('- [ ] a\n|');
    expect(press('1. a\n2. |', 'Backspace')).toBe('1. a\n|');
    expect(press('- [ ] |', 'Backspace')).toBe('|');
    expect(press('- ab|', 'Backspace')).toBe('- a|');
  });

  it('indents and outdents after the ">" in a quote, and at the line start elsewhere', () => {
    expect(press('> [!ai] AI\n> - [ ] x\n> - [ ] y|', 'Tab')).toBe('> [!ai] AI\n> - [ ] x\n>   - [ ] y|');
    expect(press('> - a\n>   - b|', 'Tab', { shiftKey: true })).toBe('> - a\n> - b|');
    // A line indented before its ">" outdents there.
    expect(press('  > - b|', 'Tab', { shiftKey: true })).toBe('> - b|');
    expect(press('- a\n- b|', 'Tab')).toBe('- a\n  - b|');
    expect(press('- a\n  - b|', 'Tab', { shiftKey: true })).toBe('- a\n- b|');
  });
});
