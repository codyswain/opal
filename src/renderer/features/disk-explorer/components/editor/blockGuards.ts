import type { EditorState, Line } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { latestTree, protectedRanges, type TextRange } from './extensionPoints';

/*
 * Blocks the formatting commands never write inside: tables, code, rules,
 * HTML, comments and link definitions keep their bytes when a selection
 * covers them, so Select all and Bold changes only the paragraphs. A
 * callout's "[!type]" marker is skipped the same way: text formatting starts
 * after it, and lists and headings leave a callout's title line alone.
 */

const GUARDED = new Set(['Table', 'FencedCode', 'CodeBlock', 'HorizontalRule', 'HTMLBlock', 'CommentBlock', 'LinkReference']);

// Blocks that hold only inline content, which the walk never needs to enter.
const INLINE = new Set([
  'Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'SetextHeading1', 'SetextHeading2',
]);

/** The lines of each guarded block that touches `from` to `to`, whole. */
export function guardedBlocks(state: EditorState, from: number, to: number): TextRange[] {
  const { doc } = state;
  const ranges: TextRange[] = [];
  latestTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      if (GUARDED.has(ref.name)) {
        // A block that ends at a line break ends on the line before it.
        const end = ref.to > ref.from && doc.lineAt(ref.to).from === ref.to ? ref.to - 1 : ref.to;
        ranges.push({ from: doc.lineAt(ref.from).from, to: doc.lineAt(end).to });
        return false;
      }
      return !INLINE.has(ref.name);
    },
  });
  return ranges;
}

const QUOTE = /^(?:[ \t]*>[ \t]?)+/;
const MARKER = /^\[![\w-]+\][+-]?[ \t]*/;

/**
 * The "[!type]" marker on a callout's first line, with its fold sign and the
 * spaces after it, or null for any other line.
 */
export function calloutMarker(state: EditorState, line: Line): TextRange | null {
  const quote = QUOTE.exec(line.text);
  const match = quote && MARKER.exec(line.text.slice(quote[0].length));
  if (!quote || !match) return null;
  // Only the first line of the outermost quote opens a callout.
  let outer: SyntaxNode | null = null;
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(line.from + quote[0].length, 1); node; node = node.parent) {
    if (node.name === 'Blockquote') outer = node;
  }
  if (!outer || state.doc.lineAt(outer.from).number !== line.number) return null;
  const from = line.from + quote[0].length;
  return { from, to: from + match[0].length };
}

/** Guards for every page: formatting keeps out of these blocks. */
export const blockGuards = protectedRanges.of(guardedBlocks);
