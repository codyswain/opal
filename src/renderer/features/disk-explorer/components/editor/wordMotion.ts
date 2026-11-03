import { EditorSelection, EditorState, Prec, type ChangeSpec, type EditorSelection as Selection, type Extension } from '@codemirror/state';
import { keymap, type Command } from '@codemirror/view';
import { EMPHASIS, inlineSpans } from './formatCommands';
import { docMode } from './livePreview';
import { rawAfter, rawRange, visibleLine, visibleOffset } from './visibleText';

/*
 * Word and line keys in a document, by the text the page shows. Option+Arrow
 * moves one visible word, the way macOS segments words (Intl.Segmenter), so
 * bold, links, code and wiki links never stop it. Option+Backspace and
 * Option+Delete take a visible word and keep the marks on what is left.
 * Line-start keys (Shift+⌘Left, ⌘Backspace, a triple-click) act on the
 * text only, so a bullet, box, heading or quote stays.
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/** The words of `text` as offsets: where each starts and ends. */
function words(text: string): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = [];
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) found.push({ from: segment.index, to: segment.index + segment.segment.length });
  }
  return found;
}

/** The offset Option+Right reaches from `offset`: the end of the word at or after it, else the line's end. */
export function wordEndAfter(text: string, offset: number): number {
  return words(text).find((word) => word.to > offset)?.to ?? text.length;
}

/** The offset Option+Left reaches from `offset`: the start of the word before it, else the line's start. */
export function wordStartBefore(text: string, offset: number): number {
  const before = words(text).filter((word) => word.from < offset);
  return before.length > 0 ? before[before.length - 1].from : 0;
}

/** Where a caret at `head` lands after one Option+Arrow. */
export function wordStep(state: EditorState, head: number, forward: boolean): number {
  const visible = visibleLine(state, head);
  const offset = visibleOffset(visible, head);
  const { line } = visible;
  if (forward) {
    if (offset >= visible.text.length) return line.number < state.doc.lines ? visibleStart(state, line.to + 1) : line.to;
    return rawAfter(visible, wordEndAfter(visible.text, offset));
  }
  if (offset <= 0) return line.number > 1 ? visibleEnd(state, line.from - 1) : visibleStart(state, 0);
  return rawRange(visible, wordStartBefore(visible.text, offset), wordStartBefore(visible.text, offset)).from;
}

/** Where the text of the line holding `at` starts, past its bullet, box, heading or quote marks. */
export function visibleStart(state: EditorState, at: number): number {
  const visible = visibleLine(state, at);
  return visible.starts[0] ?? visible.line.to;
}

function visibleEnd(state: EditorState, at: number): number {
  const visible = visibleLine(state, at);
  return visible.ends[visible.ends.length - 1] ?? visible.line.to;
}

function moveWord(forward: boolean, extend: boolean): Command {
  return (view) => {
    const { state } = view;
    const selection = EditorSelection.create(state.selection.ranges.map((range) => {
      const head = wordStep(state, range.head, forward);
      return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
    }), state.selection.mainIndex);
    view.dispatch({ selection, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/**
 * The changes that take `from` to `to` out and keep the marks of formatting
 * around it. A space left against a closing or opening mark moves outside
 * it, since Markdown would not read the mark there: deleting "word" from
 * `**bold word**` leaves `**bold** `.
 */
export function deleteKeepingMarks(
  state: EditorState,
  from: number,
  to: number,
  replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] },
): ChangeSpec[] {
  for (const span of inlineSpans(state, from, to)) {
    if (!EMPHASIS.has(span.name)) continue;
    // The deleted text ends the span's text, after a space that would then sit against the closing mark.
    if (to >= span.textTo && from > span.textFrom && from <= span.textTo) {
      let space = from;
      while (space > span.textFrom && /[ \t]/.test(state.sliceDoc(space - 1, space))) space -= 1;
      if (space < from && space > span.textFrom) return [...replace(state, space, Math.min(to, span.textTo), '').changes, { from: span.to, insert: state.sliceDoc(space, from) }];
    }
    if (from <= span.textFrom && to < span.textTo && to >= span.textFrom) {
      let space = to;
      while (space < span.textTo && /[ \t]/.test(state.sliceDoc(space, space + 1))) space += 1;
      if (space > to && space < span.textTo) return [{ from: span.from, insert: state.sliceDoc(to, space) }, ...replace(state, Math.max(from, span.textFrom), space, '').changes];
    }
  }
  return replace(state, from, to, '').changes;
}

function deleteWord(forward: boolean, replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false;
    const visible = visibleLine(state, range.head);
    const offset = visibleOffset(visible, range.head);
    // At a line's edge the key joins lines, as Backspace and Delete do.
    if (forward ? offset >= visible.text.length : offset <= 0) return false;
    const target = forward ? wordEndAfter(visible.text, offset) : wordStartBefore(visible.text, offset);
    const { from, to } = forward ? rawRange(visible, offset, target) : rawRange(visible, target, offset);
    const changes = deleteKeepingMarks(state, from, to, replace);
    view.dispatch({ changes, scrollIntoView: true, userEvent: forward ? 'delete.forward.word' : 'delete.backward.word' });
    return true;
  };
}

/** Shift+⌘Left and ⌘Left: to where the line's text starts, never into its bullet or heading marks. */
function lineStart(extend: boolean): Command {
  return (view) => {
    const { state } = view;
    const selection = EditorSelection.create(state.selection.ranges.map((range) => {
      const boundary = view.moveToLineBoundary(range, false).head;
      const start = visibleStart(state, range.head);
      const head = boundary <= start ? start : boundary;
      return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
    }), state.selection.mainIndex);
    view.dispatch({ selection, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/** ⌘Backspace: the text from the line's start to the caret, keeping the bullet, box, heading or quote. */
function deleteToLineStart(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false;
    const boundary = view.moveToLineBoundary(range, false).head;
    const start = Math.max(boundary, visibleStart(state, range.head));
    if (start >= range.head) return false;
    view.dispatch({ changes: replace(state, start, range.head, '').changes, scrollIntoView: true, userEvent: 'delete.backward.line' });
    return true;
  };
}

/** A triple-click's line, from where its text starts to its end, so typing over it keeps the line's marks. */
function lineSelections(state: EditorState, selection: Selection): Selection | null {
  let changed = false;
  const ranges = selection.ranges.map((range) => {
    if (range.empty) return range;
    const line = state.doc.lineAt(range.from);
    if (range.from !== line.from) return range;
    const start = visibleStart(state, line.from);
    const whole = range.to === line.to || (line.number < state.doc.lines && range.to === line.to + 1);
    if (start === line.from && !(whole && range.to > line.to)) return range;
    changed = true;
    const to = whole ? line.to : range.to;
    return range.anchor <= range.head ? EditorSelection.range(start, to) : EditorSelection.range(to, start);
  });
  return changed ? EditorSelection.create(ranges, selection.mainIndex) : null;
}

const pointerLines = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || !tr.isUserEvent('select.pointer') || !tr.startState.facet(docMode)) return tr;
  const selection = lineSelections(tr.state, tr.newSelection);
  return selection ? [tr, { selection, sequential: true }] : tr;
});

/** Doc mode's word and line keys. `replace` is doc mode's `replaceVisible`. */
export function wordMotion(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }): Extension {
  return [
    pointerLines,
    Prec.high(keymap.of([
      { key: 'Alt-ArrowLeft', run: moveWord(false, false), shift: moveWord(false, true) },
      { key: 'Alt-ArrowRight', run: moveWord(true, false), shift: moveWord(true, true) },
      { key: 'Alt-Backspace', run: deleteWord(false, replace) },
      { key: 'Alt-Delete', run: deleteWord(true, replace) },
      { key: 'Mod-ArrowLeft', run: lineStart(false), shift: lineStart(true) },
      { key: 'Mod-Backspace', run: deleteToLineStart(replace) },
    ])),
  ];
}
