import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { Code, Copy, Trash2 } from 'lucide-react';
import { codeText, fenceAt, fenceOf, type Fence } from './codeBlocks';
import { infoWord } from './codeLanguages';
import { objectKinds, type ObjectKind } from './extensionPoints';
import { docMode } from './livePreview';
import { removeObject } from './objectFrame';
import { blockFrame, type BlockContext } from './previewWidgets';

/*
 * Diagrams. A `mermaid` fence draws with Mermaid, loaded the first time one
 * shows, in greys: the base theme with the page's own black and white, and
 * the colours of `style`, `classDef` and `linkStyle` lines left out (the
 * file keeps them). Mermaid runs with its strict security level and SVG
 * labels, one render at a time, and the picture is an <img> from a data:
 * URL, since the page allows no blob: images. Each source draws once per
 * theme. Pocket's `flowchart` fences of "A -> B" lines draw as a chain of
 * boxes without Mermaid.
 *
 * In a document a diagram shows Diagram or Code, a view-only choice: Code
 * edits the fence in place with the diagram under it, drawn again 300 ms
 * after typing stops.
 */

export type DiagramKind = 'mermaid' | 'pocket';

/** Which diagram a fence's info string asks for, or null for code. */
export function diagramKind(info: string): DiagramKind | null {
  const word = infoWord(info).toLowerCase();
  return word === 'mermaid' ? 'mermaid' : word === 'flowchart' ? 'pocket' : null;
}

// ---------------------------------------------------------------------------
// Pocket flowcharts

// Mermaid's own syntax, which stays code in a `flowchart` fence.
const MERMAID_LINE = /-->|---|==>|^(?:graph|flowchart|subgraph|end|classDef|class|style|linkStyle|click|%%)\b|[[\]{}]/;

/**
 * The steps of a Pocket flowchart, top to bottom: each line's "A -> B ->
 * C" in order, a step repeated from the line before drawn once. Null when a
 * line is anything else.
 */
export function pocketSteps(source: string): string[] | null {
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.some((line) => MERMAID_LINE.test(line))) return null;
  const steps: string[] = [];
  for (const line of lines) {
    for (const part of line.split(/\s*->\s*/)) {
      const step = part.trim();
      if (step && steps[steps.length - 1] !== step) steps.push(step);
    }
  }
  return steps.length > 0 ? steps : null;
}

const ARROW = '<svg viewBox="0 0 12 20" width="12" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 1v17"/><path d="m2 14 4 4 4-4"/></svg>';

function drawPocket(steps: readonly string[], parent: HTMLElement): void {
  const chain = document.createElement('div');
  chain.className = 'cm-diagram-chain';
  chain.setAttribute('role', 'list');
  steps.forEach((step, index) => {
    if (index > 0) {
      const arrow = document.createElement('div');
      arrow.className = 'cm-diagram-arrow';
      arrow.innerHTML = ARROW;
      chain.append(arrow);
    }
    const box = document.createElement('div');
    box.className = 'cm-diagram-step';
    box.setAttribute('role', 'listitem');
    box.textContent = step;
    chain.append(box);
  });
  parent.append(chain);
}

// ---------------------------------------------------------------------------
// Mermaid

/** Colours dropped from `style`, `classDef` and `linkStyle` lines, and theme directives, before drawing. The file keeps them. */
export function stripColours(source: string): string {
  return source.split('\n').map((line) => {
    if (/^\s*%%\{.*\}%%\s*$/.test(line)) return '';
    const match = /^(\s*(?:style|classDef|linkStyle)\s+\S+\s+)(.*)$/.exec(line);
    if (!match) return line;
    const kept = match[2].split(',').filter((property) => !/^\s*(?:fill|stroke|color|background(?:-color)?)\s*:/i.test(property));
    return kept.length > 0 && kept.join(',').trim() ? `${match[1]}${kept.join(',')}` : '';
  }).join('\n');
}

const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';

/** The page's black and white for an <img>, which cannot read its CSS: nodes on the page, text and strokes in its foreground, edges in its tertiary grey. */
const THEMES = {
  light: { node: '#ffffff', text: '#262626', edge: '#6b6b6b', muted: '#f2f2f2' },
  dark: { node: '#1a1a1a', text: '#ededed', edge: '#8f8f8f', muted: '#262626' },
} as const;

export type DiagramTheme = keyof typeof THEMES;

function themeVariables(theme: DiagramTheme) {
  const { node, text, edge, muted } = THEMES[theme];
  return {
    darkMode: theme === 'dark',
    background: node,
    fontFamily: FONT,
    fontSize: '14px',
    primaryColor: node,
    primaryTextColor: text,
    primaryBorderColor: text,
    secondaryColor: muted,
    secondaryTextColor: text,
    secondaryBorderColor: edge,
    tertiaryColor: node,
    tertiaryTextColor: text,
    tertiaryBorderColor: edge,
    mainBkg: node,
    nodeBorder: text,
    nodeTextColor: text,
    textColor: text,
    titleColor: text,
    lineColor: edge,
    defaultLinkColor: edge,
    edgeLabelBackground: node,
    clusterBkg: muted,
    clusterBorder: edge,
    noteBkgColor: muted,
    noteTextColor: text,
    noteBorderColor: edge,
    actorBkg: node,
    actorBorder: text,
    actorTextColor: text,
    actorLineColor: edge,
    signalColor: text,
    signalTextColor: text,
    labelBoxBkgColor: node,
    labelBoxBorderColor: edge,
    labelTextColor: text,
    loopTextColor: text,
    activationBkgColor: muted,
    activationBorderColor: edge,
    sequenceNumberColor: node,
    pie1: text,
    pie2: edge,
    pie3: muted,
    pieStrokeColor: node,
    pieTitleTextColor: text,
    pieSectionTextColor: node,
  };
}

/** No shadows, 4px node corners, and edge labels on the page's colour so lines never cross their text. */
function themeCss(theme: DiagramTheme): string {
  const { node } = THEMES[theme];
  return [
    '.node rect, .node polygon, .node circle, .node ellipse, .node path, .cluster rect, [filter] { filter: none !important; }',
    '.node rect, .cluster rect { rx: 4px; ry: 4px; }',
    `.edgeLabel rect, .edgeLabel .label rect, .labelBkg { fill: ${node} !important; background-color: ${node} !important; opacity: 1 !important; }`,
  ].join('\n');
}

export type Drawn = { url: string; width: number; height: number } | { error: string };

type Mermaid = (typeof import('mermaid'))['default'];

let loading: Promise<Mermaid> | null = null;
const loadMermaid = () => (loading ??= import('mermaid').then((module) => module.default));

const drawn = new Map<string, Promise<Drawn>>();
let queue: Promise<unknown> = Promise.resolve();
let renders = 0;

/** The SVG with a size of its own, so an <img> knows how wide it is. */
function sized(svg: string): { svg: string; width: number; height: number } {
  const box = /viewBox="[-\d.e]+\s+[-\d.e]+\s+([\d.e]+)\s+([\d.e]+)"/.exec(svg);
  const width = box ? Math.ceil(Number(box[1])) : 0;
  const height = box ? Math.ceil(Number(box[2])) : 0;
  if (!width || !height) return { svg, width, height };
  const open = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const fixed = open.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '').replace(/\sstyle="[^"]*"/, '').replace(/^<svg/, `<svg width="${width}" height="${height}"`);
  return { svg: svg.replace(open, fixed), width, height };
}

/** Draws a Mermaid source in a theme, one at a time, once per source and theme. */
export function drawMermaid(source: string, theme: DiagramTheme): Promise<Drawn> {
  const key = `${theme}\u0000${source}`;
  const known = drawn.get(key);
  if (known) return known;
  const run = queue.then(async (): Promise<Drawn> => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      maxTextSize: 50_000,
      maxEdges: 500,
      suppressErrorRendering: true,
      fontFamily: FONT,
      themeVariables: themeVariables(theme),
      themeCSS: themeCss(theme),
    });
    const id = `opal-diagram-${renders += 1}`;
    try {
      const { svg } = await mermaid.render(id, stripColours(source));
      const result = sized(svg);
      return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`, width: result.width, height: result.height };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = run.catch(() => undefined);
  drawn.set(key, run);
  if (drawn.size > 200) drawn.delete(drawn.keys().next().value as string);
  return run;
}

/** The page's theme: the shell sets `dark` on the root. */
export function pageTheme(): DiagramTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

// Pictures on screen, drawn again from the other theme's cache when the theme changes.
const pictures = new Set<{ image: HTMLImageElement; source: string }>();
let watching = false;

function watchTheme(): void {
  if (watching || typeof MutationObserver === 'undefined') return;
  watching = true;
  let theme = pageTheme();
  new MutationObserver(() => {
    const next = pageTheme();
    if (next === theme) return;
    theme = next;
    for (const picture of [...pictures]) {
      if (!picture.image.isConnected) {
        pictures.delete(picture);
        continue;
      }
      void drawMermaid(picture.source, next).then((result) => { if ('url' in result) picture.image.src = result.url; });
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

/** Fills `canvas` with the diagram, or the code and Mermaid's message when it does not parse. */
function drawInto(canvas: HTMLElement, kind: DiagramKind, source: string, showSourceOnError: boolean): void {
  if (kind === 'pocket') {
    const steps = pocketSteps(source);
    canvas.textContent = '';
    if (steps) drawPocket(steps, canvas);
    else showError(canvas, source, 'Not a flowchart of "A -> B" lines.', showSourceOnError);
    return;
  }
  canvas.dataset.state = 'loading';
  void drawMermaid(source, pageTheme()).then((result) => {
    if (!canvas.isConnected) return;
    canvas.textContent = '';
    delete canvas.dataset.state;
    if ('error' in result) {
      showError(canvas, source, result.error, showSourceOnError);
      return;
    }
    const image = document.createElement('img');
    image.className = 'cm-diagram-image';
    image.alt = 'Diagram';
    image.src = result.url;
    image.width = result.width;
    image.height = result.height;
    canvas.append(image);
    pictures.add({ image, source });
    watchTheme();
  });
}

function showError(canvas: HTMLElement, source: string, message: string, showSource: boolean): void {
  if (showSource) {
    const code = document.createElement('pre');
    code.className = 'cm-diagram-source';
    code.textContent = source;
    canvas.append(code);
  }
  // The first line says where; the parser's list of expected tokens goes in the tooltip.
  const line = document.createElement('div');
  line.className = 'cm-diagram-error';
  line.textContent = (message.split('\n')[0] ?? message).replace(/:\s*$/, '');
  line.title = message;
  canvas.append(line);
}

// ---------------------------------------------------------------------------
// Diagram and Code

/** Shows a document's diagram as Code (true) or as the diagram (false), by where its fence starts. */
export const setDiagramCode = StateEffect.define<{ at: number; code: boolean }>();

const SEGMENT = (label: string, pressed: boolean) => {
  const segment = document.createElement('button');
  segment.type = 'button';
  segment.className = 'cm-diagram-segment';
  segment.textContent = label;
  segment.tabIndex = -1;
  segment.setAttribute('aria-pressed', String(pressed));
  segment.addEventListener('mousedown', (event) => event.preventDefault());
  return segment;
};

/** The Diagram/Code control, for a header. */
export function modeControl(view: EditorView, at: () => number, code: boolean): HTMLElement {
  const control = document.createElement('span');
  control.className = 'cm-diagram-modes';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', 'Show as');
  const diagram = SEGMENT('Diagram', !code);
  const source = SEGMENT('Code', code);
  diagram.addEventListener('click', () => view.dispatch({ effects: setDiagramCode.of({ at: at(), code: false }) }));
  source.addEventListener('click', () => {
    const fence = fenceAt(view.state, at());
    view.dispatch({ effects: setDiagramCode.of({ at: at(), code: true }), selection: fence?.lines[0] ? { anchor: fence.lines[0].from } : undefined });
    view.focus();
  });
  control.append(diagram, source);
  return control;
}

/** A diagram drawn over its whole fence: a header with Diagram/Code, then the picture. Clicking it selects it. */
export class DiagramWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly kind: DiagramKind,
    readonly label: string,
    readonly context: BlockContext,
    readonly indent: number,
    /** In a document, where Diagram/Code is a view-only choice the page keeps. */
    readonly inDocument: boolean,
  ) { super(); }

  eq(other: DiagramWidget) {
    return other.source === this.source && other.kind === this.kind && other.context === this.context && other.indent === this.indent && other.inDocument === this.inDocument;
  }

  toDOM(view: EditorView) {
    const frame = blockFrame('cm-diagram', this.context, this.indent);
    if (this.inDocument) frame.dataset.object = 'diagram';
    frame.setAttribute('role', 'figure');
    frame.setAttribute('aria-label', `Diagram, ${this.label}`);
    const box = document.createElement('div');
    box.className = 'cm-diagram-box';
    const head = document.createElement('div');
    head.className = 'cm-diagram-header';
    const label = document.createElement('span');
    label.className = 'cm-diagram-label';
    label.textContent = this.label;
    const canvas = document.createElement('div');
    canvas.className = 'cm-diagram-canvas';
    head.append(label);
    if (this.inDocument) {
      head.append(modeControl(view, () => view.posAtDOM(frame), false));
    } else {
      // A note's choice lasts while the block is drawn.
      const control = document.createElement('span');
      control.className = 'cm-diagram-modes';
      const diagram = SEGMENT('Diagram', true);
      const code = SEGMENT('Code', false);
      const show = (asCode: boolean) => {
        diagram.setAttribute('aria-pressed', String(!asCode));
        code.setAttribute('aria-pressed', String(asCode));
        canvas.textContent = '';
        if (asCode) {
          const pre = document.createElement('pre');
          pre.className = 'cm-diagram-source';
          pre.textContent = this.source;
          canvas.append(pre);
        } else {
          drawInto(canvas, this.kind, this.source, true);
        }
      };
      diagram.addEventListener('click', () => show(false));
      code.addEventListener('click', () => show(true));
      control.append(diagram, code);
      head.append(control);
    }
    box.append(head, canvas);
    frame.append(box);
    drawInto(canvas, this.kind, this.source, true);
    return frame;
  }

  get estimatedHeight() { return 240; }

  ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('button') !== null;
  }
}

/** Under a diagram shown as Code: the picture, drawn again 300 ms after typing stops, with Mermaid's message when it does not parse. */
class DiagramPreviewWidget extends WidgetType {
  constructor(readonly source: string, readonly kind: DiagramKind, readonly context: BlockContext, readonly indent: number) { super(); }

  eq(other: DiagramPreviewWidget) {
    return other.source === this.source && other.kind === this.kind && other.context === this.context && other.indent === this.indent;
  }

  toDOM() {
    const frame = blockFrame('cm-diagram cm-diagram-preview', this.context, this.indent);
    frame.dataset.layout = `${this.context}|${this.indent}`;
    const box = document.createElement('div');
    box.className = 'cm-diagram-box';
    const canvas = document.createElement('div');
    canvas.className = 'cm-diagram-canvas';
    box.append(canvas);
    frame.append(box);
    drawInto(canvas, this.kind, this.source, false);
    return frame;
  }

  updateDOM(dom: HTMLElement) {
    if (dom.dataset.layout !== `${this.context}|${this.indent}`) return false;
    const canvas = dom.querySelector<HTMLElement>('.cm-diagram-canvas');
    if (!canvas) return false;
    const timer = Number(canvas.dataset.timer ?? 0);
    if (timer) window.clearTimeout(timer);
    canvas.dataset.timer = String(window.setTimeout(() => {
      delete canvas.dataset.timer;
      drawInto(canvas, this.kind, this.source, false);
    }, 300));
    return true;
  }

  get estimatedHeight() { return 200; }

  ignoreEvent() { return true; }
}

// ---------------------------------------------------------------------------
// In a document

interface Diagrams {
  /** Where the fences shown as Code start. */
  code: readonly number[];
  decorations: DecorationSet;
}

const CALLOUT_LINE = /^(?:[ \t]*>[ \t]?)+\[![\w-]+\]/;

function contextOf(state: EditorState, node: SyntaxNode): BlockContext {
  let quote: SyntaxNode | null = null;
  for (let at = node.parent; at; at = at.parent) if (at.name === 'Blockquote') quote = at;
  if (!quote) return null;
  return CALLOUT_LINE.test(state.doc.lineAt(quote.from).text) ? 'callout' : 'quote';
}

function listIndentOf(node: SyntaxNode): number {
  let depth = -1;
  let inItem = false;
  for (let at: SyntaxNode | null = node; at; at = at.parent) {
    if (at.name === 'BulletList' || at.name === 'OrderedList') depth += 1;
    if (at.name === 'ListItem') inItem = true;
  }
  return inItem ? Math.max(depth, 0) * 1.5 + 1.5 : 0;
}

const LEAF = new Set(['Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'SetextHeading1', 'SetextHeading2', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'LinkReference', 'HorizontalRule', 'Table']);

/** A closed diagram fence, with its kind, or null. */
export function diagramFence(state: EditorState, fence: Fence): DiagramKind | null {
  return fence.close ? diagramKind(fence.info.text) : null;
}

/** Whether a document shows the diagram whose fence starts at `at` as its picture rather than its code. */
export function showsDiagram(state: EditorState, fence: Fence): boolean {
  if (!state.facet(docMode) || !diagramFence(state, fence)) return false;
  const value = state.field(diagramField, false);
  return Boolean(value) && !value?.code.includes(fence.open.from);
}

function build(state: EditorState, code: readonly number[]): Diagrams {
  const decorations: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'FencedCode') return LEAF.has(ref.name) ? false : undefined;
      const fence = fenceOf(state, ref.node);
      const kind = diagramFence(state, fence);
      if (!kind || !fence.close) return false;
      const source = codeText(state, fence);
      const context = contextOf(state, ref.node);
      const indent = listIndentOf(ref.node);
      if (code.includes(fence.open.from)) {
        decorations.push(Decoration.widget({ widget: new DiagramPreviewWidget(source, kind, context, indent), block: true, side: 1 }).range(fence.close.to));
      } else {
        const widget = new DiagramWidget(source, kind, kind === 'mermaid' ? 'Mermaid' : 'Flowchart', context, indent, true);
        decorations.push(Decoration.replace({ widget, block: true }).range(fence.open.from, fence.close.to));
      }
      return false;
    },
  });
  return { code, decorations: Decoration.set(decorations, true) };
}

/** A document's diagrams: drawn over their fences, or under them while shown as Code. */
export const diagramField = StateField.define<Diagrams>({
  create: (state) => build(state, []),
  update(value, tr) {
    let code = tr.docChanged ? value.code.map((at) => tr.changes.mapPos(at)) : value.code;
    let changed = tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state);
    for (const effect of tr.effects) {
      if (!effect.is(setDiagramCode)) continue;
      code = effect.value.code ? [...code.filter((at) => at !== effect.value.at), effect.value.at] : code.filter((at) => at !== effect.value.at);
      changed = true;
    }
    return changed ? build(tr.state, code) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** A diagram shown as its picture is a block object: framed by a click, Enter shows its code. */
const diagramKindObject = objectKinds.of({
  kind: 'diagram',
  nodes: ['FencedCode'],
  block: true,
  test: (state, node: SyntaxNode) => {
    const fence = fenceOf(state, node);
    return showsDiagram(state, fence);
  },
  open: (view, obj) => {
    const fence = fenceAt(view.state, obj.to);
    if (!fence) return;
    view.dispatch({ effects: setDiagramCode.of({ at: fence.open.from, code: true }), selection: fence.lines[0] ? { anchor: fence.lines[0].from } : undefined, scrollIntoView: true });
  },
  actions: () => [
    { id: 'code', label: 'Code', icon: Code, run: (view, target) => { diagramKindOpen(view, target.to); } },
    { id: 'copy', label: 'Copy', icon: Copy, run: (view, target) => {
      const fence = fenceAt(view.state, target.to);
      if (fence) void navigator.clipboard?.writeText(codeText(view.state, fence));
    } },
    { id: 'remove', label: 'Remove', icon: Trash2, run: (view, target) => removeObject(view, target, -1, 'delete') },
  ],
  destination: (state, obj) => {
    const fence = fenceAt(state, obj.to);
    return fence && diagramKind(fence.info.text) === 'pocket' ? 'Flowchart' : 'Mermaid';
  },
} satisfies ObjectKind);

function diagramKindOpen(view: EditorView, at: number): void {
  const fence = fenceAt(view.state, at);
  if (!fence) return;
  view.dispatch({ effects: setDiagramCode.of({ at: fence.open.from, code: true }), selection: fence.lines[0] ? { anchor: fence.lines[0].from } : undefined, scrollIntoView: true });
  view.focus();
}

/** Diagrams in a document. */
export const diagramDocExtension = [diagramField, diagramKindObject];
