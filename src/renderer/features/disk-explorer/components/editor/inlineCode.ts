import { EditorState, Prec, Transaction, type Extension, type TransactionSpec } from '@codemirror/state';
import { codeSpan, inlineCodeAt } from './formatCommands';
import { nodeDecorators } from './extensionPoints';

/*
 * Inline code. A space of padding on both sides is hidden, as CommonMark
 * reads it. A backtick typed inside a span stays a literal backtick: the
 * span's delimiters grow past the longest run inside, so the span stays
 * whole instead of closing early.
 */

/** Hides one space of padding on both sides of inline code, as CommonMark drops it. */
const padding = nodeDecorators.of({
  nodes: ['InlineCode'],
  decorate(ctx, node) {
    const marks = node.getChildren('CodeMark');
    if (marks.length < 2 || ctx.reveal.span(node.from, node.to)) return false;
    const from = marks[0].to;
    const to = marks[marks.length - 1].from;
    const text = ctx.state.sliceDoc(from, to);
    if (text.length >= 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '' && !text.includes('\n')) {
      ctx.hide(from, from + 1);
      ctx.hide(to - 1, to, true);
    }
    return false;
  },
});

/** A backtick typed inside inline code: the span written again with longer delimiters, the caret after the backtick. */
export function literalBacktick(tr: Transaction): TransactionSpec | null {
  if (!tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose') || tr.startState.selection.ranges.length > 1) return null;
  const edits: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => edits.push({ from: fromA, to: toA, insert: inserted.toString() }));
  if (edits.length !== 1 || edits[0].from !== edits[0].to || !/^`+$/.test(edits[0].insert)) return null;
  const { from, insert } = edits[0];
  const state = tr.startState;
  const span = inlineCodeAt(state, from);
  if (!span || from < span.textFrom || from > span.textTo) return null;
  const raw = state.sliceDoc(span.textFrom, span.textTo);
  const offset = from - span.textFrom;
  const padded = raw.length >= 2 && raw.startsWith(' ') && raw.endsWith(' ') && raw.trim() !== '';
  const content = padded ? raw.slice(1, -1) : raw;
  const at = padded ? offset - 1 : offset;
  const next = content.slice(0, at) + insert + content.slice(at);
  const written = codeSpan(next);
  const start = written.indexOf(next);
  return {
    changes: { from: span.from, to: span.to, insert: written },
    selection: { anchor: span.from + start + at + insert.length },
    scrollIntoView: true,
    userEvent: 'input.type',
  };
}

/** Inline code in every page: the hidden padding. */
export const inlineCode: Extension = padding;

/** Inline code in a document, where its delimiters never show: a typed backtick stays literal. */
// Filters run lowest precedence first, so this runs before doc mode places the caret.
export const inlineCodeDoc: Extension = Prec.low(EditorState.transactionFilter.of((tr) => literalBacktick(tr) ?? tr));
