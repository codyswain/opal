import { syntaxTree } from '@codemirror/language';
import { EditorState, type ChangeSpec, type Extension, type Text, type Transaction, type TransactionSpec } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { styleTags, tags } from '@lezer/highlight';
import { Line as BlockLine, type BlockContext, type Element, type InlineContext, type MarkdownConfig } from '@lezer/markdown';

/*
 * Math in Markdown, as Pandoc and Obsidian read it.
 *
 * Inline: `$…$` by Pandoc's rule (the opening `$` has no space after it, the
 * closing one no space before it and no digit after it), plus a money
 * guard: a span that starts with a digit, holds a space and has none of
 * `\ ^ _ { } =` is text, so "$5 and $10" never renders. `$$…$$` inside a
 * line is display math. `\(…\)` is inline math. Nothing inline crosses a
 * line break, `\$` is never a delimiter, and code or autolinks that start
 * first win. Everything between the delimiters is TeX: no Markdown inside.
 *
 * Blocks: a line that starts with `$$`, or holds only `\[`, opens a block
 * when its closer (a line ending in `$$`, or holding only `\]`) comes before
 * the next blank line or the end of its container. Otherwise a closer typed
 * far below would pair with an opener the parser had already read as text.
 * The same test ends a paragraph above a block (`endLeaf`), so `text`, `$$`,
 * `E = mc^2`, `$$`, `more` holds one display formula.
 */

/** The math nodes, inline and block. */
export const MATH_NODES: ReadonlySet<string> = new Set(['InlineMath', 'DisplayMath', 'BlockMath']);

const DOLLAR = 36;
const BACKSLASH = 92;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const NEWLINE = 10;

const isSpace = (ch: number) => ch === 32 || ch === 9 || ch === NEWLINE || ch === 13 || ch < 0;
const isDigit = (ch: number) => ch >= 48 && ch <= 57;

/** Pandoc's dollars catch prices; a span like "5 and 10" is money, not TeX. */
export function looksLikeMoney(tex: string): boolean {
  return /^\d/.test(tex) && /\s/.test(tex) && !/[\\^_{}=]/.test(tex);
}

/** Where `\)`, `$` or `$$` closes the span opened before `from`, on the same line, or -1. */
function closerAt(cx: InlineContext, from: number, closer: 'paren' | 'single' | 'double'): number {
  for (let at = from; at < cx.end; at += 1) {
    const ch = cx.char(at);
    if (ch === NEWLINE) return -1;
    if (ch === BACKSLASH) {
      if (closer === 'paren' && cx.char(at + 1) === CLOSE_PAREN) return at;
      at += 1;
      continue;
    }
    if (ch !== DOLLAR || closer === 'paren') continue;
    if (closer === 'double') {
      if (cx.char(at + 1) === DOLLAR) return at;
      continue;
    }
    // "$$" inside a single-dollar span is two characters of TeX, never a closer.
    if (cx.char(at + 1) === DOLLAR) {
      at += 1;
      continue;
    }
    if (!isSpace(cx.char(at - 1)) && !isDigit(cx.char(at + 1))) return at;
  }
  return -1;
}

function inlineElement(cx: InlineContext, type: string, from: number, textFrom: number, textTo: number, to: number): number {
  return cx.addElement(cx.elt(type, from, to, [
    cx.elt('MathMark', from, textFrom),
    cx.elt('MathText', textFrom, textTo),
    cx.elt('MathMark', textTo, to),
  ]));
}

function parseInlineMath(cx: InlineContext, next: number, start: number): number {
  if (next === BACKSLASH) {
    if (cx.char(start + 1) !== OPEN_PAREN) return -1;
    const close = closerAt(cx, start + 2, 'paren');
    if (close < 0 || !cx.slice(start + 2, close).trim()) return -1;
    return inlineElement(cx, 'InlineMath', start, start + 2, close, close + 2);
  }
  if (next !== DOLLAR) return -1;
  if (cx.char(start + 1) === DOLLAR) {
    const close = closerAt(cx, start + 2, 'double');
    if (close < 0 || !cx.slice(start + 2, close).trim()) return -1;
    return inlineElement(cx, 'DisplayMath', start, start + 2, close, close + 2);
  }
  if (isSpace(cx.char(start + 1))) return -1;
  const close = closerAt(cx, start + 1, 'single');
  if (close < 0 || looksLikeMoney(cx.slice(start + 1, close))) return -1;
  return inlineElement(cx, 'InlineMath', start, start + 1, close, close + 1);
}

/** The index of the first `$$` in `text` from `from` that no backslash escapes, or -1. */
function doubleDollar(text: string, from: number): number {
  for (let at = from; at < text.length - 1; at += 1) {
    if (text.charCodeAt(at) === BACKSLASH) at += 1;
    else if (text.charCodeAt(at) === DOLLAR && text.charCodeAt(at + 1) === DOLLAR) return at;
  }
  return -1;
}

type Opener = 'dollar' | 'bracket';

/**
 * What the line's text from `pos` opens: a `$$` block, a `\[` block, or
 * nothing. "$$x$$" closed on its own line stays in its paragraph as display
 * math, so the lines after it keep their reading.
 */
function openerOf(text: string, pos: number): Opener | null {
  if (text.startsWith('$$', pos)) return doubleDollar(text, pos + 2) < 0 ? 'dollar' : null;
  return text.slice(pos).trimEnd() === '\\[' ? 'bracket' : null;
}

/** Whether the character at `at` follows an odd number of backslashes. */
function escaped(text: string, at: number): boolean {
  let count = 0;
  for (let back = at - 1; back >= 0 && text.charCodeAt(back) === BACKSLASH; back -= 1) count += 1;
  return count % 2 === 1;
}

/** Where a line's closer starts, or -1: the `$$` that ends it, or `\]` alone. */
function closerOf(kind: Opener, text: string, pos: number): number {
  const content = text.trimEnd();
  if (kind === 'bracket') return content.slice(pos) === '\\]' ? pos : -1;
  const close = content.length - 2;
  return close >= pos && content.endsWith('$$') && !escaped(content, close) ? close : -1;
}

interface ContextInternals {
  ranges: readonly { from: number; to: number }[];
  to: number;
  absoluteLineEnd: number;
  stack: { type: number; end: number }[];
  lineChunkAt: (pos: number) => string;
  parser: { skipContextMarkup: Record<number, (block: unknown, cx: BlockContext, line: BlockLine) => boolean> };
}

interface LineInternals {
  depth: number;
  reset: (text: string) => void;
  forward: () => void;
}

const LOOKAHEAD_LINES = 5_000;

/**
 * Whether a closer of `kind` comes after the current line before a blank
 * line or the end of the line's containers. It reads the lines ahead
 * through the containers' own markup rules without moving the parser.
 */
function closerAhead(cx: BlockContext, kind: Opener): boolean {
  const inner = cx as unknown as ContextInternals;
  if (inner.ranges.length !== 1) return false;
  const scratch = new BlockLine();
  const line = scratch as unknown as LineInternals;
  const ends = inner.stack.map((block) => block.end);
  try {
    let start = inner.absoluteLineEnd + 1;
    for (let count = 0; start <= inner.to && count < LOOKAHEAD_LINES; count += 1) {
      const text = inner.lineChunkAt(start);
      line.reset(text);
      for (; line.depth < inner.stack.length; line.depth += 1) {
        const block = inner.stack[line.depth];
        const skip = inner.parser.skipContextMarkup[block.type];
        if (!skip || !skip(block, cx, scratch)) {
          line.forward();
          break;
        }
        line.forward();
      }
      if (line.depth < inner.stack.length || scratch.pos === text.length) return false;
      if (closerOf(kind, text, scratch.pos) >= 0) return true;
      start += text.length + 1;
    }
    return false;
  } finally {
    // The markup rules record a quote's end as they read; reading ahead must leave no trace.
    inner.stack.forEach((block, index) => { block.end = ends[index]; });
  }
}

/** The block the current line opens, when its closer is near enough. */
function blockOpening(cx: BlockContext, line: BlockLine): Opener | null {
  if (line.indent - line.baseIndent >= 4) return null;
  const opener = openerOf(line.text, line.pos);
  return opener && closerAhead(cx, opener) ? opener : null;
}

/**
 * Whether the line ends the paragraph above it by opening a block. A lazy
 * line, one outside the paragraph's quote or list item, never does: it stays
 * the paragraph's text, as it was without math.
 */
function endsParagraph(cx: BlockContext, line: BlockLine): boolean {
  return (line as unknown as LineInternals).depth >= cx.depth && blockOpening(cx, line) !== null;
}

function parseBlockMath(cx: BlockContext, line: BlockLine): boolean {
  const opener = blockOpening(cx, line);
  if (!opener) return false;
  const from = cx.lineStart + line.pos;
  const openLength = 2;
  const children: Element[] = [cx.elt('MathMark', from, from + openLength)];
  const text = (textFrom: number, textTo: number) => {
    if (textTo > textFrom) children.push(cx.elt('MathText', textFrom, textTo));
  };
  if (opener === 'dollar') text(cx.lineStart + line.skipSpace(line.pos + 2), cx.lineStart + line.text.trimEnd().length);
  let end = cx.lineStart + line.text.length;
  while (cx.nextLine() && (line as unknown as LineInternals).depth >= cx.depth) {
    children.push(...line.markers);
    const close = closerOf(opener, line.text, line.pos);
    end = cx.lineStart + line.text.length;
    if (close >= 0) {
      text(cx.lineStart + line.basePos, cx.lineStart + line.text.slice(0, close).trimEnd().length);
      children.push(cx.elt('MathMark', cx.lineStart + close, cx.lineStart + close + 2));
      cx.nextLine();
      break;
    }
    text(cx.lineStart + line.basePos, cx.lineStart + line.text.trimEnd().length);
  }
  children.sort((a, b) => a.from - b.from);
  cx.addElement(cx.elt('BlockMath', from, end, children));
  return true;
}

/** The Lezer extension: math nodes, their inline parser before Escape and emphasis, and the block parser before quotes and lists. */
export const mathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'BlockMath', block: true },
    { name: 'InlineMath' },
    { name: 'DisplayMath' },
    { name: 'MathMark' },
    { name: 'MathText' },
  ],
  parseInline: [{ name: 'Math', parse: parseInlineMath, before: 'Escape' }],
  parseBlock: [{
    name: 'BlockMath',
    before: 'Blockquote',
    parse: parseBlockMath,
    endLeaf: endsParagraph,
  }],
  props: [styleTags({ MathMark: tags.processingInstruction, MathText: tags.special(tags.content) })],
};

/** A formula on the page: where its marks and TeX are, and the TeX as KaTeX reads it. */
export interface MathSpan {
  node: string;
  from: number;
  to: number;
  /** Display math: a block, or `$$…$$` in a line. */
  display: boolean;
  /** Between the opening and the closing marks. */
  texFrom: number;
  texTo: number;
  /** The TeX, without a block's quote marks. */
  tex: string;
  /** False for a block whose closing mark went missing. */
  closed: boolean;
}

/** The formula `node` is. */
export function mathSpan(doc: Text, node: SyntaxNode): MathSpan {
  const marks = node.getChildren('MathMark');
  const open = marks[0];
  const close = marks.length > 1 ? marks[marks.length - 1] : null;
  const texFrom = open ? open.to : node.from;
  const texTo = close ? close.from : node.to;
  let tex: string;
  if (node.name === 'BlockMath') {
    tex = node.getChildren('MathText').map((part) => doc.sliceString(part.from, part.to)).join('\n');
  } else {
    tex = doc.sliceString(texFrom, texTo);
  }
  return { node: node.name, from: node.from, to: node.to, display: node.name !== 'InlineMath', texFrom, texTo, tex, closed: close !== null };
}

/** The math node that holds `at` (or starts or ends there), if any. */
export function mathNodeAt(tree: Tree, at: number, side: -1 | 0 | 1 = 0): SyntaxNode | null {
  const sides: (-1 | 1)[] = side === 0 ? [1, -1] : [side];
  for (const s of sides) {
    for (let node: SyntaxNode | null = tree.resolveInner(at, s); node; node = node.parent) {
      if (MATH_NODES.has(node.name)) return node;
    }
  }
  return null;
}

/** The formulas that touch `from` to `to`, in order. */
export function mathNodes(tree: Tree, from: number, to: number): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  tree.iterate({
    from,
    to,
    enter: (ref) => {
      if (MATH_NODES.has(ref.name)) {
        found.push(ref.node);
        return false;
      }
      return undefined;
    },
  });
  return found;
}

// A line's start, past quote marks, a list marker and spaces, then a block opener.
const OPENER_LINE = /^([ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?[ \t]*)(?:\$\$|\\\[[ \t]*$)/;
const BLANK = /^[ \t>]*$/;
const RUN_LINES = 2_000;

/**
 * A change can make a `$$` or `\[` line above it a block's opener, by adding
 * its closer or taking out a blank line between them. The parser reuses the
 * blocks above a change, so that opener would keep its old reading until the
 * page reopens. This adds an edit that writes the opener's two characters
 * back as they were, so the parser reads again from there. No byte changes.
 */
function reparseOpeners(tr: Transaction): Transaction | readonly [Transaction, TransactionSpec] {
  if (!tr.docChanged) return tr;
  const doc = tr.newDoc;
  const before = syntaxTree(tr.startState);
  const changed: { from: number; to: number }[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => { changed.push({ from: fromB, to: toB }); });
  const touched = new Map<number, ChangeSpec>();
  const seen = new Set<number>();
  for (const range of changed) {
    let line = doc.lineAt(range.to);
    for (let count = 0; count < RUN_LINES && !seen.has(line.number); count += 1) {
      seen.add(line.number);
      if (BLANK.test(line.text) && line.to < range.from) break;
      const opener = OPENER_LINE.exec(line.text);
      const start = opener ? line.from + opener[1].length : -1;
      // An opener the change wrote, or one already read as a block, is read again anyway.
      if (opener && openerOf(line.text, start - line.from) && !changed.some((other) => other.from <= start + 2 && other.to >= start)) {
        const reading = mathNodeAt(before, tr.changes.invertedDesc.mapPos(start, 1), 1);
        if (!reading || reading.name !== 'BlockMath') touched.set(start, { from: start, to: start + 2, insert: doc.sliceString(start, start + 2) });
      }
      if (line.number === 1) break;
      line = doc.line(line.number - 1);
    }
  }
  if (touched.size === 0) return tr;
  return [tr, { changes: [...touched.values()], sequential: true }];
}

/** Keeps block math read as a fresh parse would read it when a change pairs an opener with a closer below it. */
export const mathReparse: Extension = EditorState.transactionFilter.of((tr) => reparseOpeners(tr));
