import { describe, expect, it } from 'vitest';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { mathNodes, mathReparse, mathSpan, mathSyntax } from '@/renderer/features/disk-explorer/components/editor/math';
import { wikiLinkSyntax } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';

const extensions = [markdown({ extensions: [GFM, wikiLinkSyntax, mathSyntax] }), mathReparse];

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions });
}

function treeOf(state: EditorState) {
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000);
  if (!tree) throw new Error('no tree');
  return tree;
}

/** The math in `doc` as "Node:source" strings. */
function formulas(doc: string): string[] {
  const state = stateOf(doc);
  return mathNodes(treeOf(state), 0, doc.length).map((node) => `${node.name}:${doc.slice(node.from, node.to)}`);
}

/** Every node in `doc` as "Name from-to", for comparing two parses. */
function shape(state: EditorState): string {
  const parts: string[] = [];
  treeOf(state).iterate({ enter: (ref) => { parts.push(`${ref.name} ${ref.from}-${ref.to}`); } });
  return parts.join('\n');
}

function names(doc: string): string[] {
  const parts: string[] = [];
  treeOf(stateOf(doc)).iterate({ enter: (ref) => { parts.push(ref.name); } });
  return parts;
}

describe('math parsing', () => {
  it.each([
    ['$a*b*c$', ['InlineMath:$a*b*c$']],
    ["$Q^*(s,a) … Q^*(s',a')$", ["InlineMath:$Q^*(s,a) … Q^*(s',a')$"]],
    ['$f[x](y)$', ['InlineMath:$f[x](y)$']],
    ['$\\{x\\} a\\,b$', ['InlineMath:$\\{x\\} a\\,b$']],
    ['$[[Note]]$', ['InlineMath:$[[Note]]$']],
    ['$E=mc^2$', ['InlineMath:$E=mc^2$']],
    ['$$\\frac{dz}{dx}$$', ['DisplayMath:$$\\frac{dz}{dx}$$']],
    ['$\\frac{1}{$', ['InlineMath:$\\frac{1}{$']],
    ['$x^$', ['InlineMath:$x^$']],
    ['$\\foo$', ['InlineMath:$\\foo$']],
    ['$5,$', ['InlineMath:$5,$']],
    ['$5,$6', []],
    ['$5M-$10M', []],
    ['Raise $5M at $25M post', []],
    ['I can pay 20$ after $500', []],
    ['costs $5 and $10', []],
    ['$5 and $x$', ['InlineMath:$x$']],
    ['\\$x\\$ and \\$5', []],
    ['$a\\$b$', ['InlineMath:$a\\$b$']],
    ['\\(g=9.8\\)', ['InlineMath:\\(g=9.8\\)']],
    ['\\[P0\\] is a priority', []],
    ['the $$H_2$$ and $$O_2$$ gas', ['DisplayMath:$$H_2$$', 'DisplayMath:$$O_2$$']],
    ['a $x\ny$ b', []],
    ['`$x$` and $y$', ['InlineMath:$y$']],
    ['<https://example.com/$a$>', []],
    ['## Energy $E=mc^2$', ['InlineMath:$E=mc^2$']],
    ['[$O(n)$](https://example.com)', ['InlineMath:$O(n)$']],
    ['| a | b |\n|---|---|\n| $x^2$ | $5M |', ['InlineMath:$x^2$']],
    ['\\[\nx = 1\n\\]', ['BlockMath:\\[\nx = 1\n\\]']],
    ['$$\nx\n\n$$', []],
    ['$$\n+ a\n= b\n> c\n$$', ['BlockMath:$$\n+ a\n= b\n> c\n$$']],
  ])('%j', (doc, expected) => {
    expect(formulas(doc)).toEqual(expected);
  });

  it('keeps Markdown out of a formula', () => {
    expect(names('$a*b*c$')).not.toContain('Emphasis');
    expect(names('$[[Note]]$')).not.toContain('WikiLink');
    expect(names('$f[x](y)$')).not.toContain('Link');
    expect(names('$\\{x\\}$')).not.toContain('Escape');
  });

  it('reads a $$ block whose lines start with list, heading or quote marks as math', () => {
    const found = names('$$\n+ a\n= b\n> c\n# d\n$$');
    for (const name of ['BulletList', 'SetextHeading1', 'Blockquote', 'ATXHeading1']) expect(found).not.toContain(name);
  });

  it('splits a paragraph around a display block', () => {
    const doc = 'text\n$$\nE = mc^2\n$$\nmore';
    const state = stateOf(doc);
    const blocks: string[] = [];
    treeOf(state).iterate({ enter: (ref) => {
      if (ref.name === 'Document') return undefined;
      blocks.push(`${ref.name}:${doc.slice(ref.from, ref.to)}`);
      return false;
    } });
    expect(blocks).toEqual(['Paragraph:text', 'BlockMath:$$\nE = mc^2\n$$', 'Paragraph:more']);
  });

  it('keeps a one-line $$ formula and the lazy lines after it in their paragraph', () => {
    expect(formulas('text\n$$x$$\nmore')).toEqual(['DisplayMath:$$x$$']);
    expect(names('* $$ y = w x + b $$\nStep 3\n* next').filter((name) => name === 'BulletList')).toHaveLength(1);
    expect(names('* item\n$$\nx\n$$\nmore').filter((name) => name === 'BlockMath')).toHaveLength(0);
  });

  it('reads blocks in quotes and list items', () => {
    expect(formulas('> $$\n> x^2\n> $$')).toEqual(['BlockMath:$$\n> x^2\n> $$']);
    expect(formulas('- item\n\n  $$\n  x^2\n  $$')).toEqual(['BlockMath:$$\n  x^2\n  $$']);
    // The quote ends before the closer, so there is no block.
    expect(formulas('> $$\n> x^2\n\n$$')).toEqual([]);
  });

  it('gives the TeX without a quote\'s marks', () => {
    const doc = '> $$\n> a\n> b\n> $$';
    const state = stateOf(doc);
    const [node] = mathNodes(treeOf(state), 0, doc.length);
    expect(mathSpan(state.doc, node).tex).toBe('a\nb');
    const inline = mathNodes(treeOf(stateOf('x $a+b$ y')), 0, 9)[0];
    expect(mathSpan(stateOf('x $a+b$ y').doc, inline)).toMatchObject({ tex: 'a+b', display: false, texFrom: 3, texTo: 6, closed: true });
  });

  it.each([1, 10, 400])('reads a closer typed %i lines below an opener as a fresh parse does', (gap) => {
    const lines = ['Intro', '$$', 'x = 1', ...Array.from({ length: gap - 1 }, (_, index) => `line ${index}`)];
    let state = stateOf(`${lines.join('\n')}\n`);
    treeOf(state);
    state = state.update({ changes: { from: state.doc.length, insert: '$$' } }).state;
    const incremental = shape(state);
    expect(incremental).toBe(shape(stateOf(state.doc.toString())));
    expect(incremental).toContain('BlockMath');
  });

  it('reads a closer typed below list, quote and heading lines as a fresh parse does', () => {
    // Enough blocks above that the parser reuses them after the change.
    const above = Array.from({ length: 200 }, (_, index) => `para ${index}\n\n`).join('');
    const view = new EditorView({ parent: document.body, state: stateOf(`${above}$$\n+ a\n> b\n# c\nplain\n`) });
    treeOf(view.state);
    view.dispatch({});
    for (const typed of '$$') {
      const at = view.state.doc.length;
      view.dispatch({ changes: { from: at, insert: typed }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
      treeOf(view.state);
    }
    expect(shape(view.state)).toBe(shape(stateOf(view.state.doc.toString())));
    expect(shape(view.state)).toContain('BlockMath');
    expect(view.state.doc.toString()).toBe(`${above}$$\n+ a\n> b\n# c\nplain\n$$`);
    view.destroy();
  });

  it('never pairs a closer after a blank line', () => {
    let state = stateOf('$$\nx = 1\n\n');
    treeOf(state);
    state = state.update({ changes: { from: state.doc.length, insert: '$$' } }).state;
    expect(shape(state)).not.toContain('BlockMath');
    expect(shape(state)).toBe(shape(stateOf(state.doc.toString())));
  });

  it('reads a block again when a blank line between opener and closer goes', () => {
    let state = stateOf('$$\n+ x\n\n$$\n');
    treeOf(state);
    const blank = state.doc.toString().indexOf('\n\n');
    state = state.update({ changes: { from: blank, to: blank + 1 } }).state;
    expect(shape(state)).toBe(shape(stateOf(state.doc.toString())));
    expect(shape(state)).toContain('BlockMath');
  });
});
