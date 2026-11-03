import { syntaxTree } from '@codemirror/language';
import { EditorState, Prec, StateField, Transaction, type Extension, type Range, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { codeSpan, inlineCodeAt } from './formatCommands';
import { nodeDecorators } from './extensionPoints';

/*
 * Inline code. A space of padding on both sides is hidden, as CommonMark
 * reads it. A backtick typed inside a span stays a literal backtick: the
 * span's delimiters grow past the longest run inside, so the span stays
 * whole instead of closing early. In a document a span that runs over line
 * breaks shows on one line, its line breaks as spaces, as CommonMark reads
 * them.
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
  // The delimiter and its padding come before the text; indexOf would find a text of backticks inside the delimiter.
  const start = (written.length - next.length) / 2;
  return {
    changes: { from: span.from, to: span.to, insert: written },
    selection: { anchor: span.from + start + at + insert.length },
    scrollIntoView: true,
    userEvent: 'input.type',
  };
}

/** A line break inside inline code, shown as the space CommonMark reads it as. */
class SpaceWidget extends WidgetType {
  eq() { return true; }

  toDOM() {
    const space = document.createElement('span');
    space.className = 'cm-code-join';
    space.textContent = ' ';
    return space;
  }
}

const space = Decoration.replace({ widget: new SpaceWidget() });

/** The line breaks, with the next line's leading spaces, inside the inline code of paragraphs between `from` and `to`. */
function lineBreaks(state: EditorState, from: number, to: number): Range<Decoration>[] {
  const found: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      if (ref.name === 'Paragraph') {
        const text = state.sliceDoc(ref.from, ref.to);
        return text.includes('`') && text.includes('\n') ? undefined : false;
      }
      if (ref.name !== 'InlineCode') return undefined;
      const text = state.sliceDoc(ref.from, ref.to);
      for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
        const start = ref.from + at;
        let end = start + 1;
        while (end < ref.to && /[ \t>]/.test(state.sliceDoc(end, end + 1))) end += 1;
        found.push(space.range(start, end));
      }
      return false;
    },
  });
  return found;
}

/** A document's inline code over line breaks, on one line. Line breaks can only be replaced from a state field. */
const joinedCode = StateField.define<DecorationSet>({
  create: (state) => Decoration.set(lineBreaks(state, 0, state.doc.length), true),
  update(value, tr) {
    if (tr.docChanged) {
      let next = value.map(tr.changes);
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        // The paragraph around a change, as far as a blank line either side.
        const { doc } = tr.state;
        let first = doc.lineAt(fromB).number;
        let last = doc.lineAt(toB).number;
        while (first > 1 && doc.line(first - 1).text.trim()) first -= 1;
        while (last < doc.lines && doc.line(last + 1).text.trim()) last += 1;
        const from = doc.line(first).from;
        const to = doc.line(last).to;
        next = next.update({ filterFrom: from, filterTo: to, filter: () => false, add: lineBreaks(tr.state, from, to), sort: true });
      });
      return next;
    }
    return syntaxTree(tr.startState) !== syntaxTree(tr.state) ? Decoration.set(lineBreaks(tr.state, 0, tr.state.doc.length), true) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Inline code in every page: the hidden padding. */
export const inlineCode: Extension = padding;

/** Inline code in a document, where its delimiters never show: a typed backtick stays literal, and a span over line breaks shows on one line. */
// Filters run lowest precedence first, so this runs before doc mode places the caret.
export const inlineCodeDoc: Extension = [joinedCode, Prec.low(EditorState.transactionFilter.of((tr) => literalBacktick(tr) ?? tr))];
