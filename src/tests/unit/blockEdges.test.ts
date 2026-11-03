import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import { redo, undo } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { calloutMarker } from '@/renderer/features/disk-explorer/components/editor/blockGuards';
import { pasteSpec } from '@/renderer/features/disk-explorer/components/editor/clipboard';
import { CalloutTypeMenu } from '@/renderer/features/disk-explorer/components/editor/CalloutTypeMenu';
import { refoldCallout } from '@/renderer/features/disk-explorer/components/editor/callouts';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { insertItems } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { setOpenBlock } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { setHeading, toggleList } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { formatState } from '@/renderer/features/disk-explorer/components/editor/formatState';
import { mathNodes, mathSpan } from '@/renderer/features/disk-explorer/components/editor/math';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

/*
 * Edge cases around blocks in documents found after PR 1: what list and
 * heading commands write next to formulas, headings and tasks, the keys at
 * the blank lines around setext headings, lists and quotes, line moves in
 * tables and code, and the callout menu.
 */

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
  ensureSyntaxTree(view.state, doc.length, 1_000);
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

/** A key through the editor's keymaps and handlers, as the browser sends it. */
function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...init }), 'editor'); });
}

/** Runs `command` on a state with `from` to `to` selected, and returns the page after it, or null when it refused. */
function after(doc: string, from: number, to: number, command: StateCommand, page = DOC): string | null {
  const state = EditorState.create({ doc, selection: EditorSelection.single(from, to), extensions: markdownEditorExtensions(page) });
  ensureSyntaxTree(state, doc.length, 1_000);
  let result: Transaction | null = null;
  command({ state: state.update({}).state, dispatch: (tr) => { result = tr; } });
  return result ? (result as Transaction).state.doc.toString() : null;
}

const tex = (doc: string) => {
  const state = EditorState.create({ doc, extensions: markdownEditorExtensions(DOC) });
  const tree = ensureSyntaxTree(state, doc.length, 1_000);
  return tree ? mathNodes(tree, 0, doc.length).map((node) => mathSpan(state.doc, node).tex) : [];
};

describe('lists over a numbered item that holds a formula', () => {
  const FORMULA = '   \\[\n   0.30(12\\times2.4)\n   +0.70(12)\n   \\]\n';
  const DOC_TEXT = `Intro\n\n8. The arm holds:\n${FORMULA}   More.\n\nEnd\n`;

  it('keeps the item\'s content column, so no formula line reads differently', () => {
    for (const kind of ['bullet', 'task'] as const) {
      const out = after(DOC_TEXT, 0, DOC_TEXT.length, toggleList(kind));
      expect(out).not.toBeNull();
      expect(out).toContain(FORMULA);
      expect(tex(out as string)).toEqual(tex(DOC_TEXT));
    }
    expect(after(DOC_TEXT, 0, DOC_TEXT.length, toggleList('bullet'))).toContain('-  The arm holds:');
    expect(after(DOC_TEXT, 0, DOC_TEXT.length, toggleList('task'))).toContain('-  [ ] The arm holds:');
  });

  it('changes nothing when the selection holds only the formula\'s lines, from the line break before them', () => {
    const from = DOC_TEXT.indexOf('   \\[') - 1;
    const to = DOC_TEXT.indexOf('\\]') + 2;
    for (const kind of ['bullet', 'number', 'task'] as const) {
      const out = after(DOC_TEXT, from, to, toggleList(kind));
      expect(out === null || out === DOC_TEXT).toBe(true);
    }
  });
});

describe('headings and lists on headings and tasks', () => {
  it('writes a task on a heading as the task\'s text, never "- [ ] ## Title"', () => {
    expect(after('## Evening\n', 3, 3, toggleList('task'))).toBe('- [ ] Evening\n');
    // Bullets and numbers keep the heading in the item.
    expect(after('## Evening\n', 3, 3, toggleList('bullet'))).toBe('- ## Evening\n');
  });

  it('takes no heading on a task, and the style menu says so', () => {
    expect(after('- [ ] Brown rice\n', 8, 8, setHeading(2))).toBe('- [ ] Brown rice\n');
    const state = EditorState.create({ doc: '- [ ] Brown rice\n', selection: { anchor: 8 }, extensions: markdownEditorExtensions(DOC) });
    ensureSyntaxTree(state, 20, 1_000);
    expect(formatState(state.update({}).state).headingDisabled).toBe(true);
  });

  it('keeps a heading that starts with a number as text when it becomes normal text', () => {
    expect(after('### 5. Copied portraits\n', 8, 8, setHeading(0))).toBe('5\\. Copied portraits\n');
    expect(after('## - Dash\n', 6, 6, setHeading(0))).toBe('\\- Dash\n');
    expect(after('## 2026 plan\n', 6, 6, setHeading(0))).toBe('2026 plan\n');
  });

  it('keeps bold that runs over the line break whole when a paragraph\'s later line becomes a heading or an item', () => {
    const doc = 'It is **a long\nbold sentence** that ends.\n';
    const at = doc.indexOf('bold');
    expect(after(doc, at, at, setHeading(2))).toBe('It is **a long**\n## **bold sentence** that ends.\n');
    expect(after(doc, at, at, toggleList('bullet'))).toBe('It is **a long**\n- **bold sentence** that ends.\n');
    const three = 'One *two\nthree four\nfive* six\n';
    const middle = three.indexOf('three');
    expect(after(three, middle, middle, setHeading(2))).toBe('One *two*\n## *three four*\n*five* six\n');
  });

  it('writes a heading or an item on a deeply indented line of a paragraph at the paragraph\'s indent, and keeps a leading "*" as text', () => {
    const doc = 'Log:\n      raw_log: x\n';
    const at = doc.indexOf('raw');
    expect(after(doc, at, at, setHeading(2))).toBe('Log:\n## raw_log: x\n');
    expect(after(doc, at, at, toggleList('bullet'))).toBe('Log:\n- raw_log: x\n');
    const item = '- Item\n        more text\n';
    expect(after(item, item.indexOf('more'), item.indexOf('more'), toggleList('number'))).toBe('- Item\n1. more text\n');
    // A heading stays in the item, so the item's later blocks stay in it too.
    const numbered = '12. Split it.\n    Evidence here.\n\n    | a | b |\n    |---|---|\n    | 1 | 2 |\n';
    const evidence = numbered.indexOf('Evidence');
    expect(after(numbered, evidence, evidence, setHeading(1))).toBe('12. Split it.\n    # Evidence here.\n\n    | a | b |\n    |---|---|\n    | 1 | 2 |\n');
    const star = 'Notes\n\t* understand this\n';
    expect(after(star, star.indexOf('under'), star.indexOf('under'), toggleList('bullet'))).toBe('Notes\n- \\* understand this\n');
  });

  it('puts the caret after the marker of a list made on an empty line', () => {
    const view = mount('Text\n\n‸\n');
    act(() => { toggleList('number')(view); });
    expect(marked(view)).toBe('Text\n\n1. ‸\n');
  });
});

describe('the blank line above a setext heading', () => {
  it('goes on Backspace or Delete, and the heading is written with "#" so the paragraph never joins it', () => {
    for (const [doc, key] of [['Para\n‸\nTitle\n=====\n', 'Backspace'], ['Para\n‸\nTitle\n=====\n', 'Delete'], ['Para‸\n\nTitle\n=====\n', 'Delete']] as const) {
      const view = mount(doc);
      press(view, key);
      expect(text(view)).toBe('Para\n# Title\n');
      expect(caret(view)).toBe(4);
    }
  });
});

describe('the blank line under a list or quote', () => {
  it('moves the caret on Backspace or Delete instead of making the paragraph a line of the item or the quote', () => {
    for (const doc of ['- one\n- two\n\n‸After\n', '> [!note] Title\n> Body\n\n‸After\n', '- one\n- two\n‸\nAfter\n']) {
      const view = mount(doc);
      press(view, 'Backspace');
      expect(text(view)).toBe(doc.replace('‸', ''));
      expect(text(view).slice(caret(view) - 3, caret(view))).toMatch(/two|ody/);
    }
    const view = mount('- one\n- two‸\n\nAfter\n');
    press(view, 'Delete');
    expect(marked(view)).toBe('- one\n- two\n\n‸After\n');
    // Two blank lines: the first Backspace takes one of them, as before.
    const two = mount('- two\n\n\n‸After\n');
    press(two, 'Backspace');
    expect(text(two)).toBe('- two\n\nAfter\n');
  });
});

describe('Option+Up and Option+Down in tables and code', () => {
  it('never moves a table\'s delimiter row or a code block\'s fence, in notes and documents', () => {
    for (const page of [NOTE, DOC]) {
      const table = mount('| a‸ | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n', page);
      press(table, 'ArrowDown', { altKey: true });
      expect(text(table)).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n');
      const code = mount('Intro\n\n```\nco‸de\nmore\n```\n', page);
      press(code, 'ArrowUp', { altKey: true });
      expect(text(code)).toBe('Intro\n\n```\ncode\nmore\n```\n');
      const last = mount('Intro\n\n```\ncode\nmo‸re\n```\n', page);
      press(last, 'ArrowDown', { altKey: true });
      expect(text(last)).toBe('Intro\n\n```\ncode\nmore\n```\n');
    }
    // Body rows and inner code lines still move.
    const rows = mount('| a | b |\n|---|---|\n| 1‸ | 2 |\n| 3 | 4 |\n', NOTE);
    press(rows, 'ArrowDown', { altKey: true });
    expect(text(rows)).toBe('| a | b |\n|---|---|\n| 3 | 4 |\n| 1 | 2 |\n');
  });
});

describe('callouts in a document', () => {
  it('does nothing on Cmd+Enter in a callout that cannot fold, rather than split it', () => {
    for (const doc of ['> [!warning] No‸te\n> Remember the demo.\n', '> [!warning] Note\n> Remember‸ the demo.\n']) {
      const view = mount(doc);
      press(view, 'Enter', /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true });
      expect(text(view)).toBe(doc.replace('‸', ''));
    }
  });

  it('puts Insert > Callout after the callout the caret is in, so it opens as a callout', () => {
    const view = mount('> [!note] Title\n> Body‸\n\nAfter\n');
    view.focus = vi.fn();
    act(() => { void view.state.facet(insertItems).find((item) => item.id === 'callout')?.run(view); });
    expect(marked(view)).toBe('> [!note] Title\n> Body\n\n> [!note] Note\n> ‸\n\nAfter\n');
    const head = text(view).split('\n').indexOf('> [!note] Note');
    expect(calloutMarker(view.state, view.state.doc.line(head + 1))).not.toBeNull();
  });

  it('puts a callout in place of an empty list item', () => {
    const view = mount('- one\n  - two\n  - ‸\n');
    view.focus = vi.fn();
    act(() => { void view.state.facet(insertItems).find((item) => item.id === 'callout')?.run(view); });
    expect(marked(view)).toBe('- one\n  - two\n\n  > [!note] Note\n  > ‸\n');
  });

  it('keeps a list item\'s indent on Enter on an empty quote line in the item', () => {
    const view = mount('- item\n  > quote\n  > ‸\n');
    press(view, 'Enter');
    expect(marked(view)).toBe('- item\n  > quote\n\n  ‸\n');
  });

  it('writes only the fold sign from the menu', () => {
    const state = EditorState.create({ doc: '> [!TIP] Title\n> body\n' });
    expect(refoldCallout(state, 0, '-')).toEqual({ from: 8, to: 8, insert: '-' });
    const folded = EditorState.create({ doc: '> [!tip]+ Title\n' });
    expect(refoldCallout(folded, 0, '')).toEqual({ from: 8, to: 9, insert: '' });
    expect(refoldCallout(folded, 0, '+')).toBeNull();
  });

  it('closes the type menu when an edit changes the page under it', () => {
    const view = mount('Intro text that an agent will remove.\n\n> [!note] Title\n> Body\n');
    const { rerender, container } = render(createElement(CalloutTypeMenu, { view }));
    const icon = view.contentDOM.querySelector('[data-callout-icon]');
    act(() => { icon?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(document.querySelector('[data-callout-menu]')).not.toBeNull();
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '> [!tip] T\n' } }); });
    expect(() => rerender(createElement(CalloutTypeMenu, { view }))).not.toThrow();
    expect(container.querySelector('[data-callout-menu]')).toBeNull();
  });

  it('offers the fold choices in the type menu', () => {
    const view = mount('> [!note] Title\n> Body\n');
    render(createElement(CalloutTypeMenu, { view }));
    const icon = view.contentDOM.querySelector('[data-callout-icon]');
    act(() => { icon?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(document.querySelector('[data-callout-menu]')?.textContent).toContain('Foldable, folded');
  });
});

describe('Tab and Shift+Tab on list items', () => {
  it('leaves an item with a second paragraph where it is, rather than leave the paragraph under the item above', () => {
    const view = mount('- a\n- b‸\n\n  second paragraph of b\n');
    press(view, 'Tab');
    expect(text(view)).toBe('- a\n- b\n\n  second paragraph of b\n');
  });

  it('puts a task back under a numbered item with Tab after Shift+Tab', () => {
    const doc = '- Launch\n  1. Docs\n     - [ ] Review‸\n';
    const view = mount(doc);
    press(view, 'Tab', { shiftKey: true });
    expect(text(view)).toBe('- Launch\n  1. Docs\n  - [ ] Review\n');
    press(view, 'Tab');
    expect(text(view)).toBe('- Launch\n  1. Docs\n     - [ ] Review\n');
  });
});

describe('undo after a row added with Enter', () => {
  it('undoes the typing first, then the row', async () => {
    const view = mount('| a | b |\n|---|---|\n| Sam‸ | 2 |\n', NOTE);
    await focusPage(view);
    press(view, 'Enter');
    expect(text(view)).toBe('| a | b |\n|---|---|\n| Sam | 2 |\n|  |  |\n');
    act(() => { view.dispatch({ changes: { from: caret(view), insert: 'Lee' }, selection: { anchor: caret(view) + 3 }, userEvent: 'input.type' }); });
    act(() => { undo(view); });
    expect(text(view)).toBe('| a | b |\n|---|---|\n| Sam | 2 |\n|  |  |\n');
  });
});

/** Types as the browser does: the text at the caret, through the input handlers. */
function type(view: EditorView, typed: string) {
  act(() => {
    const { from, to } = view.state.selection.main;
    const insert = () => view.state.update({ changes: { from, to, insert: typed }, selection: { anchor: from + typed.length }, userEvent: 'input.type' });
    if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, typed, insert))) view.dispatch(insert());
  });
}

describe('typing after a table that ends the file', () => {
  it('starts a paragraph under the table, never a cell of its last row', async () => {
    const doc = 'Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const view = mount(doc);
    await focusPage(view);
    act(() => { view.dispatch({ selection: { anchor: doc.length }, userEvent: 'select' }); });
    type(view, 'A');
    type(view, 'fter');
    expect(text(view)).toBe(`${doc}\n\nAfter`);
  });

  it('frames the table on Cmd+Down, and a letter typed then starts a paragraph under it', async () => {
    const doc = 'Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const view = mount(`‸${doc}`);
    await focusPage(view);
    press(view, 'End', /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true });
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'table' });
    expect(caret(view)).toBe(doc.length);
    // The browser puts its caret back above the table, where it can rest; the letter still goes under it.
    act(() => { view.dispatch({ selection: { anchor: 5 }, userEvent: 'select' }); });
    const event = new KeyboardEvent('keydown', { key: 'A', bubbles: true, cancelable: true });
    act(() => { view.contentDOM.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(text(view)).toBe(`${doc}\n\nA`);
    expect(view.state.field(objectFrame)).toBeNull();
  });
});

describe('a table whose source shows', () => {
  it('keeps text typed on the line under it out of the table after Insert, Undo and Redo', async () => {
    const view = mount('‸');
    await focusPage(view);
    act(() => { view.state.facet(insertItems).find((item) => item.id === 'table')?.run(view); });
    act(() => { undo(view); });
    act(() => { redo(view); });
    act(() => { view.dispatch({ selection: { anchor: text(view).length } }); });
    type(view, 'N');
    expect(text(view)).toBe('| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n\nN');
  });
});

describe('bold typed into an empty cell of a table whose source shows', () => {
  it('keeps the caret inside the marks, so the whole word is bold', async () => {
    const view = mount('Intro\n\n| Name | Role |\n|---|---|\n| Alex |  |\n\nEnd\n');
    await focusPage(view);
    const cell = text(view).indexOf('|  |') + 2;
    act(() => { view.dispatch({ selection: { anchor: cell }, effects: setOpenBlock.of({ from: 7, to: text(view).indexOf('\n\nEnd') }) }); });
    press(view, 'b', /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true });
    for (const character of 'Lead') type(view, character);
    expect(text(view)).toContain('| Alex | **Lead** |');
  });
});

describe('a wiki link split by its alias pipe in a drawn table', () => {
  it('draws both halves as one broken link, and Fix link writes the backslash', () => {
    const view = mount('Intro\n\n| File | Size |\n|---|---|\n| [[deck.4f2a|Board deck]] | 26 MB |\n\nEnd\n');
    const split = view.contentDOM.querySelectorAll('.cm-md-cell-split');
    expect([...split].map((cell) => cell.textContent?.replace('Fix link', ''))).toEqual(['[[deck.4f2a', 'Board deck]]']);
    const fix = view.contentDOM.querySelector('.cm-md-fix-link') as HTMLElement;
    act(() => { fix.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(text(view)).toContain('| [[deck.4f2a\\|Board deck]] | 26 MB |');
    expect(view.contentDOM.querySelector('.cm-md-cell-split')).toBeNull();
  });
});

describe('a list pasted on an empty list item', () => {
  it('takes the empty item\'s place at its level, never nesting under it', () => {
    const state = (doc: string) => {
      const created = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: markdownEditorExtensions(DOC) });
      ensureSyntaxTree(created, doc.length, 1_000);
      return created.update({}).state;
    };
    const apply = (doc: string, pasted: string) => {
      const before = state(doc);
      const spec = pasteSpec(before, pasted, false);
      return spec ? before.update(spec).state.doc.toString() : null;
    };
    expect(apply('- Launch\n  1. Docs\n     - [ ] Review\n     - [ ] ', '- alpha\n- beta\n  - gamma')).toBe('- Launch\n  1. Docs\n     - [ ] Review\n     - alpha\n     - beta\n       - gamma');
    expect(apply('- one\n\t- two\n\t- ', '- alpha\n  - beta\n')).toBe('- one\n\t- two\n\t- alpha\n\t\t- beta');
    // Text that is not a list pastes as before.
    expect(apply('- one\n- ', 'plain text')).toBeNull();
  });
});
