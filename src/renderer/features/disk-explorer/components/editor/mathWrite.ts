import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Annotation, ChangeSet, EditorSelection, Prec, StateEffect, StateField, Transaction, type ChangeSpec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Command } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { Sigma } from 'lucide-react';
import { deleteHandlers, insertItems, objectKinds, type ObjectAction, type PageObject } from './extensionPoints';
import { docMode } from './livePreview';
import { MATH_NODES, mathNodeAt, mathNodes, mathSpan } from './math';
import { removalOf, removeObject, setFrame } from './objectFrame';

/*
 * Editing formulas in a document. A formula is one object: Backspace takes
 * an inline formula out whole and frames a display block first, and its TeX
 * changes only in the formula popover. The popover writes as you type,
 * outside the undo history; closing it puts the opening TeX back and writes
 * the final TeX as one undo step. Every write is checked by parsing it
 * again: if the TeX would not read back as one formula, `{}` (which TeX
 * ignores) goes at its end, and if that fails too nothing is written.
 */

/** Marks the popover's own writes, so doc mode's typing rules and the remote-edit rule leave them alone. */
export const mathWrite = Annotation.define<'live' | 'restore' | 'final'>();

export type MathKind = 'inline' | 'display' | 'block';

/** The formula a document's popover edits. */
export interface MathEditor {
  /** Which opening of the popover this is. */
  id: number;
  /** The formula's text as written now; equal while a new formula has nothing written. */
  from: number;
  to: number;
  kind: MathKind;
  /** The marks around the TeX: `$`, `$$`, `\(` and `\)`, or a block's `$$` and `\[`. */
  open: string;
  close: string;
  /** The formula's text when the popover opened, put back before the final write. */
  opening: string;
  /** The TeX in the file now. */
  tex: string;
  /** The last TeX that rendered, which the page draws while the file's does not. */
  lastGood: string | null;
  /** Why the last input was not written. */
  problem: string | null;
  /** Counts edits from elsewhere to the formula, so the field reads the file again. */
  version: number;
  /** In a table cell, where a typed `|` is written `\vert`. */
  table: boolean;
  /** What starts each of a block's lines: quote marks and a list item's indent. */
  prefix: string;
  /** Opened by `$$` and Enter: Backspace in the empty field puts the `$$` back. */
  dollars: boolean;
}

export const setMathEditor = StateEffect.define<MathEditor | null>();

let opened = 0;

const EMPTY_TABLE = new Set(['TableCell', 'TableRow', 'TableHeader', 'Table']);

function inTable(node: SyntaxNode): boolean {
  for (let at = node.parent; at; at = at.parent) if (EMPTY_TABLE.has(at.name)) return true;
  return false;
}

/** The quote marks and list indent that start a block's later lines. */
function blockPrefix(state: EditorState, node: SyntaxNode): string {
  const parts = node.getChildren('MathText');
  const opener = state.doc.lineAt(node.from);
  const later = parts.find((part) => state.doc.lineAt(part.from).number > opener.number);
  if (later) {
    const line = state.doc.lineAt(later.from);
    return /^[ \t>]*/.exec(line.text.slice(0, later.from - line.from))?.[0] ?? '';
  }
  return opener.text.slice(0, node.from - opener.from).replace(/(?:[-+*]|\d+[.)])(?=[ \t])/g, (marker) => ' '.repeat(marker.length));
}

/** The editor for the formula `node` is. */
export function editorFor(state: EditorState, node: SyntaxNode): MathEditor {
  const span = mathSpan(state.doc, node);
  const marks = node.getChildren('MathMark');
  const open = marks[0] ? state.sliceDoc(marks[0].from, marks[0].to) : '$';
  const close = marks.length > 1 ? state.sliceDoc(marks[marks.length - 1].from, marks[marks.length - 1].to) : open;
  return {
    id: (opened += 1),
    from: node.from,
    to: node.to,
    kind: node.name === 'BlockMath' ? 'block' : node.name === 'DisplayMath' ? 'display' : 'inline',
    open,
    close,
    opening: state.sliceDoc(node.from, node.to),
    tex: span.tex,
    lastGood: span.tex,
    problem: null,
    version: 0,
    table: inTable(node),
    prefix: node.name === 'BlockMath' ? blockPrefix(state, node) : '',
    dollars: false,
  };
}

/** The math node that the editor's formula is now, if it still reads as one. */
export function editedNode(state: EditorState, editor: MathEditor): SyntaxNode | null {
  if (editor.to === editor.from) return null;
  const tree = ensureSyntaxTree(state, editor.to, 50) ?? syntaxTree(state);
  const node = mathNodeAt(tree, editor.from, 1);
  return node && node.from === editor.from && node.to === editor.to ? node : null;
}

/**
 * The formula being edited, mapped through every change. An edit from
 * elsewhere to the formula reads its TeX again, and closes the popover if
 * the formula is gone or no longer parses.
 */
export const mathEditor = StateField.define<MathEditor | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMathEditor)) return effect.value;
    if (!value || !tr.docChanged) return value;
    if (tr.annotation(mathWrite)) return value;
    let inside = false;
    tr.changes.iterChangedRanges((from, to) => {
      if (from < value.to && to > value.from) inside = true;
    });
    const from = tr.changes.mapPos(value.from, 1);
    const to = tr.changes.mapPos(value.to, -1);
    if (!inside) return from === value.from && to === value.to ? value : { ...value, from, to };
    if (value.to === value.from || to <= from) return null;
    const node = mathNodeAt(syntaxTree(tr.state), from, 1);
    if (!node || node.from !== from || !MATH_NODES.has(node.name)) return null;
    const next = editorFor(tr.state, node);
    return { ...value, from: node.from, to: node.to, kind: next.kind, opening: next.opening, tex: next.tex, lastGood: next.tex, version: value.version + 1, problem: null };
  },
});

/** TeX offsets to document positions, for a formula whose TeX is parts of its lines joined by line breaks. */
interface TexMap {
  parts: { from: number; to: number }[];
}

function texMap(state: EditorState, editor: MathEditor): TexMap | null {
  const node = editedNode(state, editor);
  if (!node) return null;
  if (node.name !== 'BlockMath') {
    const span = mathSpan(state.doc, node);
    return { parts: [{ from: span.texFrom, to: span.texTo }] };
  }
  const parts = node.getChildren('MathText').map((part) => ({ from: part.from, to: part.to }));
  return parts.length > 0 ? { parts } : null;
}

/** The document position of TeX offset `at`. Each line break in the TeX stands for the end of one line and its next line's prefix. */
function docPos(map: TexMap, at: number): number {
  let start = 0;
  for (const part of map.parts) {
    const length = part.to - part.from;
    if (at <= start + length) return part.from + Math.max(0, at - start);
    start += length + 1;
  }
  return map.parts[map.parts.length - 1].to;
}

/** The text a formula's TeX takes in the file: line breaks in a block take its prefix, and inline TeX stays on one line. */
function written(editor: MathEditor, tex: string): string {
  return editor.kind === 'block' ? tex.replace(/\n/g, `\n${editor.prefix}`) : tex.replace(/\n/g, ' ');
}

/** The whole formula as it would be written with `tex`. */
function formulaText(editor: MathEditor, tex: string): string {
  if (editor.kind !== 'block') return `${editor.open}${written(editor, tex)}${editor.close}`;
  return `${editor.open}\n${editor.prefix}${written(editor, tex)}\n${editor.prefix}${editor.close}`;
}

/** The changes that take the file's formula from its TeX now to `tex`: only the part that differs, or the whole formula when it has none yet. */
function texChanges(state: EditorState, editor: MathEditor, tex: string): { changes: ChangeSpec[]; from: number; to: number } {
  const map = editor.to > editor.from ? texMap(state, editor) : null;
  if (!map) {
    const text = formulaText(editor, tex);
    return { changes: [{ from: editor.from, to: editor.to, insert: text }], from: editor.from, to: editor.from + text.length };
  }
  const old = editor.tex;
  let start = 0;
  while (start < old.length && start < tex.length && old[start] === tex[start]) start += 1;
  let end = 0;
  while (end < old.length - start && end < tex.length - start && old[old.length - 1 - end] === tex[tex.length - 1 - end]) end += 1;
  const from = docPos(map, start);
  const to = docPos(map, old.length - end);
  const insert = written(editor, tex.slice(start, tex.length - end));
  return { changes: [{ from, to, insert }], from: editor.from, to: editor.to + insert.length - (to - from) };
}

/** Whether, after `changes`, one formula covers exactly `from` to `to`. */
function readsBack(state: EditorState, changes: ChangeSpec[], from: number, to: number): boolean {
  const next = state.update({ changes, filter: false }).state;
  const tree = ensureSyntaxTree(next, Math.min(next.doc.length, next.doc.lineAt(to).to + 1), 200) ?? syntaxTree(next);
  const node = mathNodeAt(tree, from, 1);
  return Boolean(node && node.from === from && node.to === to);
}

/**
 * Typed text as a formula needs it: a bare `$` written `\$`, and in a table
 * cell, where a pipe ends the cell, `|` written `\vert` and `\|` written
 * `\Vert`, with a space when a letter follows. `after` is the text that
 * follows the typed text.
 */
export function typedForFormula(text: string, table: boolean, after = ''): string {
  let out = '';
  for (let at = 0; at < text.length; at += 1) {
    const ch = text[at];
    let command: string | null = null;
    if (ch === '\\' && table && text[at + 1] === '|') {
      command = '\\Vert';
      at += 1;
    } else if (ch === '\\') {
      out += ch + (text[at + 1] ?? '');
      at += 1;
      continue;
    } else if (ch === '|' && table) {
      command = '\\vert';
    } else if (ch === '$') {
      out += '\\$';
      continue;
    } else {
      out += ch;
      continue;
    }
    const next = at + 1 < text.length ? text[at + 1] : after[0] ?? '';
    out += /[A-Za-z]/.test(next) ? `${command} ` : command;
  }
  return out;
}

/**
 * The field after an input: the typed text rewritten by `typedForFormula`,
 * and only it, so the TeX already there keeps its bytes. `caret` is where
 * the input left the field's caret.
 */
export function applyTyped(before: string, after: string, caret: number, table: boolean): { value: string; caret: number } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start] && start < caret) start += 1;
  const end = after.length - Math.max(caret, start);
  const typed = after.slice(start, after.length - end);
  const rest = after.slice(after.length - end);
  const rewritten = typedForFormula(typed, table, rest);
  return { value: after.slice(0, start) + rewritten + rest, caret: start + rewritten.length };
}

/** What closing with `tex` would write: the TeX after the write rules, or why nothing can be. */
export interface TexWrite {
  /** The TeX that goes in the file, which may end in `{}`. */
  tex: string;
  changes: ChangeSpec[];
  /** Where the formula is after the write. */
  from: number;
  to: number;
  problem: string | null;
}

/**
 * The write for `tex`, by the write rules: inline TeX trimmed; a digit
 * right after a `$…$` gets a space before it, since a closing `$` before a
 * digit closes nothing; and the result read back as one formula, with `{}`
 * added at the end of the TeX when the money guard or a closing rule would
 * read it as text. Empty TeX is written as no formula at all.
 */
export function texWrite(state: EditorState, editor: MathEditor, input: string): TexWrite {
  // TeX between single dollars is trimmed, since "$ x$" is no formula; other marks keep its spaces, so typing and deleting a character gives back the same bytes.
  const tex = editor.open === '$' ? input.trim() : input;
  if (!tex.trim()) return { tex: editor.tex, changes: [], from: editor.from, to: editor.to, problem: null };
  const endsInBackslash = /(^|[^\\])(\\\\)*\\$/.test(tex);
  const tries = endsInBackslash ? [`${tex} {}`] : [tex, `${tex}{}`];
  for (const attempt of tries) {
    const { changes, from, to } = texChanges(state, editor, attempt);
    const all = [...changes];
    // A digit right after "$x$" would make its "$" no closer.
    if (editor.open === '$' && /\d/.test(state.sliceDoc(editor.to, editor.to + 1))) all.push({ from: editor.to, insert: ' ' });
    if (readsBack(state, all, from, to)) return { tex: attempt, changes: all, from, to, problem: null };
  }
  return { tex: editor.tex, changes: [], from: editor.from, to: editor.to, problem: 'This TeX would end the formula early, so it was not written' };
}

/** The changes that take the formula out, marks and all: a block's lines, or an inline formula's text. */
export function removalWrite(state: EditorState, editor: MathEditor): { changes: ChangeSpec[]; caret: number } {
  if (editor.to === editor.from) return { changes: [], caret: editor.from };
  if (editor.kind === 'block' || aloneOnLine(state, editor)) {
    const { changes, caret } = removalOf(state, { kind: 'math-block', from: state.doc.lineAt(editor.from).from, to: state.doc.lineAt(editor.to).to, node: 'BlockMath' }, -1);
    return { changes: [changes], caret };
  }
  return { changes: [{ from: editor.from, to: editor.to }], caret: editor.from };
}

function aloneOnLine(state: EditorState, range: { from: number; to: number }): boolean {
  const line = state.doc.lineAt(range.from);
  return state.doc.lineAt(range.to).number === line.number
    && /^[ \t>]*(?:(?:[-+*]|\d+[.)])[ \t]+)?$/.test(state.sliceDoc(line.from, range.from))
    && /^\s*$/.test(state.sliceDoc(range.to, line.to));
}

/** Writes `input` as the formula's TeX, live: outside the undo history. Returns the editor after it. */
export function writeLive(view: EditorView, editor: MathEditor, input: string, rendered: (tex: string) => boolean): MathEditor {
  const result = texWrite(view.state, editor, input);
  if (result.problem) {
    const next = { ...editor, problem: result.problem };
    view.dispatch({ effects: setMathEditor.of(next) });
    return next;
  }
  const next: MathEditor = {
    ...editor,
    from: result.from,
    to: result.to,
    tex: result.tex,
    problem: null,
    // What the field holds must render: TeX that only reads back with its {} guard, such as a trailing "\", is not yet a formula to keep.
    lastGood: result.tex && rendered(editor.open === '$' ? input.trim() : input) ? result.tex : editor.lastGood,
  };
  view.dispatch({
    changes: result.changes,
    effects: setMathEditor.of(next),
    annotations: [mathWrite.of('live'), Transaction.addToHistory.of(false)],
  });
  return view.state.field(mathEditor) ?? next;
}

/**
 * Closes the popover, keeping what was written: the opening text goes back
 * without history, then the final text is written as one undo step. An
 * empty field takes the formula out. The caret goes after the formula.
 */
export function closeMathEditor(view: EditorView, field: string | null = null, focus = true): void {
  const editor = view.state.field(mathEditor, false);
  if (!editor) return;
  const empty = field !== null && !field.trim();
  const final = view.state.sliceDoc(editor.from, editor.to);
  if (!empty && final === editor.opening) {
    view.dispatch({ effects: setMathEditor.of(null), selection: { anchor: Math.min(editor.to, view.state.doc.length) } });
    if (focus) view.focus();
    return;
  }
  if (final !== editor.opening) {
    view.dispatch({
      changes: { from: editor.from, to: editor.to, insert: editor.opening },
      annotations: [mathWrite.of('restore'), Transaction.addToHistory.of(false)],
    });
  }
  const restored = { ...editor, to: editor.from + editor.opening.length };
  if (empty) {
    const { changes, caret } = removalWrite(view.state, restored);
    view.dispatch({
      changes,
      selection: { anchor: changes.length > 0 ? caret : restored.from },
      effects: setMathEditor.of(null),
      annotations: [mathWrite.of('final'), Transaction.userEvent.of('delete.math')],
      scrollIntoView: true,
    });
  } else {
    view.dispatch({
      changes: { from: restored.from, to: restored.to, insert: final },
      selection: { anchor: restored.from + final.length },
      effects: setMathEditor.of(null),
      annotations: [mathWrite.of('final'), Transaction.userEvent.of('input.math')],
      scrollIntoView: true,
    });
  }
  if (focus) view.focus();
}

/** Opens the popover on the formula `node`. */
export function openMathEditor(view: EditorView, node: SyntaxNode): void {
  view.dispatch({ effects: [setMathEditor.of(editorFor(view.state, node)), setFrame.of(null)], selection: { anchor: node.to } });
}

/** The formula node an object on the page is. */
function nodeOf(state: EditorState, obj: PageObject): SyntaxNode | null {
  const tree = ensureSyntaxTree(state, obj.to, 50) ?? syntaxTree(state);
  return mathNodes(tree, obj.from, obj.to).find((node) => node.name === obj.node && node.from >= obj.from && node.to <= obj.to) ?? null;
}

/** "Not a formula": escapes the opening `$` of each formula over `from` to `to` until none is left. Null when there is none. */
export function notAFormula(state: EditorState, from: number, to: number): ChangeSet | null {
  let changes = ChangeSet.empty(state.doc.length);
  for (let round = 0; round < 8; round += 1) {
    const next = state.update({ changes, filter: false }).state;
    const tree = ensureSyntaxTree(next, next.doc.length, 200) ?? syntaxTree(next);
    const node = mathNodes(tree, changes.mapPos(from, -1), changes.mapPos(to, 1))[0];
    if (!node) break;
    const open = node.getChild('MathMark');
    if (!open || next.sliceDoc(open.from, open.from + 1) !== '$') break;
    changes = changes.compose(ChangeSet.of({ from: open.from, insert: '\\' }, next.doc.length));
  }
  return changes.empty ? null : changes;
}

const COMMENT = /(^|[^\\])%/;

/** Display to inline, or back: the TeX in the other marks. Refused while a `%` comment would swallow the joined lines. */
export function switchDisplay(state: EditorState, editor: MathEditor): { changes: ChangeSpec[]; problem: string | null; anchor: number } {
  if (editor.kind === 'block' || editor.kind === 'display') {
    if (COMMENT.test(editor.tex)) return { changes: [], problem: 'Remove the % comment first', anchor: editor.to };
    const tex = editor.tex.replace(/\s*\n\s*/g, ' ').trim();
    const insert = `$${typedForFormula(tex, editor.table)}$`;
    if (editor.kind === 'block') {
      const line = state.doc.lineAt(editor.from);
      const prefix = state.sliceDoc(line.from, editor.from);
      const last = state.doc.lineAt(editor.to);
      return { changes: [{ from: line.from, to: last.to, insert: `${prefix}${insert}` }], problem: null, anchor: line.from + prefix.length + insert.length };
    }
    return { changes: [{ from: editor.from, to: editor.to, insert }], problem: null, anchor: editor.from + insert.length };
  }
  if (editor.table) return { changes: [], problem: 'A table cell holds only inline formulas', anchor: editor.to };
  const insert = `$$${editor.tex}$$`;
  return { changes: [{ from: editor.from, to: editor.to, insert }], problem: null, anchor: editor.from + insert.length };
}

const isMath = (state: EditorState, node: SyntaxNode, block: boolean) => {
  const alone = node.name === 'DisplayMath' && aloneOnLine(state, node);
  return block ? node.name === 'BlockMath' || alone : node.name !== 'BlockMath' && !alone;
};

function mathActions(): readonly ObjectAction[] {
  return [
    { id: 'edit', label: 'Edit formula', shortcut: '⇧⌘E', run: (view, target) => { const node = nodeOf(view.state, target); if (node) openMathEditor(view, node); } },
    {
      id: 'not-formula',
      label: 'Not a formula',
      run: (view, target) => {
        const changes = notAFormula(view.state, target.from, target.to);
        if (changes) view.dispatch({ changes, effects: setFrame.of(null), userEvent: 'input.math' });
      },
    },
    { id: 'remove', label: 'Remove', run: (view, target) => removeObject(view, target) },
  ];
}

const openObject = (view: EditorView, obj: PageObject) => {
  const node = nodeOf(view.state, obj);
  if (node) openMathEditor(view, node);
};

const mathObjects: Extension = [
  objectKinds.of({ kind: 'math', nodes: ['InlineMath', 'DisplayMath'], block: false, test: (state, node) => isMath(state, node, false), open: openObject, actions: mathActions, destination: () => 'Formula' }),
  objectKinds.of({ kind: 'math-block', nodes: ['BlockMath', 'DisplayMath'], block: true, test: (state, node) => isMath(state, node, true), open: openObject, actions: mathActions, destination: () => 'Formula' }),
];

/** Right after a typed `$` closed a formula, the position after it. */
const closedByDollar = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged) return tr.selection ? null : value;
    if (!tr.isUserEvent('input.type')) return null;
    let typed: number | null = null;
    tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
      if (fromA === toA && inserted.toString() === '$') typed = toB;
    });
    return typed;
  },
});

/** Backspace right after a typed closing `$` takes only that `$`, so the formula goes back to text to keep typing. */
const backspaceTypedDollar = deleteHandlers.of({
  priority: 100,
  run(view, dir) {
    const at = view.state.field(closedByDollar, false);
    const { main } = view.state.selection;
    if (dir > 0 || at === null || at === undefined || !main.empty || main.head !== at) return false;
    const node = mathNodeAt(syntaxTree(view.state), at, -1);
    if (!node || node.to !== at) return false;
    view.dispatch({ changes: { from: at - 1, to: at }, selection: { anchor: at - 1 }, userEvent: 'delete.backward' });
    return true;
  },
});

/** The line's container prefix: quote marks and a list item's indent. */
function linePrefix(text: string): string {
  return (/^[ \t>]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(text)?.[0] ?? '').replace(/(?:[-+*]|\d+[.)])(?=[ \t])/g, (marker) => ' '.repeat(marker.length));
}

/** A new formula's editor at `at`, written on the first key. */
function newEditor(state: EditorState, at: number, kind: MathKind, tex = ''): MathEditor {
  const tree = syntaxTree(state);
  let table = false;
  for (let node: SyntaxNode | null = tree.resolveInner(at, -1); node; node = node.parent) if (EMPTY_TABLE.has(node.name)) table = true;
  const line = state.doc.lineAt(at);
  return {
    id: (opened += 1), from: at, to: at, kind: table ? 'inline' : kind,
    open: kind === 'block' && !table ? '$$' : '$', close: kind === 'block' && !table ? '$$' : '$',
    opening: '', tex, lastGood: null, problem: null, version: 0, table,
    prefix: linePrefix(line.text), dollars: false,
  };
}

/**
 * ⇧⌘E: opens the formula beside the caret, or a new one: inline at the
 * caret, a display block on an empty line, and a selection becomes the TeX.
 * Nothing is written until the field has text.
 */
export const editFormula: Command = (view) => {
  const { state } = view;
  if (!state.facet(docMode) || state.readOnly) return false;
  const { main } = state.selection;
  const tree = syntaxTree(state);
  const beside = main.empty ? mathNodeAt(tree, main.head, -1) ?? mathNodeAt(tree, main.head, 1) : null;
  if (beside) {
    openMathEditor(view, beside);
    return true;
  }
  const line = state.doc.lineAt(main.from);
  const emptyLine = main.empty && line.text.trim().replace(/^[>\s]*/, '') === '' && !/^\s*(?:[-+*]|\d+[.)])\s/.test(line.text);
  if (!main.empty) {
    // The selection becomes the TeX; closing compares with the selected text, so undo brings it back.
    const tex = state.sliceDoc(main.from, main.to);
    const editor = { ...newEditor(state, main.from, 'inline'), to: main.to, opening: tex };
    view.dispatch({ effects: setMathEditor.of(editor) });
    writeLive(view, editor, tex.replace(/\n/g, ' '), () => true);
    return true;
  }
  view.dispatch({ effects: setMathEditor.of(newEditor(state, main.head, emptyLine ? 'block' : 'inline')) });
  return true;
};

/** Enter right after `$$` alone on a line writes a block, `$$`, an empty line and `$$`, and opens its popover. */
const dollarsEnter: Command = (view) => {
  const { state } = view;
  if (!state.facet(docMode)) return false;
  const { main } = state.selection;
  const line = state.doc.lineAt(main.head);
  if (!main.empty || main.head !== line.to) return false;
  const raw = /^[ \t>]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(line.text)?.[0] ?? '';
  if (line.text.slice(raw.length) !== '$$') return false;
  const prefix = linePrefix(line.text);
  const insert = `\n${prefix}\n${prefix}$$`;
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + 1 + prefix.length }, userEvent: 'input.math' });
  const from = line.from + raw.length;
  view.dispatch({ effects: setMathEditor.of({ ...newEditor(view.state, from, 'block'), from, to: line.to + insert.length, opening: view.state.sliceDoc(from, line.to + insert.length), prefix, dollars: true }) });
  return true;
};

/** Backspace in the empty field of a block opened by `$$` and Enter: the `$$` goes back as text. */
export function restoreDollars(view: EditorView): void {
  const editor = view.state.field(mathEditor, false);
  if (!editor?.dollars) return;
  view.dispatch({
    changes: { from: editor.from, to: editor.to, insert: '$$' },
    selection: { anchor: editor.from + 2 },
    effects: setMathEditor.of(null),
    userEvent: 'delete.backward',
  });
  view.focus();
}

/** Insert > Equation. */
export const insertEquationItem = insertItems.of({ id: 'equation', label: 'Equation', icon: Sigma, shortcut: '⇧⌘E', order: 30, run: (view) => { editFormula(view); } });

/** Where a click opened the popover, so it sits by the formula that was clicked, which may be drawn in a table. */
export const clickedFormula = new WeakMap<EditorView, DOMRect>();

/** The formula a drawn element shows: by position, or in a table by its order among the table's formulas. */
function clickedNode(view: EditorView, element: Element): SyntaxNode | null {
  const tree = syntaxTree(view.state);
  const table = element.closest('.cm-md-block');
  if (table && view.contentDOM.contains(table)) {
    let at: number;
    try { at = view.posAtDOM(table); } catch { return null; }
    let node: SyntaxNode | null = tree.resolveInner(Math.min(at + 1, view.state.doc.length), 1);
    while (node && node.name !== 'Table') node = node.parent;
    if (!node) return null;
    const index = [...table.querySelectorAll('.cm-math')].indexOf(element);
    return mathNodes(tree, node.from, node.to)[index] ?? null;
  }
  let at: number;
  try { at = view.posAtDOM(element); } catch { return null; }
  return mathNodeAt(tree, at, 1) ?? mathNodeAt(tree, at, 0);
}

/**
 * A click on a drawn formula in a document opens its popover; in a note it
 * puts the caret in its TeX. A formula in link text leaves the click to the
 * link, and Cmd+click follows a link drawn in a formula.
 */
const mathClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const element = event.target.closest('.cm-math');
    if (!element || !view.contentDOM.contains(element)) return false;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (link && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      window.open(link.href, '_blank');
      return true;
    }
    if (element.closest('[data-href], [data-wiki-target]')) return false;
    const doc = view.state.facet(docMode);
    // In a note a click in a table marks the cell, as anywhere else in it.
    if (!doc && element.closest('.cm-md-block')) return false;
    const node = clickedNode(view, element);
    if (!node) return false;
    event.preventDefault();
    if (doc) {
      clickedFormula.set(view, element.getBoundingClientRect());
      openMathEditor(view, node);
    } else {
      view.dispatch({ selection: EditorSelection.cursor(mathSpan(view.state.doc, node).texFrom) });
      view.focus();
    }
    return true;
  },
  click(event) {
    // A link in a formula opens on Cmd+click only; the page never navigates.
    if (event.target instanceof Element && event.target.closest('.cm-math a[href]')) event.preventDefault();
    return false;
  },
});

/** The formula popover's state, its keys and its objects. */
export const mathEditing: Extension = [
  mathEditor,
  closedByDollar,
  mathObjects,
  backspaceTypedDollar,
  Prec.highest(mathClicks),
  Prec.high(keymap.of([
    { key: 'Mod-Shift-e', run: editFormula },
    { key: 'Enter', run: dollarsEnter },
  ])),
];
