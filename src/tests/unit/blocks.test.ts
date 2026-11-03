import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { isolateHistory, undo } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, StateEffect, type StateCommand } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions, replaceText } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { clearFormatting, indentList, setHeading, toggleList, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { formatState } from '@/renderer/features/disk-explorer/components/editor/formatState';
import { linkEditor } from '@/renderer/features/disk-explorer/components/editor/docMode';
import { insertItems, objectKinds } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { setCellCaret, setOpenBlock } from '@/renderer/features/disk-explorer/components/editor/livePreview';
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

describe('keys in a table\'s Markdown', () => {
  const selected = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);

  it('moves between cells on Tab and Shift+Tab, selecting their text, and adds a row from the last cell', async () => {
    const view = mount(`| a‸ | b |\n|---|---|\n| 1 | 2 |\n`, NOTE);
    await focusPage(view);
    key(view, 'Tab');
    expect(selected(view)).toBe('b');
    key(view, 'Tab');
    expect(selected(view)).toBe('1');
    key(view, 'Tab', { shiftKey: true });
    expect(selected(view)).toBe('b');
    key(view, 'Tab');
    key(view, 'Tab');
    expect(selected(view)).toBe('2');
    key(view, 'Tab');
    expect(marked(view)).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n| ‸ |  |\n');
    type(view, 'x');
    expect(text(view)).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n| x |  |\n');
  });

  it('adds a row under the caret\'s row on Enter, and after the delimiter row from the header', async () => {
    const view = mount(`> | a | b‸ |\n> |---|---|\n> | 1 | 2 |\n`, NOTE);
    await focusPage(view);
    key(view, 'Enter');
    expect(marked(view)).toBe('> | a | b |\n> |---|---|\n> | ‸ |  |\n> | 1 | 2 |\n');
    const body = mount(`| a | b |\n|---|---|\n| 1 | 2‸ |\n\nAfter\n`, NOTE);
    await focusPage(body);
    key(body, 'Enter');
    expect(marked(body)).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n| ‸ |  |\n\nAfter\n');
    // Enter again on the empty last row leaves the table.
    key(body, 'Enter');
    expect(marked(body)).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n\n‸\n\nAfter\n');
    const quoted = mount(`> | a |\n> |---|\n> |  ‸|\n`, NOTE);
    await focusPage(quoted);
    key(quoted, 'Enter');
    expect(marked(quoted)).toBe('> | a |\n> |---|\n>\n> ‸\n');
  });

  it('works in a document while the table shows its Markdown, and leaves a drawn table alone', async () => {
    const view = mount(`Intro\n\n${TABLE}\n\nEnd\n`);
    await focusPage(view);
    const cell = view.contentDOM.querySelector('.cm-md-table td[data-offset]') as HTMLElement;
    act(() => { cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    key(view, 'Enter');
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    key(view, 'Tab');
    expect(selected(view)).toBe('2');
    key(view, 'Tab');
    expect(text(view)).toBe(`Intro\n\n${TABLE}\n|  |  |\n\nEnd\n`);
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
  });
});

describe('what a drawn table shows', () => {
  const click = (element: Element, init: MouseEventInit = {}) => act(() => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, ...init }));
  });

  it('types into an empty cell with a space on each side, and adds a missing cell at its row\'s end', async () => {
    const view = mount('| a | b |\n|---|---|\n| 1 |  |\n| 2 |\n\nEnd\n');
    await focusPage(view);
    const cells = view.contentDOM.querySelectorAll('.cm-md-table td');
    click(cells[1]);
    key(view, 'x');
    type(view, 'x');
    expect(text(view)).toBe('| a | b |\n|---|---|\n| 1 | x |\n| 2 |\n\nEnd\n');
    act(() => { view.dispatch({ selection: { anchor: text(view).length - 1 } }); });
    click(view.contentDOM.querySelectorAll('.cm-md-table td')[3]);
    key(view, 'y');
    type(view, 'y');
    expect(text(view)).toBe('| a | b |\n|---|---|\n| 1 | x |\n| 2 | y |\n\nEnd\n');
    // One space or none in an empty cell: the text still gets a space on each side.
    const tight = mount('| a | b |\n|---|---|\n| 1 ||\n\nEnd\n');
    await focusPage(tight);
    click(tight.contentDOM.querySelectorAll('.cm-md-table td')[1]);
    key(tight, 'z');
    type(tight, 'z');
    expect(text(tight)).toBe('| a | b |\n|---|---|\n| 1 | z |\n\nEnd\n');
  });

  it('draws <br> as a line break and an escaped pipe in code as a plain pipe', () => {
    const view = mount('| a | b |\n|---|---|\n| one<br>two | `x \\| y` |\n');
    const cells = view.contentDOM.querySelectorAll('.cm-md-table td');
    expect(cells[0].querySelector('br')).not.toBeNull();
    expect(cells[0].textContent).toBe('onetwo');
    expect(cells[1].querySelector('code')?.textContent).toBe('x | y');
  });

  it('shows cells past the header in a muted column, and Fix links writes one backslash before a link\'s pipe', () => {
    const doc = '| Note | When |\n|---|---|\n| [[Plan|The plan]] | today |\n';
    const view = mount(doc);
    expect(view.contentDOM.querySelectorAll('.cm-md-table td')).toHaveLength(3);
    expect(view.contentDOM.querySelectorAll('.cm-md-table .cm-md-cell-extra')).toHaveLength(2);
    const table = { kind: 'table', from: 0, to: doc.length - 1, node: 'Table' };
    const kinds = view.state.facet(objectKinds);
    const fix = kinds.find((kind) => kind.kind === 'table')?.actions(view.state, table).find((action) => action.id === 'fix-links');
    act(() => { fix?.run?.(view, table); });
    expect(text(view)).toBe('| Note | When |\n|---|---|\n| [[Plan\\|The plan]] | today |\n');
    expect(view.contentDOM.querySelectorAll('.cm-md-table .cm-md-cell-extra')).toHaveLength(0);
    expect(kinds.find((kind) => kind.kind === 'table')?.actions(view.state, table).some((action) => action.id === 'fix-links')).toBe(false);
  });

  it('shows a link\'s popover on a click in a cell and follows it on Cmd+click', async () => {
    const view = mount('| Link |\n|---|\n| [site](https://example.com) |\n\nEnd\n');
    await focusPage(view);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    click(view.contentDOM.querySelector('.cm-md-table [data-href]') as Element);
    expect(open).not.toHaveBeenCalled();
    expect(view.state.field(linkEditor)).toMatchObject({ from: 17, to: 44, editing: false });
    expect(view.contentDOM.querySelector('.cm-md-table')).not.toBeNull();
    click(view.contentDOM.querySelector('.cm-md-table [data-href]') as Element, { metaKey: true });
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank');
  });
});

describe('quotes and callouts in a document', () => {
  const press = (marked: string, name: string) => {
    const view = mount(marked);
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: name }), 'editor'); });
    return marked_(view);
  };
  const marked_ = (view: EditorView) => `${text(view).slice(0, caret(view))}‸${text(view).slice(caret(view))}`;

  it('leaves the quote on Enter on an empty quote line, one level at a time', () => {
    expect(press('> a\n> ‸', 'Enter')).toBe('> a\n\n‸');
    expect(press('> > a\n> > ‸', 'Enter')).toBe('> > a\n>\n> ‸');
    expect(press('> a\n> b‸', 'Enter')).toBe('> a\n> b\n> ‸');
  });

  it('takes off only "[!type]" on Backspace at the start of a callout\'s title', () => {
    expect(press('> [!note] ‸Title\n> body\n', 'Backspace')).toBe('> ‸Title\n> body\n');
    expect(press('> [!TIP]- ‸Folded\n> body\n', 'Backspace')).toBe('> ‸Folded\n> body\n');
  });

  it('puts a space between "[!type]" and a title typed into an empty callout', () => {
    const view = mount('> [!note]‸\n> body\n');
    type(view, 'T');
    expect(marked(view)).toBe('> [!note] T‸\n> body\n');
    type(view, 'o');
    expect(text(view)).toBe('> [!note] To\n> body\n');
  });

  it('draws one rule per level for nested quotes', () => {
    const view = mount('> a\n> > b\n> > > c\n');
    const depths = [...view.contentDOM.querySelectorAll('.cm-md-quote')].map((line) => (line as HTMLElement).style.getPropertyValue('--quote-depth'));
    expect(depths).toEqual(['', '2', '3']);
  });

  it('inserts a callout and a horizontal line on lines of their own', () => {
    const view = mount('Text‸\nMore\n');
    const items = view.state.facet(insertItems);
    act(() => { void items.find((item) => item.id === 'callout')?.run(view); });
    expect(marked(view)).toBe('Text\n\n> [!note] Note\n> ‸\n\nMore\n');
    const rule = mount('Text‸\n');
    act(() => { void rule.state.facet(insertItems).find((item) => item.id === 'rule')?.run(rule); });
    expect(marked(rule)).toBe('Text\n\n***\n‸');
  });
});

describe('wide tables', () => {
  it('caps each cell\'s text in a box and redraws in place on an agent\'s edit, keeping the sideways scroll', () => {
    const view = mount(`Intro\n\n${TABLE}\n`);
    const frameBefore = view.contentDOM.querySelector('.cm-md-table') as HTMLElement;
    expect(frameBefore.querySelectorAll('td .cm-md-cell')).toHaveLength(2);
    const scroller = frameBefore.querySelector('.cm-md-table-scroll') as HTMLElement;
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, value: 120, writable: true });
    act(() => { replaceText(view, `Intro\n\n${TABLE.replace('| 1 |', '| one |')}\n`); });
    const frameAfter = view.contentDOM.querySelector('.cm-md-table') as HTMLElement;
    expect(frameAfter).toBe(frameBefore);
    expect(frameAfter.querySelector('td')?.textContent).toBe('one');
    expect((frameAfter.querySelector('.cm-md-table-scroll') as HTMLElement).scrollLeft).toBe(120);
  });
});

describe('formatting inside a table cell', () => {
  it('bolds text inside one cell, and never a whole row', () => {
    const doc = '| a | some words |\n|---|---|\n| 1 | 2 |\n';
    const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('some'), head: doc.indexOf('some') + 4 }, extensions: markdownEditorExtensions(NOTE) });
    let out = doc;
    toggleMarker('**')({ state, dispatch: (tr) => { out = tr.newDoc.toString(); } });
    expect(out).toBe('| a | **some** words |\n|---|---|\n| 1 | 2 |\n');
    expect(onAll(doc, toggleMarker('**'), NOTE)).toBe(doc);
  });
});

describe('an input method under a table', () => {
  it('gets the blank line above the composed text once the composition ends', async () => {
    const view = mount(`${TABLE}\n‸\n\nNext\n`);
    act(() => { view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    act(() => { view.dispatch({ changes: { from: caret(view), insert: '日本' }, selection: { anchor: caret(view) + 2 }, userEvent: 'input.type.compose' }); });
    expect(text(view)).toBe(`${TABLE}\n日本\n\nNext\n`);
    act(() => { view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(text(view)).toBe(`${TABLE}\n\n日本\n\nNext\n`);
  });
});

describe('Tab with a cell caret in a drawn table', () => {
  it('moves the outlined cell, and the next key types there', async () => {
    const view = mount(`Intro\n\n${TABLE}\n\nEnd\n`);
    await focusPage(view);
    const cell = view.contentDOM.querySelector('.cm-md-table th[data-offset]') as HTMLElement;
    act(() => { cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    key(view, 'Tab');
    expect(view.contentDOM.querySelector('.cm-md-cell-caret')?.textContent).toBe('b');
    key(view, 'Tab');
    expect(view.contentDOM.querySelector('.cm-md-cell-caret')?.textContent).toBe('1');
    key(view, 'Tab', { shiftKey: true });
    expect(view.contentDOM.querySelector('.cm-md-cell-caret')?.textContent).toBe('b');
    key(view, 'x');
    type(view, 'x');
    expect(text(view)).toBe(`Intro\n\n| a | xb |\n|---|---|\n| 1 | 2 |\n\nEnd\n`);
  });
});

describe('a click on a rule in a document', () => {
  it('frames it with the caret after it', async () => {
    const view = mount('Text\n\n***\n\nMore‸\n');
    await focusPage(view);
    const rule = view.contentDOM.querySelector('.cm-md-hr[data-object]') as HTMLElement;
    act(() => { rule.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    expect(frame(view)).toMatchObject({ kind: 'horizontal rule' });
    key(view, 'Backspace');
    expect(text(view)).toBe('Text\n\nMore\n');
    expect(mount('***\n', NOTE).contentDOM.querySelector('.cm-md-hr[data-object]')).toBeNull();
  });
});

describe('a click on a drawn code block in a document', () => {
  it('frames it with the caret after it', async () => {
    const view = mount('Text\n\n```\ncode\n```\n\nMore‸\n');
    await focusPage(view);
    const block = view.contentDOM.querySelector('.cm-md-codeblock-widget') as HTMLElement;
    act(() => { block.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })); });
    expect(frame(view)).toMatchObject({ kind: 'code block' });
    expect(caret(view)).toBe(text(view).indexOf('\nMore'));
  });
});

describe('file inserts beside tables and rules', () => {
  it('leaves an insert that brings its own blank line and effects alone: one blank line, the effect kept, the caret where it was', () => {
    const marker = StateEffect.define<string>();
    const seen: string[] = [];
    const listen = EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) for (const effect of tr.effects) if (effect.is(marker)) seen.push(effect.value);
    });
    for (const [doc, at] of [[`${TABLE}\n\nMore`, TABLE.length], ['Text\n\n---\n\nMore', 'Text\n\n---'.length]] as const) {
      const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [markdownEditorExtensions(DOC), listen] }) });
      views.push(view);
      act(() => { view.dispatch({ changes: { from: at, insert: '\n\n![[files/x.png]]' }, effects: marker.of('drop'), annotations: isolateHistory.of('full'), userEvent: 'input.drop' }); });
      expect(text(view)).toBe(`${doc.slice(0, at)}\n\n![[files/x.png]]${doc.slice(at)}`);
      expect(caret(view)).toBe(0);
    }
    expect(seen).toEqual(['drop', 'drop']);
  });
});

describe('Backspace and Delete on the blank line beside a table, HTML block or rule', () => {
  it('frames the table instead of joining the text to it', () => {
    const under = mount(`${TABLE}\n‸\ntext\n`);
    key(under, 'Delete');
    expect(text(under)).toBe(`${TABLE}\n\ntext\n`);
    expect(frame(under)).toMatchObject({ kind: 'table' });
    const back = mount(`${TABLE}\n‸\ntext\n`);
    key(back, 'Backspace');
    expect(text(back)).toBe(`${TABLE}\n\ntext\n`);
    expect(frame(back)).toMatchObject({ kind: 'table' });
    const over = mount(`See [[Plan|the plan]]\n‸\n${TABLE}\n`);
    key(over, 'Backspace');
    expect(text(over)).toBe(`See [[Plan|the plan]]\n\n${TABLE}\n`);
    expect(frame(over)).toMatchObject({ kind: 'table' });
    const overDelete = mount(`See [[Plan|the plan]]\n‸\n${TABLE}\n`);
    key(overDelete, 'Delete');
    expect(frame(overDelete)).toMatchObject({ kind: 'table' });
    // With two blank lines, one can go.
    const roomy = mount(`${TABLE}\n‸\n\ntext\n`);
    key(roomy, 'Delete');
    expect(text(roomy)).toBe(`${TABLE}\n\ntext\n`);
    expect(frame(roomy)).toBeNull();
  });

  it('frames an HTML block above a heading on Backspace at the heading\'s start', () => {
    const view = mount('<div>x</div>\n\n# ‸Title\n');
    key(view, 'Backspace');
    expect(text(view)).toBe('<div>x</div>\n\n# Title\n');
    expect(frame(view)).toMatchObject({ kind: 'HTML block' });
  });

  it('frames a "---" rule rather than let the text above underline itself', () => {
    const view = mount('text\n‸\n---\n\nmore\n');
    key(view, 'Backspace');
    expect(text(view)).toBe('text\n\n---\n\nmore\n');
    expect(frame(view)).toMatchObject({ kind: 'horizontal rule' });
    const below = mount('text\n‸\n---\n\nmore\n');
    key(below, 'Delete');
    expect(frame(below)).toMatchObject({ kind: 'horizontal rule' });
    const end = mount('text‸\n\n---\n\nmore\n');
    key(end, 'Delete');
    expect(text(end)).toBe('text\n\n---\n\nmore\n');
    expect(frame(end)).toMatchObject({ kind: 'horizontal rule' });
    // A "***" rule never underlines, so its blank line goes as any other.
    const stars = mount('text\n‸\n***\n\nmore\n');
    key(stars, 'Backspace');
    expect(text(stars)).toBe('text\n***\n\nmore\n');
  });
});

describe('Insert with the caret in a block or a container', () => {
  const run = (view: EditorView, id: string) => {
    view.focus = vi.fn();
    act(() => { void view.state.facet(insertItems).find((item) => item.id === id)?.run(view); });
  };

  it('puts a table, callout or rule after a table whose cell was clicked, never between its rows', () => {
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nAfter\n';
    for (const [id, block] of [['table', '| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |'], ['callout', '> [!note] Note\n> '], ['rule', '***']] as const) {
      const view = mount(doc);
      const at = doc.indexOf('1 |');
      act(() => { view.dispatch({ selection: { anchor: at }, effects: setCellCaret.of(at) }); });
      run(view, id);
      expect(text(view)).toBe(`| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n${block}\n\nAfter\n`);
    }
  });

  it('keeps a callout or rule inside the list item or callout the caret is in', () => {
    const list = mount('1. First\n1. Lazy two‸\n\t1. Nested from one\n1. [ ] A numbered task\n');
    run(list, 'callout');
    expect(marked(list)).toBe('1. First\n1. Lazy two\n\n   > [!note] Note\n   > ‸\n\n\t1. Nested from one\n1. [ ] A numbered task\n');
    const callout = mount('> [!note] A callout\n> With a body line.‸\n> > Nested quote in callout.\n');
    run(callout, 'rule');
    expect(marked(callout)).toBe('> [!note] A callout\n> With a body line.\n>\n> ***\n>‸\n> > Nested quote in callout.\n');
    const table = mount('- item‸\n  - child\n');
    run(table, 'table');
    expect(text(table)).toBe('- item\n\n  | Column 1 | Column 2 | Column 3 |\n  |---|---|---|\n  |  |  |  |\n  |  |  |  |\n\n  - child\n');
  });

  it('leaves one blank line under a rule when text follows', () => {
    const view = mount('text‸\nmore\n');
    run(view, 'rule');
    expect(marked(view)).toBe('text\n\n***\n‸\nmore\n');
  });
});

describe('input methods in table cells and callout titles', () => {
  const end = async (view: EditorView) => {
    act(() => { view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  };

  it('writes composed text into a cell as it comes, and spaces it once the composition ends', async () => {
    const doc = '| a | b |\n|---|---|\n|    |  |\n';
    const cellAt = doc.lastIndexOf('|    |') + 1;
    const view = mount(`${doc.slice(0, cellAt)}‸${doc.slice(cellAt)}`);
    await focusPage(view);
    act(() => { view.dispatch({ effects: setOpenBlock.of({ from: 0, to: doc.length - 1 }) }); });
    act(() => { view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    act(() => { view.dispatch(view.state.update({ changes: { from: cellAt, insert: 'k' }, selection: { anchor: cellAt + 1 }, userEvent: 'input.type.compose' })); });
    expect(text(view)).toBe('| a | b |\n|---|---|\n|k    |  |\n');
    await end(view);
    expect(marked(view)).toBe('| a | b |\n|---|---|\n| k‸ |  |\n');
  });

  it('writes a composed callout title as it comes, and puts the space before it once the composition ends', async () => {
    const title = mount('> [!note]‸\n> body\n');
    const at = caret(title);
    act(() => { title.dispatch(title.state.update({ changes: { from: at, insert: 'k' }, selection: { anchor: at + 1 }, userEvent: 'input.type.compose' })); });
    expect(text(title)).toBe('> [!note]k\n> body\n');
    await end(title);
    expect(text(title)).toBe('> [!note] k\n> body\n');
  });
});

describe('Tab in a note\'s quoted code', () => {
  it('indents after the quote marks, as before', () => {
    const code = mount('> ```\n> co‸de\n> ```\n', NOTE);
    act(() => { runScopeHandlers(code, new KeyboardEvent('keydown', { key: 'Tab' }), 'editor'); });
    expect(text(code)).toBe('> ```\n>   code\n> ```\n');
    const html = mount('> <div>\n> x‸\n> </div>\n', NOTE);
    act(() => { runScopeHandlers(html, new KeyboardEvent('keydown', { key: 'Tab' }), 'editor'); });
    expect(text(html)).toBe('> <div>\n>   x\n> </div>\n');
  });
});

describe('a table that starts on a list item\'s line', () => {
  it('adds rows at the item\'s content indent on Enter and on Tab in the last cell', async () => {
    const view = mount('- | a | b |\n  | - | - |\n  | 1 | 2‸ |\n', NOTE);
    await focusPage(view);
    key(view, 'Enter');
    expect(marked(view)).toBe('- | a | b |\n  | - | - |\n  | 1 | 2 |\n  | ‸ |  |\n');
    const tab = mount('- | a | b |\n  | - | - |\n  | 1 | 2‸ |\n', NOTE);
    await focusPage(tab);
    key(tab, 'Tab');
    expect(marked(tab)).toBe('- | a | b |\n  | - | - |\n  | 1 | 2 |\n  | ‸ |  |\n');
  });
});

describe('formatting in a table\'s delimiter row', () => {
  it('never writes marks there', () => {
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    const state = EditorState.create({ doc, selection: { anchor: 11, head: 14 }, extensions: markdownEditorExtensions(DOC) });
    let out = doc;
    toggleMarker('**')({ state, dispatch: (tr) => { out = tr.newDoc.toString(); } });
    expect(out).toBe(doc);
  });
});
