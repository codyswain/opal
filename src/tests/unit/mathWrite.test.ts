import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { clearFormatting, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { mathNodeAt, mathNodes } from '@/renderer/features/disk-explorer/components/editor/math';
import { renderUncached } from '@/renderer/features/disk-explorer/components/editor/mathWidget';
import {
  applyTyped,
  closeMathEditor,
  editFormula,
  mathEditor,
  notAFormula,
  openMathEditor,
  switchDisplay,
  texWrite,
  typedForFormula,
  writeLive,
} from '@/renderer/features/disk-explorer/components/editor/mathWrite';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
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
});

function mount(doc: string, page = DOC): EditorView {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page) }) });
  ensureSyntaxTree(view.state, doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const caret = (view: EditorView) => view.state.selection.main.head;

/** A key press as the browser sends it, through every handler. */
function key(view: EditorView, name: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  act(() => { view.contentDOM.dispatchEvent(event); });
  return event.defaultPrevented;
}

function type(view: EditorView, typed: string) {
  act(() => {
    const at = caret(view);
    const insert = () => view.state.update({ changes: { from: at, insert: typed }, selection: { anchor: at + typed.length }, userEvent: 'input.type' });
    if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, typed, insert))) view.dispatch(insert());
  });
}

/** Opens the popover on the formula at `at` and writes `input` in its field, as typing there does. */
function edit(view: EditorView, at: number, input: string) {
  const node = mathNodeAt(syntaxTree(view.state), at, 1);
  if (!node) throw new Error(`no formula at ${at}`);
  openMathEditor(view, node);
  const editor = view.state.field(mathEditor);
  if (!editor) throw new Error('no editor');
  writeLive(view, editor, input, () => true);
}

/** Exactly one formula, spanning `formula`, in `doc`. */
function readsAsOneFormula(doc: string, formula: string): boolean {
  const state = EditorState.create({ doc, extensions: markdownEditorExtensions(NOTE) });
  const tree = ensureSyntaxTree(state, doc.length, 5_000);
  if (!tree) return false;
  const found = mathNodes(tree, 0, doc.length);
  const at = doc.indexOf(formula);
  return found.length === 1 && found[0].from === at && found[0].to === at + formula.length;
}

describe('formulas as objects in a document', () => {
  it('takes $a*b*c$ out whole with one Backspace, and Cmd+Z brings it back', () => {
    const view = mount('Let $a*b*c$ be');
    act(() => { view.dispatch({ selection: { anchor: 'Let $a*b*c$'.length } }); });
    key(view, 'Backspace');
    expect(text(view)).toBe('Let  be');
    act(() => { undo(view); });
    expect(text(view)).toBe('Let $a*b*c$ be');
  });

  it('frames a display block on the first Backspace and takes its lines on a second press', () => {
    const view = mount('Above\n$$\nx^2\n$$\nBelow');
    act(() => { view.dispatch({ selection: { anchor: text(view).indexOf('Below') } }); });
    key(view, 'Backspace');
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'math-block' });
    expect(text(view)).toBe('Above\n$$\nx^2\n$$\nBelow');
    key(view, 'Backspace');
    expect(text(view)).toBe('Above\n\nBelow');
  });

  it('puts bold around a formula the selection crosses, never inside it', () => {
    const view = mount('a $x+y$ b');
    act(() => { view.dispatch({ selection: { anchor: 0, head: 5 } }); });
    act(() => { toggleMarker('**')(view); });
    expect(text(view)).toBe('**a $x+y$** b');
  });

  it('never writes inside a formula when bold or clear runs over it in a note', () => {
    const view = mount('a $x*y*z$ b', NOTE);
    act(() => { view.dispatch({ selection: { anchor: 4, head: 6 } }); });
    act(() => { toggleMarker('**')(view); });
    expect(text(view)).toContain('$x*y*z$');
    act(() => { view.dispatch({ selection: { anchor: 0, head: text(view).length } }); });
    act(() => { clearFormatting(view); });
    expect(text(view)).toContain('$x*y*z$');
  });

  it('draws a formula closed by a typed $ without moving the caret or framing, and Backspace then takes only the $', () => {
    const view = mount('Area ');
    act(() => { view.dispatch({ selection: { anchor: 5 } }); });
    for (const typed of ['$', '\\pi r^2', '$']) type(view, typed);
    expect(text(view)).toBe('Area $\\pi r^2$');
    expect(caret(view)).toBe(text(view).length);
    expect(view.state.field(objectFrame)).toBeNull();
    expect(view.contentDOM.querySelector('.cm-math')).not.toBeNull();
    key(view, 'Backspace');
    expect(text(view)).toBe('Area $\\pi r^2');
  });

  it('keeps money as text while it is typed', () => {
    const view = mount('Costs ');
    act(() => { view.dispatch({ selection: { anchor: 6 } }); });
    type(view, '$5,');
    type(view, '$');
    expect(caret(view)).toBe(10);
    type(view, '6');
    expect(text(view)).toBe('Costs $5,$6');
    expect(mathNodes(syntaxTree(view.state), 0, text(view).length)).toEqual([]);
    expect(view.state.field(objectFrame)).toBeNull();
  });
});

describe('formula write rules', () => {
  it('writes as you type outside history, and closing is one undo step', () => {
    const view = mount('Energy $E=mc^2$ here');
    edit(view, 7, 'E=mc^3');
    expect(text(view)).toBe('Energy $E=mc^3$ here');
    act(() => { closeMathEditor(view, 'E=mc^3'); });
    expect(caret(view)).toBe('Energy $E=mc^3$'.length);
    act(() => { undo(view); });
    expect(text(view)).toBe('Energy $E=mc^2$ here');
  });

  it('takes the formula and its marks out when the field is empty', () => {
    const view = mount('a $x$ b');
    edit(view, 2, '');
    act(() => { closeMathEditor(view, ''); });
    expect(text(view)).toBe('a  b');
    const block = mount('Above\n\n$$\nx\n$$\n\nBelow');
    edit(block, 7, '');
    act(() => { closeMathEditor(block, ''); });
    expect(text(block)).toBe('Above\n\nBelow');
  });

  it('trims inline TeX', () => {
    const view = mount('a $x$ b');
    edit(view, 2, '  y + 1  ');
    expect(text(view)).toBe('a $y + 1$ b');
  });

  it('writes a typed $ as \\$', () => {
    expect(typedForFormula('a$b', false)).toBe('a\\$b');
    expect(typedForFormula('a\\$b', false)).toBe('a\\$b');
    const view = mount('a $x$ b');
    edit(view, 2, typedForFormula('x + $', false));
    expect(text(view)).toBe('a $x + \\$$ b');
  });

  it('keeps a trailing space in a block line where it was typed', () => {
    const view = mount('Text\n\n$$\nx\n$$');
    edit(view, 6, 'x + ');
    const editor = view.state.field(mathEditor);
    if (!editor) throw new Error('no editor');
    writeLive(view, editor, 'x + k', () => true);
    expect(text(view)).toBe('Text\n\n$$\nx + k\n$$');
  });

  it('gives a new line in a quoted block the quote marks', () => {
    const view = mount('> $$\n> a\n> $$');
    edit(view, 2, 'a\nb');
    expect(text(view)).toBe('> $$\n> a\n> b\n> $$');
    const listed = mount('- item\n\n  $$\n  a\n  $$');
    edit(listed, text(listed).indexOf('$$'), 'a\n= b');
    expect(text(listed)).toBe('- item\n\n  $$\n  a\n  = b\n  $$');
  });

  it('puts a space before a digit right after the formula', () => {
    const view = mount('a $x$5 b');
    expect(mathNodes(syntaxTree(view.state), 0, 8)).toEqual([]);
    const node = mount('a $x$ 5');
    edit(node, 2, 'y');
    expect(text(node)).toBe('a $y$ 5');
    const state = mount('$x$');
    act(() => { state.dispatch({ changes: { from: 3, insert: '5' }, annotations: [] }); });
    expect(text(state)).toBe('$x$5');
  });

  it.each([
    ['2 + 3', '$2 + 3{}$'],
    ['10 - x', '$10 - x{}$'],
    ['a\\', '$a\\ {}$'],
    ['a\\,', '$a\\,$'],
  ])('writes %j so it reads back as one formula', (input, expected) => {
    const view = mount('Sum $x$ here');
    edit(view, 4, input);
    expect(text(view)).toBe(`Sum ${expected} here`);
    expect(readsAsOneFormula(text(view), expected)).toBe(true);
  });

  it('writes nothing, with a reason, when the TeX could never read back', () => {
    const view = mount('a $x$ b');
    const node = mathNodeAt(syntaxTree(view.state), 2, 1);
    if (!node) throw new Error('no formula');
    openMathEditor(view, node);
    const editor = view.state.field(mathEditor);
    if (!editor) throw new Error('no editor');
    // A raw "$" in the field can only reach the file through typedForFormula; written as is, it ends the formula.
    const result = texWrite(view.state, editor, 'x$');
    expect(result.problem).toMatch(/end the formula early/);
    expect(result.changes).toEqual([]);
  });

  it('writes a typed | in a table cell as \\vert, with a space before a letter, and leaves the rest of the TeX alone', () => {
    expect(typedForFormula('|x|', true)).toBe('\\vert x\\vert');
    expect(typedForFormula('\\|v\\|', true)).toBe('\\Vert v\\Vert');
    expect(typedForFormula('|', true, 'a')).toBe('\\vert ');
    expect(renderUncached('\\vert x\\vert', false).error).toBeNull();
    expect(applyTyped('a\\|b', 'a\\|b|', 5, true)).toEqual({ value: 'a\\|b\\vert', caret: 9 });
  });

  it('types one character into a table-cell formula and deletes it, leaving identical bytes', () => {
    const source = '| a | b |\n|---|---|\n| $\\|v\\| + \\$1$ | c |\n';
    const view = mount(source);
    const at = source.indexOf('$\\|');
    edit(view, at, '\\|v\\| + \\$1x');
    expect(text(view)).toBe(source.replace('\\$1$', '\\$1x$'));
    const editor = view.state.field(mathEditor);
    if (!editor) throw new Error('no editor');
    writeLive(view, editor, '\\|v\\| + \\$1', () => true);
    act(() => { closeMathEditor(view, '\\|v\\| + \\$1'); });
    expect(text(view)).toBe(source);
  });

  it('escapes the dollar until no formula is left with "Not a formula"', () => {
    const state = EditorState.create({ doc: 'Raise $5M,$ now', extensions: markdownEditorExtensions(DOC) });
    ensureSyntaxTree(state, state.doc.length, 1_000);
    const changes = notAFormula(state, 6, 11);
    expect(changes).not.toBeNull();
    expect(state.update({ changes: changes ?? [] }).state.doc.toString()).toBe('Raise \\$5M,$ now');
    const display = EditorState.create({ doc: 'the $$x$$ and', extensions: markdownEditorExtensions(DOC) });
    ensureSyntaxTree(display, display.doc.length, 1_000);
    const next = display.update({ changes: notAFormula(display, 4, 9) ?? [] }).state;
    ensureSyntaxTree(next, next.doc.length, 1_000);
    expect(mathNodes(syntaxTree(next), 0, next.doc.length)).toEqual([]);
  });

  it('refuses Display to Inline while a % comment is in the TeX', () => {
    const view = mount('$$\na % note\n+ b\n$$');
    const node = mathNodeAt(syntaxTree(view.state), 0, 1);
    if (!node) throw new Error('no formula');
    openMathEditor(view, node);
    const editor = view.state.field(mathEditor);
    if (!editor) throw new Error('no editor');
    expect(switchDisplay(view.state, editor).problem).toBe('Remove the % comment first');
  });

  it('turns a display block into an inline formula that reads back, on its own line', () => {
    const view = mount('> $$\n> 2 + 3\n> $$\n');
    const node = mathNodeAt(syntaxTree(view.state), 2, 1);
    if (!node) throw new Error('no formula');
    openMathEditor(view, node);
    const editor = view.state.field(mathEditor);
    if (!editor) throw new Error('no editor');
    const result = switchDisplay(view.state, editor);
    act(() => { view.dispatch({ changes: result.changes }); });
    expect(text(view)).toBe('> $2 + 3{}$\n');
  });

  it('opens a new formula with Cmd+Shift+E and writes nothing until the field has text', () => {
    const view = mount('Text here');
    act(() => { view.dispatch({ selection: { anchor: 4 } }); });
    act(() => { editFormula(view); });
    expect(view.state.field(mathEditor)).toMatchObject({ from: 4, to: 4, kind: 'inline' });
    expect(text(view)).toBe('Text here');
    act(() => { closeMathEditor(view, ''); });
    expect(text(view)).toBe('Text here');
  });

  it('makes a selection the TeX with Cmd+Shift+E, and undo brings the text back', () => {
    const view = mount('so x^2 grows');
    act(() => { view.dispatch({ selection: { anchor: 3, head: 6 } }); });
    act(() => { editFormula(view); });
    expect(text(view)).toBe('so $x^2$ grows');
    act(() => { closeMathEditor(view, 'x^2', false); });
    act(() => { undo(view); });
    expect(text(view)).toBe('so x^2 grows');
  });

  it('starts a display block on an empty line', () => {
    const view = mount('Above\n\n');
    act(() => { view.dispatch({ selection: { anchor: 7 } }); });
    act(() => { editFormula(view); });
    const editor = view.state.field(mathEditor);
    if (!editor) throw new Error('no editor');
    expect(editor.kind).toBe('block');
    writeLive(view, editor, '\\frac{a}{b}', () => true);
    expect(text(view)).toBe('Above\n\n$$\n\\frac{a}{b}\n$$');
  });

  it('turns $$ and Enter into a block and opens its popover; Backspace in the empty field puts the $$ back', async () => {
    const view = mount('Text\n\n');
    act(() => { view.dispatch({ selection: { anchor: 6 } }); });
    type(view, '$');
    type(view, '$');
    key(view, 'Enter');
    expect(text(view)).toBe('Text\n\n$$\n\n$$');
    const editor = view.state.field(mathEditor);
    expect(editor).toMatchObject({ kind: 'block', dollars: true });
    if (!editor) return;
    writeLive(view, editor, 'x', () => true);
    expect(text(view)).toBe('Text\n\n$$\nx\n$$');
    const { restoreDollars } = await import('@/renderer/features/disk-explorer/components/editor/mathWrite');
    writeLive(view, view.state.field(mathEditor) ?? editor, '', () => true);
    act(() => { restoreDollars(view); });
    expect(text(view)).toBe('Text\n\n$$');
  });

  it('follows an edit from elsewhere, and closes when the formula is gone', () => {
    const view = mount('Intro $x$ end');
    const node = mathNodeAt(syntaxTree(view.state), 6, 1);
    if (!node) throw new Error('no formula');
    openMathEditor(view, node);
    act(() => { view.dispatch({ changes: { from: 0, insert: 'New ' } }); });
    expect(view.state.field(mathEditor)).toMatchObject({ from: 10, to: 13, tex: 'x' });
    act(() => { view.dispatch({ changes: { from: 11, to: 12, insert: 'y+1' } }); });
    expect(view.state.field(mathEditor)).toMatchObject({ tex: 'y+1', version: 1 });
    act(() => { view.dispatch({ changes: { from: 10, to: 16 } }); });
    expect(view.state.field(mathEditor)).toBeNull();
  });
});

describe('formulas in tables, headings, links, lists and callouts', () => {
  it('draws formulas in table cells and keeps money there as text', () => {
    const view = mount('| Quantity | Formula | Cost |\n|---|---|---|\n| Area | $\\pi r^2$ | $5M |\n');
    const cells = [...view.contentDOM.querySelectorAll('td')];
    expect(cells[1].querySelector('.cm-math')?.getAttribute('aria-label')).toBe('\\pi r^2');
    expect(cells[2].textContent).toBe('$5M');
  });

  it('opens the popover from a formula in a table cell, and a click elsewhere in the cell gives the cell caret', () => {
    const source = '| Quantity | Formula |\n|---|---|\n| Area | $\\pi r^2$ |\n';
    const view = mount(source);
    view.focus = vi.fn();
    const formula = view.contentDOM.querySelector('td .cm-math');
    if (!formula) throw new Error('no formula in the table');
    act(() => { formula.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(view.state.field(mathEditor)).toMatchObject({ from: source.indexOf('$\\pi'), table: true, tex: '\\pi r^2' });
    act(() => { closeMathEditor(view, null, false); });
    const cell = view.contentDOM.querySelectorAll('td')[0];
    act(() => { cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(view.state.field(mathEditor)).toBeNull();
  });

  it('draws a formula in a heading at the heading\'s size, on its line', () => {
    const view = mount('## Energy $E=mc^2$\n');
    const line = view.contentDOM.querySelector('.cm-md-h2');
    expect(line?.querySelector('.cm-math')?.getAttribute('aria-label')).toBe('E=mc^2');
  });

  it('leaves a click on a formula in link text to the link', async () => {
    const { linkEditor } = await import('@/renderer/features/disk-explorer/components/editor/docMode');
    const view = mount('See [the $O(n)$ bound](https://example.com) here.\n');
    view.focus = vi.fn();
    const formula = view.contentDOM.querySelector('.cm-math');
    expect(formula?.closest('[data-href]')).not.toBeNull();
    act(() => { formula?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 })); });
    expect(view.state.field(mathEditor)).toBeNull();
    expect(view.state.field(linkEditor)).not.toBeNull();
  });

  it('opens the popover from a display block in a quote', () => {
    const view = mount('> $$\n> x^2\n> $$\n');
    view.focus = vi.fn();
    const formula = view.contentDOM.querySelector('.cm-math-block .cm-math');
    act(() => { formula?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(view.state.field(mathEditor)).toMatchObject({ kind: 'block', tex: 'x^2', prefix: '> ' });
  });

  it('crosses an inline formula in one arrow step, and never rests inside it', () => {
    const view = mount('a $x^2$ b');
    act(() => { view.dispatch({ selection: { anchor: 2 } }); });
    key(view, 'ArrowRight');
    expect(caret(view)).toBe(7);
    key(view, 'ArrowLeft');
    expect(caret(view)).toBe(2);
    key(view, 'ArrowRight', { shiftKey: true });
    expect(view.state.selection.main).toMatchObject({ anchor: 2, head: 7 });
  });

  it('lines a display block up with a list item\'s text, and sets it on a callout\'s ground', () => {
    const listed = mount('- item\n\n  $$\n  x^2\n  $$\n');
    const inList = listed.contentDOM.querySelector<HTMLElement>('.cm-math-block');
    expect(inList?.style.getPropertyValue('--list-indent')).toMatch(/em$/);
    const callout = mount('> [!note] Title\n> $$\n> x^2\n> $$\n');
    expect(callout.contentDOM.querySelector('.cm-math-block')?.classList.contains('cm-md-in-callout')).toBe(true);
  });
});
