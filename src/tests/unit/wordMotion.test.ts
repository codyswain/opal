import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { visibleSlice } from '@/renderer/features/disk-explorer/components/editor/visibleText';
import { wordEndAfter, wordStartBefore } from '@/renderer/features/disk-explorer/components/editor/wordMotion';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '' });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(DOC) }) });
  ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const caret = (view: EditorView) => view.state.selection.main.head;
const MOD = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
const key = (view: EditorView, name: string, init: KeyboardEventInit = {}) =>
  act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: name, ...init }), 'editor'); });
const at = (view: EditorView, anchor: number, head = anchor) => act(() => { view.dispatch({ selection: { anchor, head } }); });
/** What the page shows from the line's start to the caret. */
const shownBefore = (view: EditorView) => visibleSlice(view.state, view.state.doc.lineAt(caret(view)).from, caret(view));

function type(view: EditorView, typed: string) {
  act(() => {
    const from = view.state.selection.main.from;
    const to = view.state.selection.main.to;
    view.dispatch({ changes: { from, to, insert: typed }, selection: { anchor: from + typed.length }, userEvent: 'input.type' });
  });
}

describe('words as the system segments them', () => {
  it('finds word ends and starts in visible text', () => {
    expect(wordEndAfter('one two', 0)).toBe(3);
    expect(wordEndAfter('one two', 3)).toBe(7);
    expect(wordStartBefore('one two', 7)).toBe(4);
    expect(wordStartBefore('one two', 4)).toBe(0);
    expect(wordEndAfter('日本語のテキスト', 0)).toBeLessThan(8);
  });
});

describe('Option+Arrow in a document', () => {
  const LINE = 'one **two** [three](https://x.com/a) `four` [[Five]] six';

  it('moves one visible word per press through bold, links, code and wiki links', () => {
    const view = mount(`${LINE}\nnext\n`);
    at(view, 0);
    const stops: string[] = [];
    for (let press = 0; press < 6; press += 1) {
      key(view, 'ArrowRight', { altKey: true });
      stops.push(shownBefore(view));
    }
    expect(stops).toEqual(['one', 'one two', 'one two three', 'one two three four', 'one two three four Five', 'one two three four Five six']);
    const back: string[] = [];
    for (let press = 0; press < 6; press += 1) {
      key(view, 'ArrowLeft', { altKey: true });
      back.push(shownBefore(view));
    }
    expect(back).toEqual(['one two three four Five ', 'one two three four ', 'one two three ', 'one two ', 'one ', '']);
  });

  it('extends the selection by words with Shift', () => {
    const view = mount(`${LINE}\n`);
    at(view, 0);
    key(view, 'ArrowRight', { altKey: true, shiftKey: true });
    key(view, 'ArrowRight', { altKey: true, shiftKey: true });
    const { from, to } = view.state.selection.main;
    expect(visibleSlice(view.state, from, to)).toBe('one two');
  });

  it('goes on to the next line from a line end', () => {
    const view = mount('one\n- two\n');
    at(view, 3);
    key(view, 'ArrowRight', { altKey: true });
    expect(caret(view)).toBe(6);
  });
});

describe('Option+Backspace and Option+Delete in a document', () => {
  it('delete the visible word and keep the marks on what is left', () => {
    const view = mount('**bold word** end\n');
    at(view, 11);
    key(view, 'Backspace', { altKey: true });
    expect(text(view)).toBe('**bold**  end\n');
    const link = mount('a [link text](https://x.com) b\n');
    at(link, text(link).indexOf(' b'));
    key(link, 'Backspace', { altKey: true });
    expect(text(link)).toBe('a [link ](https://x.com) b\n');
  });

  it('delete forward by a word from the start of formatting', () => {
    const view = mount('a **one two** b\n');
    at(view, 2);
    key(view, 'Delete', { altKey: true });
    expect(text(view)).toBe('a  **two** b\n');
  });
});

describe('line-start keys in a document', () => {
  it('Shift+Cmd+Left selects the text only, so typing keeps the bullet, box, heading and quote', () => {
    for (const [doc, kept] of [['- item text\n', '- x\n'], ['- [ ] task text\n', '- [ ] x\n'], ['## Head text\n', '## x\n'], ['> quoted text\n', '> x\n'], ['1. first\n', '1. x\n']]) {
      const view = mount(doc);
      at(view, doc.length - 1);
      key(view, 'ArrowLeft', { ...MOD, shiftKey: true });
      type(view, 'x');
      expect(text(view)).toBe(kept);
    }
  });

  it('Cmd+Backspace deletes the text only', () => {
    const view = mount('- item **bold** text\n');
    at(view, text(view).length - 1);
    key(view, 'Backspace', MOD);
    expect(text(view)).toBe('- \n');
  });

  it('a triple-click selects the line\'s text without its marks or line break', () => {
    const view = mount('- item text\nnext\n');
    act(() => { view.dispatch({ selection: { anchor: 0, head: 12 }, userEvent: 'select.pointer' }); });
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(11);
  });
});
