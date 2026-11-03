import { renderToString } from 'katex';
import { syntaxTree } from '@codemirror/language';
import { getSearchQuery, SearchQuery, searchPanelOpen } from '@codemirror/search';
import { StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { blockRenderers, latestTree, nodeDecorators, protectedRanges, type BlockLayout, type TextRange } from './extensionPoints';
import { cellMath } from './previewWidgets';
import { docMode } from './livePreview';
import { mathNodes, mathReparse, mathSpan, type MathSpan } from './math';
import { insertEquationItem, mathEditing, mathEditor } from './mathWrite';
import './katex.css';
import './math.css';

/*
 * Formulas drawn with KaTeX, black and white. TeX that KaTeX can't read
 * shows as its source, muted, with KaTeX's message on hover. KaTeX's trust
 * list allows only links to web and mail addresses; sizes cap at 50em, and
 * colour commands draw in the text colour. Shims let Obsidian-era notes
 * render (`\label`, `\eqref`, `multline`, `\newcommand` over a built-in,
 * `align` inside `$…$`); they change what KaTeX reads, never the file.
 */

/** What KaTeX drew, or why it could not. */
export interface Rendered {
  html: string;
  error: string | null;
  /** Where in the TeX KaTeX stopped reading, when it says. */
  errorAt: number | null;
  /** KaTeX drew nothing, as for a formula that only defines macros. */
  empty: boolean;
}

/** Macros the page defines, with `\gdef` or `\newcommand`, and a key that changes when they do. */
export interface PageMacros {
  key: string;
  /** As KaTeX stores them: a definition's tokens, or a string. */
  macros: Readonly<Record<string, unknown>>;
}

export const NO_MACROS: PageMacros = { key: '', macros: {} };

// Colour commands keep their argument and lose the colour, so a formula reads the same in Opal and Obsidian. A colour box keeps its box, drawn as a grey edge.
const SHIMS: Record<string, string> = {
  '\\color': '\\@secondoftwo{#1}{}',
  '\\textcolor': '\\@secondoftwo{#1}{{#2}}',
  '\\colorbox': '\\@secondoftwo{#1}{\\fbox{#2}}',
  '\\fcolorbox': '\\@secondoftwo{#1#2}{\\fbox{#3}}',
  '\\label': '\\@secondoftwo{#1}{}',
  '\\require': '\\@secondoftwo{#1}{}',
  '\\eqref': '\\text{(#1)}',
  '\\ref': '\\text{#1}',
};

const TRUSTED = new Set(['\\href', '\\url']);
const SAFE_PROTOCOLS = new Set(['http', 'https', 'mailto']);
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const MHCHEM = /\\(?:ce|pu)\b/;

/** KaTeX's own parse errors give the TeX again after "at position"; the message is enough. */
function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^KaTeX parse error: /, '').replace(/ at (?:position \d+|end of input):[\s\S]*$/, '').trim();
}

let mhchem: 'absent' | 'loading' | 'loaded' = 'absent';
const mhchemWaiters = new Set<() => void>();

/** Loads mhchem, which adds `\ce` and `\pu` to KaTeX, the first time a formula uses them. */
export function loadMhchem(): Promise<void> {
  if (mhchem === 'loaded') return Promise.resolve();
  const done = new Promise<void>((resolve) => { mhchemWaiters.add(resolve); });
  if (mhchem === 'absent') {
    mhchem = 'loading';
    // @ts-expect-error -- the package types its subpaths through "exports", which this project's Node resolution does not read.
    void import('katex/contrib/mhchem').then(() => {
      mhchem = 'loaded';
      cache.clear();
    }, () => {
      mhchem = 'absent';
    }).finally(() => {
      for (const resolve of mhchemWaiters) resolve();
      mhchemWaiters.clear();
    });
  }
  return done;
}

/** Whether `tex` waits on mhchem, which loads on its own. */
export function needsMhchem(tex: string): boolean {
  return mhchem !== 'loaded' && MHCHEM.test(tex);
}

/** The rewrites KaTeX needs to read TeX written for MathJax or LaTeX. */
function rewrite(tex: string, display: boolean): string {
  let next = tex.replace(ZERO_WIDTH, '').replace(/\\(begin|end)\{multline\*?\}/g, '\\$1{gathered}');
  // Inline, display-only environments become their inline forms.
  if (!display) next = next.replace(/\\(begin|end)\{(align|alignat|flalign)\*?\}/g, '\\$1{aligned}').replace(/\\(begin|end)\{(equation|gather)\*?\}/g, '\\$1{gathered}');
  return next;
}

function renderOnce(tex: string, display: boolean, macros: Record<string, unknown>): string {
  const refused: string[] = [];
  const html = renderToString(tex, {
    displayMode: display,
    throwOnError: true,
    strict: 'ignore',
    maxSize: 50,
    output: 'htmlAndMathml',
    macros: macros as Record<string, string>,
    trust: (context) => {
      const allowed = TRUSTED.has(context.command) && 'protocol' in context && SAFE_PROTOCOLS.has(String(context.protocol));
      if (!allowed) refused.push(context.command);
      return allowed;
    },
  });
  if (refused.length > 0) throw new Error(`Opal doesn't allow ${refused[0]}${refused[0] === '\\href' || refused[0] === '\\url' ? ' to this address' : ''}`);
  return html;
}

/** Renders without the cache. */
export function renderUncached(tex: string, display: boolean, page: PageMacros = NO_MACROS): Rendered {
  let source = rewrite(tex, display);
  for (let tries = 0; tries < 8; tries += 1) {
    try {
      const html = renderOnce(source, display, { ...SHIMS, ...page.macros });
      return { html, error: null, errorAt: null, empty: /<span class="katex-html" aria-hidden="true"><\/span>/.test(html) };
    } catch (error) {
      const text = message(error);
      // "\newcommand{\R}" over KaTeX's own \R: the page's definition wins, as in LaTeX with a package that defines it.
      const redefined = /^\\newcommand\{(\\[A-Za-z@]+)\} attempting to redefine/.exec(text);
      if (redefined && source.includes(`\\newcommand{${redefined[1]}}`)) {
        source = source.split(`\\newcommand{${redefined[1]}}`).join(`\\renewcommand{${redefined[1]}}`);
        continue;
      }
      const position = (error as { position?: unknown }).position;
      return { html: '', error: needsMhchem(tex) ? 'Loading chemistry…' : text, errorAt: typeof position === 'number' ? position : null, empty: false };
    }
  }
  return { html: '', error: 'Too many definitions', errorAt: null, empty: false };
}

const CACHE_SIZE = 4_000;
const cache = new Map<string, Rendered>();

/** KaTeX's drawing of `tex`, cached by display, TeX and the page's macros. */
export function renderTex(tex: string, display: boolean, page: PageMacros = NO_MACROS): Rendered {
  const key = `${display ? 'd' : 'i'}\u0000${page.key}\u0000${tex}`;
  const found = cache.get(key);
  if (found) return found;
  const rendered = renderUncached(tex, display, page);
  if (needsMhchem(tex)) {
    void loadMhchem();
    return rendered;
  }
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(key, rendered);
  return rendered;
}

const DEFINES = /\\(?:gdef|xdef|edef|def|global|newcommand|renewcommand|providecommand|DeclareMathOperator)\b/;

/** The page's macros, built from its defining formulas in document order. */
function buildMacros(doc: Text, tree: ReturnType<typeof syntaxTree>): PageMacros {
  const sources: string[] = [];
  for (const node of mathNodes(tree, 0, doc.length)) {
    const { tex } = mathSpan(doc, node);
    if (DEFINES.test(tex)) sources.push(tex);
  }
  if (sources.length === 0) return NO_MACROS;
  const macros: Record<string, unknown> = { ...SHIMS };
  for (const tex of sources) {
    try {
      renderToString(rewrite(tex, true), { displayMode: true, throwOnError: false, strict: 'ignore', globalGroup: true, maxSize: 50, macros: macros as Record<string, string>, trust: false });
    } catch {
      // A definition that fails defines nothing.
    }
  }
  for (const name of Object.keys(SHIMS)) if (macros[name] === SHIMS[name]) delete macros[name];
  return { key: sources.join('\u0001'), macros };
}

/**
 * The page's macros. They are read from the whole page, so a formula draws
 * the same wherever the page is scrolled. Rebuilt only when a change could
 * add, remove or edit a definition.
 */
export const pageMacros = StateField.define<PageMacros>({
  create: (state) => buildMacros(state.doc, syntaxTree(state)),
  update(value, tr) {
    const treeGrew = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    if (!tr.docChanged && !treeGrew) return value;
    let touches = value !== NO_MACROS;
    if (tr.docChanged) {
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (DEFINES.test(tr.startState.sliceDoc(Math.max(0, fromA - 20), toA + 20)) || DEFINES.test(inserted.toString())) touches = true;
      });
    } else if (value === NO_MACROS) {
      // The parser reached more of the page, which may define macros.
      touches = DEFINES.test(tr.state.sliceDoc(0, Math.min(tr.state.doc.length, 200_000)));
    }
    if (!touches) return value;
    const next = buildMacros(tr.state.doc, syntaxTree(tr.state));
    return next.key === value.key ? value : next;
  },
});

/** What a formula that draws nothing does. */
export function emptyLabel(tex: string): string {
  return DEFINES.test(tex) ? 'Defines macros for this page' : 'Draws nothing';
}

/**
 * Draws `rendered` into `root`: KaTeX's HTML, or the source with the message
 * on hover. A formula that draws nothing, such as a macro definition, shows
 * its source too, so it can be seen, clicked and deleted on purpose.
 */
function fill(root: HTMLElement, rendered: Rendered, source: string, tex: string): void {
  root.classList.toggle('cm-math-error', rendered.error !== null);
  root.classList.toggle('cm-math-empty', rendered.error === null && rendered.empty);
  if (rendered.error !== null) {
    root.textContent = source;
    root.title = rendered.error;
  } else if (rendered.empty) {
    // Its TeX, without the marks, which the page hides everywhere else.
    root.textContent = tex;
    root.title = emptyLabel(source);
  } else {
    root.innerHTML = rendered.html;
    root.removeAttribute('title');
  }
}

/** Redraws a formula once mhchem has loaded. */
function upgradeLater(view: EditorView, root: HTMLElement, tex: string, display: boolean, page: PageMacros, source: string): void {
  if (!needsMhchem(tex)) return;
  void loadMhchem().then(() => {
    if (!root.isConnected) return;
    fill(root, renderTex(tex, display, page), source, tex);
    view.requestMeasure();
  });
}

/** The size watch of each drawn display formula, so a redraw or removal stops it. */
const clipWatch = new WeakMap<HTMLElement, ResizeObserver>();

/** Marks a wide display formula's clipped edges, where a fade shows there is more to scroll to. */
function markClipped(box: HTMLElement): void {
  box.classList.toggle('cm-math-clipped-left', box.scrollLeft > 0);
  box.classList.toggle('cm-math-clipped-right', box.scrollLeft + box.clientWidth < box.scrollWidth - 1);
}

/** Keeps a display formula's clipped edges marked as it scrolls, as the column changes width and as its fonts load. */
function watchClip(owner: HTMLElement, box: HTMLElement): void {
  box.addEventListener('scroll', () => markClipped(box), { passive: true });
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => markClipped(box));
  observer.observe(box);
  if (box.firstElementChild) observer.observe(box.firstElementChild);
  clipWatch.set(owner, observer);
}

function stopClipWatch(owner: HTMLElement): void {
  clipWatch.get(owner)?.disconnect();
  clipWatch.delete(owner);
}

/**
 * Whether an inline formula, drawn as one box, breaks onto a second line.
 * Such a box is as wide as the column, so text after it would sit at the
 * column's edge; it flows with the text instead.
 */
function wraps(root: HTMLElement): boolean {
  const parts = root.querySelectorAll(':scope > .katex > .katex-html > .katex-base');
  if (parts.length < 2) return false;
  return parts[parts.length - 1].getBoundingClientRect().top >= parts[0].getBoundingClientRect().bottom - 1;
}

/** When the column's width changes, a formula that now breaks onto a second line flows with the text too. */
const flowOnResize = ViewPlugin.fromClass(class {
  width = -1;

  update(update: ViewUpdate) {
    if (!update.geometryChanged) return;
    update.view.requestMeasure({
      key: this,
      read: (view) => {
        const width = view.contentDOM.clientWidth;
        if (width === this.width) return [];
        this.width = width;
        return [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-math-inline:not(.cm-math-flow)')].filter(wraps);
      },
      write: (wrapped) => { for (const element of wrapped) element.classList.add('cm-math-flow'); },
    });
  }
});

/** A formula in a line: inline, or display math (`$$…$$`) on a centred line of its own. */
export class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean, readonly source: string, readonly page: PageMacros, readonly doc: boolean) { super(); }

  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display && other.source === this.source && other.page.key === this.page.key && other.doc === this.doc;
  }

  toDOM(view: EditorView) {
    const root = document.createElement('span');
    root.className = this.display ? 'cm-math cm-math-display' : 'cm-math cm-math-inline';
    root.setAttribute('role', 'math');
    root.setAttribute('aria-label', this.tex);
    if (this.doc) root.dataset.formula = '';
    fill(root, renderTex(this.tex, this.display, this.page), this.source, this.tex);
    upgradeLater(view, root, this.tex, this.display, this.page, this.source);
    if (this.display) watchClip(root, root);
    else view.requestMeasure({ read: () => wraps(root), write: (wrapped) => { if (wrapped) root.classList.add('cm-math-flow'); } });
    return root;
  }

  destroy(dom: HTMLElement) {
    stopClipWatch(dom);
  }

  ignoreEvent(event: Event) {
    return event.type !== 'mousedown' && event.type !== 'click';
  }
}

/** A display formula over whole lines: a `$$` or `\[` block, centred, scrolling sideways when wide. */
export class MathBlockWidget extends WidgetType {
  constructor(readonly tex: string, readonly source: string, readonly page: PageMacros, readonly layout: BlockLayout, readonly doc: boolean) { super(); }

  eq(other: MathBlockWidget) {
    return other.tex === this.tex && other.source === this.source && other.page.key === this.page.key && other.doc === this.doc
      && other.layout.context === this.layout.context && other.layout.indent === this.layout.indent;
  }

  toDOM(view: EditorView) {
    const frame = document.createElement('div');
    frame.className = 'cm-math-block';
    const { context, indent } = this.layout;
    if (context) frame.classList.add(context === 'quote' ? 'cm-md-in-quote' : 'cm-md-in-callout');
    if (context === 'callout-last') frame.classList.add('cm-md-in-callout-last');
    if (indent) frame.style.setProperty('--list-indent', `${indent}em`);
    const root = document.createElement('div');
    root.className = 'cm-math cm-math-display';
    root.setAttribute('role', 'math');
    root.setAttribute('aria-label', this.tex);
    if (this.doc) root.dataset.formula = '';
    fill(root, renderTex(this.tex, true, this.page), this.source, this.tex);
    upgradeLater(view, root, this.tex, true, this.page, this.source);
    frame.append(root);
    watchClip(frame, root);
    return frame;
  }

  destroy(dom: HTMLElement) {
    stopClipWatch(dom);
  }

  get estimatedHeight() { return Math.max(1, this.tex.split('\n').length) * 24 + 16; }

  ignoreEvent(event: Event) {
    return event.type !== 'mousedown' && event.type !== 'click';
  }
}

const sourceMark = Decoration.mark({ class: 'cm-math-source' });
const sourceLine = Decoration.line({ class: 'cm-math-source-line' });

/** The TeX a formula draws: while its popover is open and its TeX does not render, the last that did, at its size. */
function texOf(state: EditorState, span: MathSpan): string {
  const editor = state.field(mathEditor, false);
  if (!editor || editor.from !== span.from || editor.to !== span.to || editor.lastGood === null || editor.lastGood === span.tex) return span.tex;
  return renderTex(span.tex, span.display, state.field(pageMacros)).error === null ? span.tex : editor.lastGood;
}

/** Punctuation that closes a phrase and never starts a line. `]` is left out: after a formula in link text it is the link's hidden mark. */
const CLOSING = /^[.,;:!?)'"\u2019\u201D]{1,3}/;

/**
 * Holds an inline formula and the punctuation right after it on one line, so
 * ", and so on" never starts a line. Inclusive at its start, so the mark
 * wraps the formula's widget.
 */
const glue = Decoration.mark({ class: 'cm-math-glue', inclusiveStart: true });

const inlineMath = nodeDecorators.of({
  nodes: ['InlineMath', 'DisplayMath'],
  decorate(ctx, node) {
    const span = mathSpan(ctx.state.doc, node);
    if (!ctx.docMode && ctx.reveal.span(node.from, node.to)) {
      ctx.out.push(sourceMark.range(node.from, node.to));
      return true;
    }
    const widget = new MathWidget(texOf(ctx.state, span), span.display, ctx.state.sliceDoc(node.from, node.to), ctx.state.field(pageMacros), ctx.docMode);
    ctx.out.push(Decoration.replace({ widget }).range(node.from, node.to));
    const line = ctx.state.doc.lineAt(node.to);
    const after = ctx.state.sliceDoc(node.to, Math.min(line.to, node.to + 3));
    if (span.display) {
      // Display math in a line sits on a line of its own; the space after it would start the next line one character in.
      if (after.startsWith(' ') && /\S/.test(ctx.state.sliceDoc(node.to, line.to))) ctx.hide(node.to, node.to + 1);
    } else {
      const closing = CLOSING.exec(after);
      if (closing) ctx.out.push(glue.range(node.from, node.to + closing[0].length));
    }
    return true;
  },
});

/** A note shows a block's source while the caret is on its lines, with the formula drawn under them. */
const blockSource = nodeDecorators.of({
  nodes: ['BlockMath'],
  decorate(ctx, node) {
    if (ctx.covered(node.from)) return true;
    const { doc } = ctx.state;
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    for (let number = first; number <= last; number += 1) ctx.out.push(sourceLine.range(doc.line(number).from));
    ctx.out.push(sourceMark.range(node.from, node.to));
    const span = mathSpan(doc, node);
    const preview = new MathWidget(span.tex, true, '', ctx.state.field(pageMacros), false);
    ctx.out.push(Decoration.widget({ widget: preview, side: 1 }).range(doc.line(last).to));
    return true;
  },
});

const blockMath = blockRenderers.of({
  nodes: ['BlockMath'],
  widget(state, node, from, to, layout) {
    const span = mathSpan(state.doc, node);
    if (!span.closed) return null;
    return new MathBlockWidget(texOf(state, span), state.sliceDoc(from, to), state.field(pageMacros), layout, state.facet(docMode));
  },
});

/** Formula ranges, which formatting, typing escapes and Replace never write inside. A block covers its lines whole. */
export function mathRanges(state: EditorState, from: number, to: number): TextRange[] {
  return mathNodes(latestTree(state), from, to).map((node: SyntaxNode) => ({
    from: node.name === 'BlockMath' ? state.doc.lineAt(node.from).from : node.from,
    to: node.to,
  }));
}

const protectedMath = protectedRanges.of(mathRanges);

/**
 * A formula in a table cell, with the page's macros. GFM reads `\|` in a
 * cell as a pipe before anything else, so KaTeX does too; the file keeps it.
 */
const tableMath = cellMath.of((written, display, source, view) => {
  const tex = written.replace(/\\\|/g, '|');
  const root = document.createElement('span');
  root.className = display ? 'cm-math cm-math-display' : 'cm-math cm-math-inline';
  root.setAttribute('role', 'math');
  root.setAttribute('aria-label', tex);
  root.dataset.cell = '';
  if (view.state.facet(docMode)) root.dataset.formula = '';
  const page = view.state.field(pageMacros, false) ?? NO_MACROS;
  fill(root, renderTex(tex, display, page), source, written);
  upgradeLater(view, root, tex, display, page, source);
  return root;
});

/** The formula the popover edits shows as selected: a mark around one drawn in a line. Only an outer mark wraps the widgets of other decorations. */
const editingMark = Decoration.mark({ class: 'cm-math-editing', inclusive: true });

const editingMarks = EditorView.outerDecorations.compute([mathEditor], (state) => {
  const editor = state.field(mathEditor);
  if (!editor || editor.to <= editor.from || editor.kind === 'block' || editor.table) return Decoration.none;
  return Decoration.set(editingMark.range(editor.from, editor.to));
});

/**
 * A mark never reaches a block widget, so a block or a table cell formula
 * being edited gets `data-math-editing` on its own element, as the object
 * frame does. CodeMirror ignores attribute changes on widgets.
 */
const editingWidgets = ViewPlugin.fromClass(class {
  marked: Element[] = [];

  update(update: ViewUpdate) {
    const was = update.startState.field(mathEditor, false);
    const now = update.state.field(mathEditor, false);
    if (was !== now && (was || now)) update.view.requestMeasure({ key: this, read: () => null, write: () => this.apply(update.view) });
  }

  apply(view: EditorView) {
    this.clear();
    const editor = view.state.field(mathEditor, false);
    if (!editor || editor.to <= editor.from || (editor.kind !== 'block' && !editor.table)) return;
    const tree = syntaxTree(view.state);
    const start = view.state.doc.lineAt(editor.from).from;
    for (const child of view.contentDOM.children) {
      if (child.classList.contains('cm-line')) continue;
      let at: number;
      try { at = view.posAtDOM(child); } catch { continue; }
      if (!editor.table) {
        if (at >= start && at <= editor.to) this.mark(child);
        continue;
      }
      // A table cell's formula, by its order among the table's formulas.
      let table: SyntaxNode | null = tree.resolveInner(Math.min(at + 1, view.state.doc.length), 1);
      while (table && table.name !== 'Table') table = table.parent;
      if (!table || editor.from < table.from || editor.to > table.to) continue;
      const index = mathNodes(tree, table.from, table.to).findIndex((node) => node.from === editor.from);
      const drawn = index < 0 ? null : child.querySelectorAll('.cm-math')[index];
      if (drawn) this.mark(drawn);
    }
  }

  mark(element: Element) {
    element.setAttribute('data-math-editing', '');
    this.marked.push(element);
  }

  clear() {
    for (const element of this.marked) element.removeAttribute('data-math-editing');
    this.marked = [];
  }

  destroy() {
    this.clear();
  }
});

const matchMark = Decoration.mark({ class: 'cm-math-match', inclusive: true });

/** The formulas in view whose TeX holds a match for the open Find bar's query: marks for those in a line, and the blocks' lines. */
function formulasMatching(view: EditorView): { marks: DecorationSet; blocks: TextRange[] } {
  const none = { marks: Decoration.none, blocks: [] as TextRange[] };
  const { state } = view;
  if (!state.facet(docMode) || !searchPanelOpen(state)) return none;
  const query = getSearchQuery(state);
  if (!query.valid) return none;
  // The TeX as written: Find's own query reads the page's visible text, where a formula is one character.
  const raw = new SearchQuery({ search: query.search, caseSensitive: query.caseSensitive, literal: query.literal, regexp: query.regexp, wholeWord: query.wholeWord });
  const tree = syntaxTree(state);
  const marks = [];
  const blocks: TextRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (const node of mathNodes(tree, from, to)) {
      const span = mathSpan(state.doc, node);
      if (raw.getCursor(state, span.texFrom, span.texTo).next().done) continue;
      if (node.name === 'BlockMath') blocks.push({ from: state.doc.lineAt(node.from).from, to: node.to });
      else marks.push(matchMark.range(node.from, node.to));
    }
  }
  return { marks: Decoration.set(marks, true), blocks };
}

/**
 * A formula draws its TeX as one object, so Find's highlight can't show a
 * match inside it; while the Find bar is open, a formula that holds one
 * takes the match fill. In a line an outer mark wraps the formula's widget;
 * a block's widget, which no mark reaches, gets `data-math-match`.
 */
const searchMatches = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  blocks: TextRange[];
  marked: Element[] = [];

  constructor(view: EditorView) {
    ({ marks: this.decorations, blocks: this.blocks } = formulasMatching(view));
  }

  update(update: ViewUpdate) {
    const { startState, state } = update;
    if (update.docChanged || update.viewportChanged || getSearchQuery(startState) !== getSearchQuery(state) || searchPanelOpen(startState) !== searchPanelOpen(state)) {
      const had = this.blocks.length > 0;
      ({ marks: this.decorations, blocks: this.blocks } = formulasMatching(update.view));
      if (had || this.blocks.length > 0) update.view.requestMeasure({ key: this, read: () => null, write: () => this.markBlocks(update.view) });
    }
  }

  markBlocks(view: EditorView) {
    for (const element of this.marked) element.removeAttribute('data-math-match');
    this.marked = [];
    if (this.blocks.length === 0) return;
    for (const child of view.contentDOM.children) {
      if (child.classList.contains('cm-line')) continue;
      let at: number;
      try { at = view.posAtDOM(child); } catch { continue; }
      const drawn = this.blocks.some((block) => at >= block.from && at <= block.to) ? child.querySelector('.cm-math') : null;
      if (!drawn) continue;
      drawn.setAttribute('data-math-match', '');
      this.marked.push(drawn);
    }
  }

  destroy() {
    for (const element of this.marked) element.removeAttribute('data-math-match');
  }
}, { provide: (plugin) => EditorView.outerDecorations.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none) });

/** Math in the page editor: the parser's reparse guard, drawing, the page's macros and, in documents, editing. */
export const math: Extension = [mathReparse, pageMacros, inlineMath, blockSource, blockMath, protectedMath, tableMath, editingMarks, editingWidgets, searchMatches, flowOnResize, mathEditing, insertEquationItem];
