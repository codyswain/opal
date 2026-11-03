import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { mathNodeAt } from '@/renderer/features/disk-explorer/components/editor/math';
import {
  applyTyped,
  closeMathEditor,
  editFormula,
  mathEditor,
  openMathEditor,
  toggleKind,
  writeLive,
} from '@/renderer/features/disk-explorer/components/editor/mathWrite';
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
});

function mount(doc: string): EditorView {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(DOC) }) });
  ensureSyntaxTree(view.state, doc.length, 5_000);
  view.dispatch({});
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

/** Types each character as the browser does, at the caret. */
function type(view: EditorView, typed: string) {
  for (const character of typed) {
    act(() => {
      const at = view.state.selection.main.head;
      const insert = () => view.state.update({ changes: { from: at, insert: character }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
      if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, character, insert))) view.dispatch(insert());
    });
  }
}

function at(view: EditorView, anchor: number, head = anchor) {
  act(() => { view.dispatch({ selection: { anchor, head } }); });
}

function key(view: EditorView, name: string): void {
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); });
}

function open(view: EditorView, at: number) {
  const node = mathNodeAt(syntaxTree(view.state), at, 1);
  if (!node) throw new Error(`no formula at ${at}`);
  act(() => { openMathEditor(view, node); });
}

function editor(view: EditorView) {
  const value = view.state.field(mathEditor);
  if (!value) throw new Error('no editor');
  return value;
}

describe('typing rules beside a $$ line', () => {
  it('escapes typed text under a $$ line that opens nothing, as without it', () => {
    const control = mount('Tier\nx\n');
    at(control, 6);
    type(control, '2*3*4');
    expect(text(control)).toBe('Tier\nx2*3\\*4\n');
    const view = mount('$$ tier\nx\n');
    at(view, 9);
    type(view, '2*3*4');
    expect(text(view)).toBe('$$ tier\nx2*3\\*4\n');
    const list = mount('- $$ pricey\n- x\n');
    at(list, 15);
    type(list, '2*3*4');
    expect(text(list)).toBe('- $$ pricey\n- x2*3\\*4\n');
  });

  it('puts text typed after a final code block holding $$ lines on a new line', () => {
    const view = mount('```latex\n$$\nx\n$$\n```');
    at(view, view.state.doc.length);
    type(view, 'y');
    expect(text(view)).toBe('```latex\n$$\nx\n$$\n```\ny');
  });
});

describe('Cmd+Shift+E on a selection', () => {
  it('opens the formula a selection covers exactly, so the field and the file agree', () => {
    const view = mount('Energy $x$ here\n');
    at(view, 7, 10);
    act(() => { editFormula(view); });
    expect(editor(view).tex).toBe('x');
    expect(editor(view).fresh).toBe(false);
    act(() => { writeLive(view, editor(view), 'xy', () => true); });
    act(() => { closeMathEditor(view, 'xy', false); });
    expect(text(view)).toBe('Energy $xy$ here\n');
  });

  it('opens the formula a selection lies inside', () => {
    const view = mount('Energy $abc$ here\n');
    at(view, 8, 10);
    act(() => { editFormula(view); });
    expect(editor(view).tex).toBe('abc');
  });

  it('writes a selection that holds a formula and more as one new formula, replaced whole', () => {
    const view = mount('Energy $x$ here\n');
    at(view, 0, 10);
    act(() => { editFormula(view); });
    expect(editor(view).tex).toBe('Energy \\$x\\$');
    expect(text(view)).toBe('$Energy \\$x\\$$ here\n');
    act(() => { writeLive(view, editor(view), 'Energy \\$x\\$y', () => true); });
    act(() => { closeMathEditor(view, 'Energy \\$x\\$y', false); });
    expect(text(view)).toBe('$Energy \\$x\\$y$ here\n');
  });
});

describe('$$ then Enter and undo', () => {
  it('leaves no undo step when the popover closes empty', () => {
    const view = mount('Intro\n\n$$\n');
    at(view, 9);
    key(view, 'Enter');
    expect(text(view)).toBe('Intro\n\n$$\n\n$$\n');
    act(() => { closeMathEditor(view, '', false); });
    expect(text(view)).toBe('Intro\n\n$$\n');
    act(() => { undo(view); });
    expect(text(view)).toBe('Intro\n\n$$\n');
  });

  it('takes a finished block back to the typed $$ with one Cmd+Z, then the $$ with the next', () => {
    const view = mount('End.');
    at(view, 4);
    key(view, 'Enter');
    type(view, '$$');
    key(view, 'Enter');
    act(() => { writeLive(view, editor(view), 'k^2', () => true); });
    act(() => { closeMathEditor(view, 'k^2', false); });
    expect(text(view)).toBe('End.\n$$\nk^2\n$$');
    act(() => { undo(view); });
    expect(text(view)).toBe('End.\n$$');
    act(() => { undo(view); });
    expect(text(view)).not.toContain('$');
  });
});

describe('Inline, then Display', () => {
  it('gives a block its own lines back', () => {
    const original = 'Intro\n\n$$\n\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}\n$$\n\nMore\n';
    const view = mount(original);
    open(view, 7);
    act(() => { toggleKind(view, false); });
    expect(text(view)).toBe('Intro\n\n$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$\n\nMore\n');
    act(() => { toggleKind(view, true); });
    expect(text(view)).toBe(original);
    act(() => { closeMathEditor(view, editor(view).tex, false); });
    expect(text(view)).toBe(original);
  });

  it('writes an inline formula alone on its line as a block', () => {
    const view = mount('Intro\n\n- $x^2$\n');
    open(view, 9);
    act(() => { toggleKind(view, true); });
    expect(text(view)).toBe('Intro\n\n- $$\n  x^2\n  $$\n');
  });
});

describe('pasting into the TeX field', () => {
  it('drops one pair of delimiters around a whole pasted formula', () => {
    expect(applyTyped('', '$E=mc^2$', 8, false).value).toBe('E=mc^2');
    expect(applyTyped('', '$$\\frac{a}{b}$$', 15, false).value).toBe('\\frac{a}{b}');
    expect(applyTyped('', '\\(g=9.8\\)', 9, false).value).toBe('g=9.8');
    expect(applyTyped('', '\\[x\\]', 5, false).value).toBe('x');
    expect(applyTyped('', '$5 and $10', 10, false).value).toBe('\\$5 and \\$10');
    expect(applyTyped('a', 'a$x$', 4, false).value).toBe('a\\$x\\$');
  });
});
