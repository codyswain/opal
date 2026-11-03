import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions, replaceText } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { linkEditor } from '@/renderer/features/disk-explorer/components/editor/docMode';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';
const OTHER = '/Vault/Notes/Other.md';

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '', [OTHER]: '' });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string, page = DOC, openNote = vi.fn()) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page, openNote) }) });
  views.push(view);
  return view;
}

/** Makes the page report focus the way CodeMirror reads it, as the live preview tests do. */
async function focusPage(view: EditorView) {
  view.focus = vi.fn();
  Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true });
  act(() => { view.contentDOM.dispatchEvent(new FocusEvent('focus')); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

const caret = (view: EditorView) => view.state.selection.main.head;
const text = (view: EditorView) => view.state.doc.toString();
const lineText = (view: EditorView, index = 0) => [...view.contentDOM.querySelectorAll('.cm-line')][index]?.textContent ?? '';

const select = (view: EditorView, anchor: number, head = anchor) => act(() => { view.dispatch({ selection: { anchor, head } }); });

const key = (view: EditorView, name: string, init: KeyboardEventInit = {}) =>
  act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: name, ...init }), 'editor'); });

/**
 * Types as the browser does: it puts the text at its own caret, `at`, and
 * CodeMirror asks the input handlers before taking it there.
 */
function type(view: EditorView, typed: string, at = caret(view)) {
  act(() => {
    const insert = () => view.state.update({ changes: { from: at, insert: typed }, selection: { anchor: at + typed.length }, userEvent: 'input.type' });
    if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, typed, insert))) view.dispatch(insert());
  });
}

describe('doc mode', () => {
  it('reads as rendered with the caret in formatting, and titles the page by its name', async () => {
    const view = mount('# Title\n\nSome **bold** and a [link](https://example.com).\n');
    await focusPage(view);
    select(view, 15);
    expect(lineText(view, 0)).toBe('Title');
    expect(lineText(view, 2)).toBe('Some bold and a link.');
    expect(view.contentDOM.querySelector('.cm-md-inline-title')).toHaveTextContent(/^Plan$/);
    // A plain note still shows the marks the caret touches.
    const note = mount('Some **bold** text.\n', NOTE);
    await focusPage(note);
    select(note, 8);
    expect(lineText(note)).toBe('Some **bold** text.');
  });

  it('never leaves the caret in hidden marks: a click, search, undo or an outside change moves it out', async () => {
    const view = mount('a **b** [c](https://example.com) d\n');
    await focusPage(view);
    // Inside "**" before b, and inside the hidden URL.
    select(view, 3);
    expect(caret(view)).toBe(2);
    select(view, 15);
    expect(caret(view)).toBe(view.state.doc.toString().indexOf(' d'));
    // A range keeps its ends out of hidden text, outward.
    select(view, 3, 14);
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(view.state.doc.toString().indexOf(' d'));
    // An outside change that lands the caret in a mark moves it out too.
    select(view, 0);
    act(() => replaceText(view, '**a** **b** [c](https://example.com) d\n'));
    expect(caret(view)).toBe(0);
    select(view, 1);
    expect(caret(view)).toBe(0);
  });

  it('gives CodeMirror the hidden marks in view as atomic ranges', () => {
    const view = mount('a **b** c\n');
    const atoms: [number, number][] = [];
    for (const set of view.state.facet(EditorView.atomicRanges).map((ranges) => ranges(view))) {
      set.between(0, view.state.doc.length, (from, to) => { atoms.push([from, to]); });
    }
    expect(atoms).toEqual([[2, 4], [5, 7]]);
    expect(mount('a **b** c\n', NOTE).state.facet(EditorView.atomicRanges)).toHaveLength(0);
  });

  it('moves one visible character per arrow key, a hidden mark and the character beside it as one step', async () => {
    const view = mount('a**b**c\n# Head\n');
    await focusPage(view);
    select(view, 0);
    const right = () => { key(view, 'ArrowRight'); return caret(view); };
    const left = () => { key(view, 'ArrowLeft'); return caret(view); };
    expect([right(), right(), right(), right()]).toEqual([1, 4, 7, 10]);
    expect([left(), left(), left(), left()]).toEqual([7, 4, 1, 0]);
    // Shift extends the selection the same way.
    key(view, 'ArrowRight', { shiftKey: true });
    key(view, 'ArrowRight', { shiftKey: true });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('a**b');
  });

  it('deletes the visible character with Backspace and Delete, and takes the marks of an emptied span with it', async () => {
    const view = mount('a**b**c\n');
    await focusPage(view);
    select(view, 4);
    key(view, 'Backspace');
    expect(text(view)).toBe('ac\n');
    act(() => { view.dispatch({ changes: { from: 0, to: 2, insert: 'a**bc**d' } }); });
    select(view, 1);
    key(view, 'Delete');
    expect(text(view)).toBe('a**c**d\n');
    key(view, 'Delete');
    expect(text(view)).toBe('ad\n');
    // Italic and strikethrough, with _ marks too.
    act(() => { view.dispatch({ changes: { from: 0, to: 2, insert: 'x _y_ ~~z~~' } }); });
    select(view, 4);
    key(view, 'Backspace');
    expect(text(view)).toBe('x  ~~z~~\n');
    select(view, 5);
    key(view, 'Delete');
    expect(text(view)).toBe('x  \n');
  });

  it('keeps the marks of formatting a deleted or typed-over selection only partly covers', async () => {
    const view = mount('**bold** text\n');
    await focusPage(view);
    select(view, 4, 12);
    key(view, 'Backspace');
    expect(text(view)).toBe('**bo**t\n');
    // Typing over all of the bold text keeps it bold.
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'a **bold** c\n' } }); });
    select(view, 4, 8);
    act(() => { view.dispatch(view.state.replaceSelection('x')); });
    expect(text(view)).toBe('a **x** c\n');
    // Backspace at the start of a heading joins it to the line above.
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Intro\n## Head\n' } }); });
    select(view, 9);
    expect(caret(view)).toBe(9);
    key(view, 'Backspace');
    expect(text(view)).toBe('IntroHead\n');
  });

  it('never rests the caret on a drawn block\'s lines, even between two blocks with no line between them', async () => {
    const doc = 'A\n```\none\n```\n```\ntwo\n```\nB\n';
    const view = mount(doc);
    await focusPage(view);
    // The end of the first block's closing fence is nearer its end, so the caret goes on past the second block.
    select(view, doc.indexOf('```\n```') + 3);
    expect(caret(view)).toBe(doc.indexOf('B'));
    // The second block's code is nearer its start, so the caret goes back past the first block.
    select(view, doc.indexOf('two'));
    expect(caret(view)).toBe(1);
  });

  it('removes a picture or a drawn block whole, keeping the lines around a block apart', async () => {
    const view = mount('Text\n\n```\ncode\n```\n\nMore ![a](https://example.com/a.png) end\n');
    await focusPage(view);
    const after = text(view).indexOf('\nMore') + 1;
    select(view, after - 1);
    key(view, 'Backspace');
    expect(text(view)).toBe('Text\n\n\nMore ![a](https://example.com/a.png) end\n');
    select(view, text(view).indexOf(' end'));
    key(view, 'Backspace');
    expect(text(view)).toBe('Text\n\n\nMore  end\n');
  });

  it('types at the end of bold or italic inside it, and after a link or code outside it', async () => {
    const view = mount('A **b** *i* [l](https://example.com) `c` z\n');
    await focusPage(view);
    // The caret is put after each word's closing mark and settles where typing goes.
    const typeAfter = (closing: string) => {
      select(view, text(view).indexOf(closing) + closing.length);
      type(view, 'X');
    };
    typeAfter('b**');
    typeAfter('i*');
    typeAfter('com)');
    typeAfter('c`');
    expect(text(view)).toBe('A **bX** *iX* [l](https://example.com)X `c`X z\n');
    // The browser may type on the other side of a hidden mark; the text goes where the caret is.
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'A **b** z\n' } }); });
    select(view, 5);
    expect(caret(view)).toBe(5);
    type(view, 'Y', 7);
    expect(text(view)).toBe('A **bY** z\n');
  });

  it('turns a typed "# ", "- " or "1. " back into text on the next Backspace', async () => {
    for (const [typed, escaped] of [['#', '\\# '], ['-', '\\- '], ['1.', '1\\. ']]) {
      const view = mount('');
      await focusPage(view);
      for (const char of typed) type(view, char);
      type(view, ' ');
      expect(text(view)).toBe(`${typed} `);
      key(view, 'Backspace');
      expect(text(view)).toBe(escaped);
      expect(caret(view)).toBe(escaped.length);
    }
    // Later, Backspace after a list marker takes the marker off as it always has.
    const view = mount('- item\n');
    await focusPage(view);
    select(view, 2);
    key(view, 'Backspace');
    expect(text(view)).toBe('item\n');
  });

  it('runs the toolbar\'s Google Docs shortcuts, which a plain note does not have', async () => {
    // CodeMirror reads Mod as Cmd on macOS and Ctrl elsewhere; with Shift it matches the key's code, as for "&" on 7.
    const mod: KeyboardEventInit = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    const view = mount('Line\n');
    select(view, 0, 4);
    const press = (init: KeyboardEventInit) => key(view, init.key as string, { ...mod, ...init });
    press({ key: '¡', keyCode: 49, altKey: true });
    expect(text(view)).toBe('# Line\n');
    press({ key: 'º', keyCode: 48, altKey: true });
    expect(text(view)).toBe('Line\n');
    select(view, 0, 4);
    press({ key: '*', keyCode: 56, shiftKey: true });
    expect(text(view)).toBe('- Line\n');
    press({ key: '&', keyCode: 55, shiftKey: true });
    expect(text(view)).toBe('1. Line\n');
    press({ key: '(', keyCode: 57, shiftKey: true });
    expect(text(view)).toBe('- [ ] Line\n');
    select(view, 6, 10);
    press({ key: 'x', keyCode: 88, shiftKey: true });
    expect(text(view)).toBe('- [ ] ~~Line~~\n');
    const note = mount('Line\n', NOTE);
    select(note, 0, 4);
    act(() => { runScopeHandlers(note, new KeyboardEvent('keydown', { key: '*', keyCode: 56, shiftKey: true, ...mod }), 'editor'); });
    expect(text(note)).toBe('Line\n');
  });

  it('starts normal text on Enter at the end of a heading', async () => {
    const view = mount('## Head\nNext\n');
    await focusPage(view);
    select(view, 7);
    key(view, 'Enter');
    expect(text(view)).toBe('## Head\n\nNext\n');
    expect(caret(view)).toBe(8);
    expect(view.contentDOM.querySelectorAll('.cm-line')[1]).not.toHaveClass('cm-md-heading');
  });

  it('shows a link\'s popover on a click and follows it on Cmd+click', async () => {
    const openNote = vi.fn();
    const view = mount('See [[Other]] and [site](https://example.com).\n', DOC, openNote);
    await focusPage(view);
    const wiki = await waitFor(() => view.contentDOM.querySelector('.cm-md-wikilink') as Element);
    act(() => { wiki.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(view.state.field(linkEditor)).toEqual({ from: 4, to: 13, editing: false });
    expect(openNote).not.toHaveBeenCalled();
    // The popover goes once the caret leaves the link.
    select(view, 0);
    expect(view.state.field(linkEditor)).toBeNull();
    act(() => { wiki.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, metaKey: true })); });
    await waitFor(() => expect(openNote).toHaveBeenCalledWith(OTHER, true));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const site = view.contentDOM.querySelector('[data-href]') as Element;
    act(() => { site.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(open).not.toHaveBeenCalled();
    expect(view.state.field(linkEditor)?.editing).toBe(false);
  });

  it('puts the caret after a table on a click, and shows its Markdown on a double-click until the caret leaves', async () => {
    const view = mount('Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd\n');
    await focusPage(view);
    const table = view.contentDOM.querySelector('.cm-md-table') as Element;
    const cell = table.querySelector('td') as Element;
    act(() => { cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    expect(caret(view)).toBe(text(view).indexOf('\nEnd'));
    act(() => { cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 2 })); });
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    expect(lineText(view, 2)).toBe('| a | b |');
    select(view, 0);
    expect(view.contentDOM.querySelector('.cm-md-table')).not.toBeNull();
  });

  it('moves neither text nor the caret while an input method is composing', async () => {
    const view = mount('a **b** c\n');
    await focusPage(view);
    select(view, 7);
    expect(caret(view)).toBe(5);
    act(() => { view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    act(() => { view.dispatch({ selection: EditorSelection.cursor(7) }); });
    expect(caret(view)).toBe(7);
    act(() => { view.dispatch({ changes: { from: 7, insert: 'é' }, selection: { anchor: 8 }, userEvent: 'input.type.compose' }); });
    expect(text(view)).toBe('a **b**é c\n');
    act(() => { view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
    act(() => { view.dispatch({ selection: EditorSelection.cursor(6) }); });
    expect(caret(view)).toBe(5);
  });
});
