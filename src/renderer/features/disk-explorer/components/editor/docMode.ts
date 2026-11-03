import { syntaxTree } from '@codemirror/language';
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
  findClusterBreak,
  type ChangeSpec,
  type Extension,
  type SelectionRange,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, type Command, type ViewUpdate } from '@codemirror/view';
import {
  EMPHASIS,
  STYLES,
  closingAt,
  inlineSpans,
  linkAt,
  setHeading,
  setTypingStyle,
  styledAt,
  toggleList,
  toggleMarker,
  typingStyle,
} from './formatCommands';
import { imageFrame } from './imageFrame';
import { insertImageItem } from './imageInsert';
import { blockObjects } from './blockObjects';
import { blockPosition, docMode, drawnBlockAt, hiddenRanges, setOpenBlock, type HiddenRange } from './livePreview';
import { objectAt } from './extensionPoints';
import { currentKeyEvent, deleteObject, focusObjectBar, objectFrameExtension, setFrame } from './objectFrame';
import { headingKeys } from './headingKeys';
import { docListKeys } from './listKeys';
import { insertTableItem } from './tableInsert';
import { opensNewTab } from './wikiLinks';

/*
 * Doc mode, for documents (.mdo): the page editor with its Markdown always
 * hidden, as in Google Docs. The caret never stops inside hidden marks, keys
 * step over what the page shows, and deleting never leaves half a mark. The
 * text stays the file's Markdown, so what is not edited keeps its bytes.
 * Nothing here moves text or the caret while an input method is composing.
 */

/** The hidden ranges on the lines around `from` to `to`. */
function hiddenNear(state: EditorState, from: number, to = from): HiddenRange[] {
  const { doc } = state;
  return hiddenRanges(state, doc.lineAt(Math.max(0, from - 1)).from, doc.lineAt(Math.min(doc.length, to + 1)).to);
}

const around = (hidden: readonly HiddenRange[], at: number) => hidden.find((range) => range.from < at && at < range.to);

/** `at` moved out of any hidden range it is inside, toward `side`, past the next one if it lands in that. */
function outside(state: EditorState, at: number, side: -1 | 1, hidden = hiddenNear(state, at)): number {
  for (let range = around(hidden, at); range; range = around(hidden, at)) {
    at = side < 0 ? range.from : range.to;
    hidden = hiddenNear(state, at);
  }
  return at;
}

/**
 * Where a caret at `at` rests. Out of a drawn block or picture to its nearer
 * side, and on past a block right beside it. Where hidden marks make several
 * positions one place, before them, so typed text takes the formatting of
 * the text before it, except past the last mark there that opens a line or
 * closes a link or code.
 */
function caretPosition(state: EditorState, at: number, hidden = hiddenNear(state, at)): number {
  const unit = hidden.find((range) => range.unit && range.from < at && at < range.to);
  if (unit) return outside(state, at, at - unit.from <= unit.to - at ? -1 : 1, hidden);
  const marks = hidden.filter((range) => !range.unit);
  let start = at;
  for (let mark = marks.find((range) => range.from < start && range.to >= start); mark; mark = marks.find((range) => range.from < start && range.to >= start)) start = mark.from;
  let rest = start;
  for (let end = start, mark = marks.find((range) => range.from === end); mark; mark = marks.find((range) => range.from === end)) {
    end = mark.to;
    if (mark.caretAfter) rest = end;
  }
  return rest;
}

/** The selection with each caret where it rests, and each end of a range out of hidden text. */
function settle(state: EditorState, selection: EditorSelection): EditorSelection {
  let changed = false;
  const ranges = selection.ranges.map((range) => {
    let next: SelectionRange;
    if (range.empty) {
      const hidden = hiddenNear(state, range.head);
      const at = caretPosition(state, range.head, hidden);
      // The caret sides with the text it touches, so the browser types there.
      next = at === range.head ? range : EditorSelection.cursor(at, hidden.some((r) => r.from === at) ? -1 : 1);
    } else {
      const from = outside(state, range.from, -1);
      const to = outside(state, range.to, 1);
      next = from === range.from && to === range.to ? range : range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
    }
    if (next !== range) changed = true;
    return next;
  });
  return changed ? EditorSelection.create(ranges, selection.mainIndex) : selection;
}

/**
 * The changes that replace `from` to `to` with `insert` and keep the marks
 * of formatting that reaches past the range, so no "**" loses its partner.
 * Formatting whose text is all removed goes, marks and all, unless the
 * inserted text lands in it, which is how typing over bold text stays bold.
 */
function replaceVisible(state: EditorState, from: number, to: number, insert: string): { changes: ChangeSpec[]; caret: number } {
  const spans = inlineSpans(state, from, to).sort((a, b) => (a.to - a.from) - (b.to - b.from));
  const start = from;
  for (const span of spans) {
    const emptied = span.textFrom >= from && span.textTo <= to;
    const filled = insert !== '' && span.textFrom <= start && start <= span.textTo;
    if (emptied && !filled) {
      from = Math.min(from, span.from);
      to = Math.max(to, span.to);
    }
  }
  const kept = spans.filter((span) => span.from < from || span.to > to)
    .flatMap((span) => [[span.from, span.textFrom], [span.textTo, span.to]])
    .map(([markFrom, markTo]) => [Math.max(markFrom, from), Math.min(markTo, to)])
    .filter(([markFrom, markTo]) => markTo > markFrom)
    .sort((a, b) => a[0] - b[0]);
  const removed: { from: number; to: number }[] = [];
  let at = from;
  for (const [markFrom, markTo] of kept) {
    if (markFrom > at) removed.push({ from: at, to: markFrom });
    at = Math.max(at, markTo);
  }
  if (to > at) removed.push({ from: at, to });
  const insertAt = removed[0]?.from ?? start;
  const changes: ChangeSpec[] = removed.map((range, index) => (index === 0 ? { ...range, insert } : range));
  if (removed.length === 0) changes.push({ from: insertAt, insert });
  return { changes, caret: ChangeSet.of(changes, state.doc.length).mapPos(insertAt, 1) };
}

// User edits that take text out: typing or pasting over a selection, Backspace, Delete and Cut.
const REMOVING = ['input.type', 'input.paste', 'delete.backward', 'delete.forward', 'delete.selection', 'delete.cut'];

/** `tr` as `replaceVisible` would make it, when it is a user edit that removes one range of text. */
function keepMarks(tr: Transaction): TransactionSpec | null {
  if (!REMOVING.some((event) => tr.isUserEvent(event))) return null;
  const edits: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => edits.push({ from: fromA, to: toA, insert: inserted.toString() }));
  if (edits.length !== 1 || edits[0].to === edits[0].from) return null;
  const { from, to, insert } = edits[0];
  const { changes, caret } = replaceVisible(tr.startState, from, to, insert);
  const spec = { changes, selection: { anchor: caret }, scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) };
  const next = tr.startState.update({ ...spec, filter: false });
  return next.newDoc.eq(tr.newDoc) ? null : { ...spec, selection: settle(next.state, next.newSelection) };
}

/**
 * `tr` with the text it inserts at the caret put where the page shows it
 * going, or null when it already goes there. A space or line break at the
 * end of bold, italic or strikethrough goes after their closing marks, since
 * Markdown ends none of them on a space. Typed text leaves formatting a
 * toggle turned off by going past its closing marks, and is wrapped in the
 * marks of styles a toggle turned on, or joins the same style beside it.
 */
function placeTyped(tr: Transaction): TransactionSpec | null {
  const state = tr.startState;
  const caret = state.selection.main;
  if (!tr.isUserEvent('input') || state.selection.ranges.length > 1 || !caret.empty) return null;
  const inserts: string[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => { inserts.push(fromA === caret.head && toA === fromA ? inserted.toString() : ''); });
  const text = inserts.length === 1 ? inserts[0] : '';
  if (!text) return null;
  const at = caret.head;
  const style = state.field(typingStyle);
  const markers = tr.isUserEvent('input.type') && style?.at === at ? style.markers : [];
  const space = /^\s*/.exec(text)?.[0] ?? '';
  const words = text.slice(space.length);
  const closing = closingAt(state, at);
  const left = space ? closing : closing.filter((span) => markers.some((marker) => STYLES[marker] === span.name));
  let from = left.length > 0 ? left[left.length - 1].to : at;
  const wrap: string[] = [];
  for (const marker of markers.filter((other) => !styledAt(state, at, STYLES[other]))) {
    // Two pairs of the same marks side by side format nothing, so typed text joins the formatting beside it.
    const beside = space ? null : inlineSpans(state, from, from).find((span) => span.name === STYLES[marker] && (span.to === from || span.from === from));
    if (beside) from = beside.to === from ? beside.textTo : beside.textFrom;
    else wrap.push(marker);
  }
  if (from === at && wrap.length === 0) return null;
  const open = words ? wrap.join('') : '';
  const close = words ? [...wrap].reverse().join('') : '';
  // A line break takes the spaces after it, as Enter does elsewhere.
  let to = from;
  if (space.includes('\n')) while (/[ \t]/.test(state.sliceDoc(to, to + 1))) to += 1;
  const anchor = from + space.length + open.length + words.length;
  return {
    changes: { from, to, insert: space + open + words + close },
    selection: { anchor },
    // Spaces typed before any words keep the styles turned on for the words.
    effects: words || wrap.length === 0 ? [] : setTypingStyle.of({ at: anchor, markers: wrap }),
    scrollIntoView: tr.scrollIntoView,
    userEvent: tr.annotation(Transaction.userEvent),
  };
}

/** After typing that closed bold, italic or strikethrough, as the last "*" of "**x**" does: the end of its closing marks. */
function closedByTyping(tr: Transaction): number | null {
  if (!tr.isUserEvent('input.type') || tr.newSelection.ranges.length > 1) return null;
  const typed: { from: number; to: number }[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, from, to) => { typed.push({ from, to }); });
  if (typed.length !== 1) return null;
  const { from, to } = typed[0];
  const closed = inlineSpans(tr.state, from, to).filter((span) => EMPHASIS.has(span.name) && span.textTo <= from && to <= span.to);
  return closed.length > 0 ? Math.min(...closed.map((span) => span.to)) : null;
}

/** Where one key press moves the caret from `at`: over hidden marks and one character, or over a picture or block as a whole. */
function step(state: EditorState, at: number, forward: boolean): number {
  const { doc } = state;
  const hidden = hiddenNear(state, at);
  const marks = hidden.filter((range) => !range.unit);
  let from = at;
  if (forward) {
    for (let mark = marks.find((r) => r.from <= from && r.to > from); mark; mark = marks.find((r) => r.from <= from && r.to > from)) from = mark.to;
    if (from >= doc.length) return at;
    const unit = hidden.find((range) => range.unit && range.from === from);
    if (unit) return unit.to;
    const line = doc.lineAt(from);
    // Past a line break the caret starts the next line's text.
    return from === line.to ? caretPosition(state, from + 1) : line.from + findClusterBreak(line.text, from - line.from, true);
  }
  for (let mark = marks.find((r) => r.from < from && r.to >= from); mark; mark = marks.find((r) => r.from < from && r.to >= from)) from = mark.from;
  if (from === 0) return 0;
  const unit = hidden.find((range) => range.unit && range.to === from);
  if (unit) return unit.from;
  const line = doc.lineAt(from);
  return from === line.from ? from - 1 : line.from + findClusterBreak(line.text, from - line.from, false);
}

/** Left and Right, with Shift to extend the selection: one character as the page shows it. */
function moveVisibly(forward: boolean, extend: boolean): Command {
  return (view) => {
    const { state } = view;
    const selection = EditorSelection.create(state.selection.ranges.map((range) => {
      if (!extend && !range.empty) return EditorSelection.cursor(forward ? range.to : range.from);
      const head = step(state, range.head, forward);
      return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
    }), state.selection.mainIndex);
    view.dispatch({ selection, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/**
 * Backspace and Delete: the character the page shows next to the caret, or
 * the selection. The marks around it stay, unless its formatting is left
 * with no text. At the start of a heading Backspace joins it to the line
 * above, or makes it text on the first line. Right after a list or quote
 * marker it leaves the key to the list commands. A framed object, the
 * delete handlers and the objects beside the caret come first.
 */
function deleteVisibly(forward: boolean): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.readOnly || state.selection.ranges.length > 1) return false;
    if (deleteObject(view, forward ? 1 : -1, currentKeyEvent(view, forward ? 'Delete' : 'Backspace'))) return true;
    let { from, to } = range;
    if (range.empty) {
      const line = state.doc.lineAt(range.head);
      if (!forward && listOrQuoteText(state, range.head)) return false;
      const target = step(state, range.head, forward);
      if (forward) to = target;
      else from = target === range.head ? line.from : target;
      // A drawn block keeps one of the line breaks around it.
      const unit = hiddenNear(state, from, to).find((hidden) => hidden.unit && hidden.from === from && hidden.to === to);
      if (unit && state.sliceDoc(from, from + 1) === '\n' && to - from > 1) from += 1;
      if (from === to) return true;
    }
    view.dispatch({ changes: { from, to }, scrollIntoView: true, userEvent: forward ? 'delete.forward' : 'delete.backward' });
    return true;
  };
}

// Quote marks, a list marker and its box, or the indent of an item's later line, and nothing else.
const LIST_OR_QUOTE_MARKUP = /^[ \t>]*(?:(?:[-+*]|\d+[.)])(?:[ \t]+\[[ xX]\])?)?[ \t]*$/;

/** Whether `at` is where a list item's or quote's text starts, where Backspace takes off a level of markup. */
function listOrQuoteText(state: EditorState, at: number): boolean {
  const prefix = state.sliceDoc(state.doc.lineAt(at).from, at);
  return prefix !== '' && LIST_OR_QUOTE_MARKUP.test(prefix);
}

/** Right after a space that made "# ", "- " or "1. " into formatting, the caret position; null otherwise. */
const autoformatted = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged) return tr.selection ? null : value;
    if (!tr.isUserEvent('input.type')) return null;
    let typed: number | null = null;
    tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
      if (fromA === toA && inserted.toString() === ' ') typed = toB;
    });
    if (typed === null) return null;
    const mark = syntaxTree(tr.state).resolveInner(typed - 1, -1);
    const opens = mark.name === 'ListMark' || (mark.name === 'HeaderMark' && mark.parent?.firstChild?.from === mark.from);
    return opens && mark.to === typed - 1 ? typed : null;
  },
});

/** Backspace straight after an autoformat turns the mark back into text, escaped: "\# ", "\- ", "1\. ". */
const undoAutoformat: StateCommand = ({ state, dispatch }) => {
  const at = state.field(autoformatted);
  const { main } = state.selection;
  if (at === null || state.selection.ranges.length > 1 || !main.empty || main.head !== at) return false;
  const mark = syntaxTree(state).resolveInner(at - 1, -1);
  const numbered = mark.name === 'ListMark' && /\d/.test(state.sliceDoc(mark.from, mark.from + 1));
  dispatch(state.update({ changes: { from: numbered ? mark.to - 1 : mark.from, insert: '\\' }, userEvent: 'input' }));
  return true;
};

/** The link a click or Cmd+K is about, while its popover shows; `editing` once its fields are open. */
export interface LinkEditor {
  from: number;
  to: number;
  editing: boolean;
}

export const setLinkEditor = StateEffect.define<LinkEditor | null>();

/** Shown on a click in a link until the caret leaves it or the text changes; edited until applied or closed. */
export const linkEditor = StateField.define<LinkEditor | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLinkEditor)) return effect.value;
    if (!value) return value;
    if (tr.docChanged) return value.editing ? { ...value, from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) } : null;
    if (value.editing || !tr.selection) return value;
    const { head } = tr.state.selection.main;
    return head < value.from || head > value.to ? null : value;
  },
});

/** Cmd+K: edits the link at the caret, or starts one over the selection's first line, the text the form shows. */
export const editLink: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  const link = linkAt(state, main.from);
  const line = state.doc.lineAt(main.from);
  const range = link && main.to <= link.to ? link : { from: main.from, to: Math.max(main.from, Math.min(main.to, line.from + line.text.trimEnd().length)) };
  view.dispatch({ effects: setLinkEditor.of({ from: range.from, to: range.to, editing: true }) });
  return true;
};

/**
 * Option+F10, or ⌃⌥T where F10 is the Mute key, moves focus to the framed
 * object's bar, or else to the toolbar, since Tab indents in the text.
 */
const focusToolbar: Command = (view) => {
  if (focusObjectBar(view)) return true;
  const button = view.dom.closest('.opal-editor')?.querySelector<HTMLElement>('[role="toolbar"] [tabindex="0"]');
  button?.focus();
  return Boolean(button);
};

/**
 * A click on a link puts the caret in it and shows its popover; Cmd+click
 * and middle-click still follow it. A click in a table's cell puts a cell
 * caret there (livePreview.ts), and a click elsewhere on a table frames it.
 * A click on a drawn code block puts the caret after it, and a double-click
 * on either shows its Markdown to edit.
 */
const docClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const { target } = event;
    const blockElement = target.closest<HTMLElement>('.cm-md-block');
    const block = blockElement && drawnBlockAt(view.state, view.posAtDOM(blockElement));
    if (blockElement && block) {
      const table = blockElement.classList.contains('cm-md-table');
      if (table && event.detail < 2 && target.closest('td[data-offset], th[data-offset]')) return false;
      event.preventDefault();
      const after = { anchor: Math.min(block.to + 1, view.state.doc.length) };
      const framed = table ? objectAt(view.state, block.from, 1) : null;
      view.dispatch(event.detail >= 2
        ? { selection: { anchor: blockPosition(view, blockElement, target, event) }, effects: setOpenBlock.of(block) }
        : { selection: after, effects: framed ? setFrame.of(framed) : [] });
      view.focus();
      return true;
    }
    const linkElement = target.closest('[data-href], [data-wiki-target]');
    if (!linkElement || opensNewTab(event)) return false;
    event.preventDefault();
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.posAtDOM(linkElement);
    const link = linkAt(view.state, at) ?? linkAt(view.state, view.posAtDOM(linkElement));
    view.dispatch({ selection: { anchor: at }, effects: link ? setLinkEditor.of({ from: link.from, to: link.to, editing: false }) : [] });
    view.focus();
    return true;
  },
});

const atom = Decoration.replace({});

/** The hidden ranges in view as atomic ranges, so CodeMirror's own motions and deletions step over them whole. */
const atoms = ViewPlugin.fromClass(class {
  ranges: RangeSet<Decoration>;

  constructor(view: EditorView) {
    this.ranges = this.read(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.transactions.some((tr) => tr.effects.length > 0)) {
      this.ranges = this.read(update.view);
    }
  }

  read(view: EditorView) {
    return RangeSet.of(hiddenRanges(view.state, view.viewport.from, view.viewport.to).map((range) => atom.range(range.from, range.to)), true);
  }
}, { provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.ranges ?? RangeSet.empty) });

/** The toolbar's shortcuts, as in Google Docs. */
const docKeymap = [
  ...[0, 1, 2, 3, 4, 5, 6].map((level) => ({ key: `Mod-Alt-${level}`, run: setHeading(level) })),
  { key: 'Mod-Shift-x', run: toggleMarker('~~') },
  { key: 'Mod-Shift-7', run: toggleList('number') },
  { key: 'Mod-Shift-8', run: toggleList('bullet') },
  { key: 'Mod-Shift-9', run: toggleList('task') },
  { key: 'Mod-k', run: editLink },
  { key: 'Alt-F10', run: focusToolbar },
  { key: 'Ctrl-Alt-t', run: focusToolbar },
];

/** Doc mode's extensions. Each editor gets its own, since they track that editor's input method. */
export function docModeExtensions(): Extension {
  const input = { composing: false };
  return [
    docMode.of(true),
    objectFrameExtension,
    insertImageItem,
    insertTableItem,
    docListKeys,
    headingKeys,
    autoformatted,
    linkEditor,
    atoms,
    typingStyle,
    EditorState.transactionFilter.of((tr) => {
      if (input.composing || tr.isUserEvent('input.type.compose')) return tr;
      const kept = keepMarks(tr) ?? placeTyped(tr);
      if (kept) return kept;
      if (!tr.docChanged && !tr.selection) return tr;
      // Typed closing marks leave the caret after them, so the text typed next is plain.
      const closed = closedByTyping(tr);
      if (closed !== null) return [tr, { selection: { anchor: closed }, sequential: true }];
      const selection = settle(tr.state, tr.newSelection);
      return selection === tr.newSelection ? tr : [tr, { selection, sequential: true }];
    }),
    blockObjects,
    // The browser types where its own caret is, which can be the other side of a hidden mark.
    EditorView.inputHandler.of((view, from, to, text) => {
      const { selection } = view.state;
      const caret = selection.main;
      if (view.composing || view.compositionStarted || from !== to || selection.ranges.length > 1 || !caret.empty || from === caret.head) return false;
      if (caretPosition(view.state, from) !== caretPosition(view.state, caret.head)) return false;
      view.dispatch({ changes: { from: caret.head, insert: text }, selection: { anchor: caret.head + text.length }, scrollIntoView: true, userEvent: 'input.type' });
      return true;
    }),
    EditorView.domEventObservers({
      compositionstart: () => { input.composing = true; },
      compositionend: () => { input.composing = false; },
    }),
    Prec.highest(docClicks),
    imageFrame,
    Prec.high(keymap.of([
      { key: 'ArrowLeft', run: moveVisibly(false, false), shift: moveVisibly(false, true) },
      { key: 'ArrowRight', run: moveVisibly(true, false), shift: moveVisibly(true, true) },
      { key: 'Backspace', run: (view) => undoAutoformat(view) || deleteVisibly(false)(view) },
      { key: 'Delete', run: deleteVisibly(true) },
      ...docKeymap,
    ])),
  ];
}
