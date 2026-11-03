import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { undo } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type StateCommand } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { clearFormatting, indentList, setHeading, toggleList, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { formatState } from '@/renderer/features/disk-explorer/components/editor/formatState';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { insertTable } from '@/renderer/features/disk-explorer/components/editor/tableInsert';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '' });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

/** A page with the caret at the "‸" in `marked`. */
function mount(marked: string, page = DOC) {
  const at = marked.indexOf('‸');
  const doc = at === -1 ? marked : marked.slice(0, at) + marked.slice(at + 1);
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: Math.max(at, 0) }, extensions: markdownEditorExtensions(page) }) });
  views.push(view);
  return view;
}

/** Makes the page report focus the way CodeMirror reads it. */
async function focusPage(view: EditorView) {
  view.focus = vi.fn();
  Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true });
  act(() => { view.contentDOM.dispatchEvent(new FocusEvent('focus')); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

const text = (view: EditorView) => view.state.doc.toString();
const caret = (view: EditorView) => view.state.selection.main.head;
const marked = (view: EditorView) => `${text(view).slice(0, caret(view))}‸${text(view).slice(caret(view))}`;
const frame = (view: EditorView) => view.state.field(objectFrame, false) ?? null;

/** A key press through every handler, as the browser sends it. */
function key(view: EditorView, name: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  act(() => { view.contentDOM.dispatchEvent(event); });
  return event.defaultPrevented;
}

/** Types as the browser does: the text at the caret, through the input handlers. */
function type(view: EditorView, typed: string, userEvent = 'input.type') {
  act(() => {
    const { from, to } = view.state.selection.main;
    const insert = () => view.state.update({ changes: { from, to, insert: typed }, selection: { anchor: from + typed.length }, userEvent });
    if (userEvent !== 'input.type' || !view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, typed, insert))) view.dispatch(insert());
  });
}

const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |';

describe('tables and rules as objects in a document', () => {
  it('frames a table under a text line on Backspace, removes it on a second press, and leaves two paragraphs one blank line apart', () => {
    const view = mount(`Text\n${TABLE}\n\n‸More\n`);
    expect(key(view, 'Backspace')).toBe(true);
    expect(frame(view)).toMatchObject({ kind: 'table' });
    expect(text(view)).toBe(`Text\n${TABLE}\n\nMore\n`);
    // A held key stops at the frame.
    key(view, 'Backspace', { repeat: true });
    expect(text(view)).toBe(`Text\n${TABLE}\n\nMore\n`);
    key(view, 'Backspace');
    expect(text(view)).toBe('Text\n\nMore\n');
    act(() => { undo(view); });
    expect(text(view)).toBe(`Text\n${TABLE}\n\nMore\n`);
  });

  it('frames a table from the line above with Delete', () => {
    const view = mount(`Text‸\n\n${TABLE}\n\nMore\n`);
    key(view, 'Delete');
    expect(frame(view)).toMatchObject({ kind: 'table' });
    expect(text(view)).toBe(`Text\n\n${TABLE}\n\nMore\n`);
    key(view, 'Delete');
    expect(text(view)).toBe('Text\n\nMore\n');
  });

  it('frames a rule first and removes it on a second press', () => {
    const view = mount('Text\n\n***\n‸More\n');
    key(view, 'Backspace');
    expect(frame(view)).toMatchObject({ kind: 'horizontal rule' });
    expect(text(view)).toBe('Text\n\n***\nMore\n');
    key(view, 'Backspace');
    expect(text(view)).toBe('Text\n\nMore\n');
  });

  it('frames a drawn code block or an HTML block first', () => {
    const code = mount('Text\n\n```\ncode\n```\n‸\nMore\n');
    key(code, 'Backspace');
    expect(frame(code)).toMatchObject({ kind: 'code block' });
    expect(text(code)).toBe('Text\n\n```\ncode\n```\n\nMore\n');
    key(code, 'Backspace');
    expect(text(code)).toBe('Text\n\nMore\n');
    const html = mount('Text\n\n<div>\nhi\n</div>\n\n‸More\n');
    key(html, 'Backspace');
    expect(frame(html)).toMatchObject({ kind: 'HTML block' });
    key(html, 'Backspace');
    expect(text(html)).toBe('Text\n\nMore\n');
  });

  it('frames the table on Backspace at the start of the paragraph under it, never joining the paragraph to it', () => {
    const view = mount(`${TABLE}\n\n‸More\n`);
    key(view, 'Backspace');
    expect(frame(view)).toMatchObject({ kind: 'table' });
    expect(text(view)).toBe(`${TABLE}\n\nMore\n`);
    key(view, 'Backspace');
    expect(text(view)).toBe('More\n');
  });

  it('lets a letter typed at a framed table start a paragraph under it, deleting nothing', () => {
    const view = mount(`${TABLE}\n‸\n`);
    key(view, 'Backspace');
    expect(frame(view)).toMatchObject({ kind: 'table' });
    expect(key(view, 'x')).toBe(false);
    type(view, 'x');
    expect(marked(view)).toBe(`${TABLE}\n\nx‸\n`);
  });
});

describe('separators next to tables and rules in a document', () => {
  it('keeps a blank line between a table and text typed or pasted on the line under it', () => {
    const view = mount(`${TABLE}\n‸\n\nNext\n`);
    type(view, 'x');
    expect(marked(view)).toBe(`${TABLE}\n\nx‸\n\nNext\n`);
    type(view, 'y');
    expect(marked(view)).toBe(`${TABLE}\n\nxy‸\n\nNext\n`);
    const pasted = mount(`${TABLE}\n‸`);
    type(pasted, 'one\ntwo', 'input.paste');
    expect(marked(pasted)).toBe(`${TABLE}\n\none\ntwo‸`);
  });

  it('keeps blank lines around text typed between two tables, and after a table that ends the page', () => {
    const between = mount(`${TABLE}\n‸\n${TABLE}\n`);
    type(between, 'x');
    expect(marked(between)).toBe(`${TABLE}\n\nx‸\n\n${TABLE}\n`);
    const end = mount(`${TABLE}‸`);
    type(end, 'x');
    expect(marked(end)).toBe(`${TABLE}\n\nx‸`);
  });

  it('puts text typed before a table that starts the page above it', () => {
    const view = mount(`‸${TABLE}\n`);
    type(view, 'x');
    expect(marked(view)).toBe(`x‸\n\n${TABLE}\n`);
  });

  it('keeps text typed after a table in a callout in the callout, after a blank quote line', () => {
    const view = mount('> [!note] Title\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n> ‸\n');
    type(view, 'x');
    expect(marked(view)).toBe('> [!note] Title\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n>\n> x‸\n');
  });

  it('keeps text typed after a table in a list item in the item, at its content indent', () => {
    const view = mount('- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n‸\n');
    type(view, 'x');
    expect(marked(view)).toBe('- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n\n  x‸\n');
  });

  it('keeps a blank line under text typed on the blank line above a table, and under a line that gains a pipe right above one', () => {
    const view = mount(`Intro\n\n‸\n${TABLE}\n`);
    type(view, 'a ');
    expect(marked(view)).toBe(`Intro\n\na ‸\n\n${TABLE}\n`);
    // The paragraph above would otherwise take the table in.
    const joined = mount(`See [[a|b]].\n‸\n${TABLE}\n`);
    type(joined, 'x');
    expect(marked(joined)).toBe(`See [[a|b]].\nx‸\n\n${TABLE}\n`);
    const tight = mount(`Intro a ‸\n${TABLE}\n`);
    type(tight, '|');
    expect(marked(tight)).toBe(`Intro a |‸\n\n${TABLE}\n`);
  });

  it('keeps a blank line under text typed right above a --- rule and under a rule', () => {
    const above = mount('Intro\n\n‸\n---\n\nMore\n');
    type(above, 'x');
    expect(marked(above)).toBe('Intro\n\nx‸\n\n---\n\nMore\n');
    const under = mount('***\n‸\n');
    type(under, 'x');
    expect(marked(under)).toBe('***\n\nx‸\n');
  });

  it('lets rows typed under a table showing its Markdown join it, and leaves notes alone', async () => {
    const view = mount(`Intro\n\n${TABLE}\n`);
    await focusPage(view);
    act(() => { view.dispatch({ selection: { anchor: text(view).length - 1 } }); });
    key(view, 'Backspace');
    key(view, 'Enter');
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    act(() => { view.dispatch({ selection: { anchor: text(view).length - 1 } }); });
    type(view, '\n| 3 | 4 |');
    expect(text(view)).toBe(`Intro\n\n${TABLE}\n| 3 | 4 |\n`);
    const note = mount(`${TABLE}\n‸`, NOTE);
    type(note, 'x');
    expect(text(note)).toBe(`${TABLE}\nx`);
  });
});

describe('the Backspace command on a table, as a test or menu runs it', () => {
  it('frames before it removes', () => {
    const view = mount(`Text\n\n${TABLE}\n‸\nMore\n`);
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(frame(view)).toMatchObject({ kind: 'table' });
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(text(view)).toBe('Text\n\nMore\n');
  });
});

const BLOCKS = 'Para one\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n***\n\n```\ncode\n```\n\n<div>\nx\n</div>\n\n[a]: http://x\n\n> [!note] Title\n> body\n\n    indented code\n\nPara two\n';

/** Runs `command` on `doc` with everything selected and gives back the new text. */
function onAll(doc: string, command: StateCommand, page = DOC, parse = true): string {
  const state = EditorState.create({ doc, selection: { anchor: 0, head: doc.length }, extensions: markdownEditorExtensions(page) });
  if (parse) ensureSyntaxTree(state, doc.length, 5_000);
  let out = doc;
  command({ state, dispatch: (tr) => { out = tr.newDoc.toString(); } });
  return out;
}

describe('formatting a selection that covers blocks', () => {
  it('changes paragraphs, items and a callout\'s text with Bold, lists, Heading 2 and Clear, and never a block or a callout marker', () => {
    const blocks = (doc: string) => ['\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n***\n\n```\ncode\n```\n\n<div>\nx\n</div>\n\n[a]: http://x\n\n> [!note] ', '\n\n    indented code\n\n']
      .every((block) => doc.includes(block));
    expect(onAll(BLOCKS, toggleMarker('**'))).toBe(BLOCKS.replace('Para one', '**Para one**').replace('Para two', '**Para two**').replace('Title\n> body', '**Title**\n> **body**'));
    expect(onAll(BLOCKS, setHeading(2))).toBe(BLOCKS.replace('Para one', '## Para one').replace('Para two', '## Para two').replace('> body', '> ## body'));
    expect(onAll(BLOCKS, toggleList('bullet'))).toBe(BLOCKS.replace('Para one', '- Para one').replace('Para two', '- Para two').replace('> body', '> - body'));
    // Numbers start again after a block, so no list starts at 2, which could not follow the callout's title.
    expect(onAll(BLOCKS, toggleList('number'))).toBe(BLOCKS.replace('Para one', '1. Para one').replace('Para two', '1. Para two').replace('> body', '> 1. body'));
    const bold = onAll(BLOCKS, toggleMarker('**'));
    expect(onAll(bold, clearFormatting)).toBe(BLOCKS);
    for (const command of [toggleMarker('*'), toggleMarker('~~'), indentList(true), indentList(false), setHeading(0)]) {
      expect(blocks(onAll(BLOCKS, command))).toBe(true);
    }
  });

  it('keeps a table at the end of a note over 100,000 characters, parsing to the end first', () => {
    const long = `${'A line of text in a long note.\n\n'.repeat(3_300)}${TABLE}\n`;
    expect(long.length).toBeGreaterThan(100_000);
    const bold = onAll(long, toggleMarker('**'), NOTE, false);
    expect(bold.endsWith(`**\n\n${TABLE}\n`)).toBe(true);
    const listed = onAll(long, toggleList('bullet'), NOTE, false);
    expect(listed.endsWith(`- A line of text in a long note.\n\n${TABLE}\n`)).toBe(true);
  });

  it('takes no heading on a callout title, and the style menu says so', () => {
    const doc = '> [!tip]- Fold me\n> body\n';
    const state = EditorState.create({ doc, selection: { anchor: 12 }, extensions: markdownEditorExtensions(DOC) });
    expect(formatState(state).headingDisabled).toBe(true);
    expect(onAll(doc, setHeading(1))).toBe('> [!tip]- Fold me\n> # body\n');
    const body = EditorState.create({ doc, selection: { anchor: doc.length - 1 }, extensions: markdownEditorExtensions(DOC) });
    expect(formatState(body).headingDisabled).toBe(false);
  });
});

describe('tables in a document', () => {
  it('puts a cell caret in the clicked cell, and the first typed key opens the source with that character in the cell', async () => {
    const view = mount(`Intro\n\n${TABLE}\n\nEnd\n`);
    await focusPage(view);
    const cell = view.contentDOM.querySelector('.cm-md-table td[data-offset]') as HTMLElement;
    act(() => { cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    const at = text(view).indexOf('1 |');
    expect(caret(view)).toBe(at);
    expect(view.contentDOM.querySelector('.cm-md-cell-caret')).not.toBeNull();
    expect(key(view, 'x')).toBe(false);
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    type(view, 'x');
    expect(text(view)).toBe(`Intro\n\n| a | b |\n|---|---|\n| x1 | 2 |\n\nEnd\n`);
    // Leaving the table draws it again.
    act(() => { view.dispatch({ selection: { anchor: 0 } }); });
    expect(view.contentDOM.querySelector('.cm-md-table')).not.toBeNull();
  });

  it('opens the source on Enter with a cell caret, and frames the table on a click beside its cells', async () => {
    const view = mount(`Intro\n\n${TABLE}\n\nEnd\n`);
    await focusPage(view);
    const cell = view.contentDOM.querySelector('.cm-md-table th[data-offset]') as HTMLElement;
    act(() => { cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    expect(key(view, 'Enter')).toBe(true);
    expect(text(view)).toBe(`Intro\n\n${TABLE}\n\nEnd\n`);
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    act(() => { view.dispatch({ selection: { anchor: 0 } }); });
    const scroll = view.contentDOM.querySelector('.cm-md-table-scroll') as HTMLElement;
    act(() => { scroll.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    expect(frame(view)).toMatchObject({ kind: 'table' });
  });

  it('inserts a 3 by 3 table in the vault\'s style with blank lines around it, its source open on the first header', async () => {
    const view = mount('Intro‸\nMore\n');
    await focusPage(view);
    act(() => { insertTable(view); });
    expect(text(view)).toBe('Intro\n\n| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n\nMore\n');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('Column 1');
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    // It parses as a table: once the caret leaves, it draws.
    act(() => { view.dispatch({ selection: { anchor: 0 } }); });
    expect(view.contentDOM.querySelectorAll('.cm-md-table th')).toHaveLength(3);
    // On an empty line in a callout, it stays in the callout.
    const callout = mount('> [!note] Title\n> ‸\n');
    await focusPage(callout);
    act(() => { insertTable(callout); });
    expect(text(callout)).toBe('> [!note] Title\n>\n> | Column 1 | Column 2 | Column 3 |\n> |---|---|---|\n> |  |  |  |\n> |  |  |  |\n');
    // While its source shows, rows typed under it stay in it.
    const end = mount('‸');
    await focusPage(end);
    act(() => { insertTable(end); });
    act(() => { end.dispatch({ selection: { anchor: text(end).length - 1 } }); });
    type(end, '\n| a | b | c |');
    expect(text(end)).toBe('| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n| a | b | c |\n');
  });
});

describe('Normal text on a heading next to other blocks', () => {
  it('keeps blank lines around it, so a rule never underlines it and nothing takes it in', () => {
    expect(onAll('# Log\n-------------\n## Notes\n', setHeading(0))).toBe('Log\n\n-------------\n\nNotes\n');
    // Nor a table take it in as a row, nor a paragraph as a line.
    expect(onAll(`${TABLE}\n## Next\n`, setHeading(0))).toBe(`${TABLE}\n\nNext\n`);
    expect(onAll('Text\n## Head\nMore\n', setHeading(0))).toBe('Text\n\nHead\n\nMore\n');
    expect(onAll('# A\n## B\n', setHeading(0))).toBe('A\n\nB\n');
  });
});
