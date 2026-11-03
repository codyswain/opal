import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Facet, type EditorState, type Range } from '@codemirror/state';
import type { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { BlockContext } from './previewWidgets';

/*
 * Extension points of the page editor. A feature registers in its own file
 * and adds its extension to the editor (one line in `docModeExtensions` or
 * `markdownEditorExtensions`), so the shared files never need its cases.
 *
 * Node decorator: draws a syntax node on the lines in view. `lineDecorations`
 * asks the decorators registered for a node's name before its own switch;
 * returning true skips the built-in case and the node's children.
 *
 *   nodeDecorators.of({ nodes: ['InlineMath'], decorate(ctx, node) {
 *     if (ctx.reveal.span(node.from, node.to)) return false;
 *     ctx.out.push(Decoration.replace({ widget: new MathWidget(...) }).range(node.from, node.to));
 *     return true;
 *   } })
 *
 * Block renderer: draws a node over whole lines as a block widget. `findBlocks`
 * asks it first. A widget draws the block, null means "not drawn as a block"
 * (the built-in Table or FencedCode widget is skipped too), and undefined
 * leaves the node to the next renderer or the built-in one.
 *
 *   blockRenderers.of({ nodes: ['FencedCode'], widget: (state, node, from, to, layout) =>
 *     state.facet(docMode) ? null : new CodeWidget(state.sliceDoc(from, to), layout) })
 *
 * Protected range: text the page draws as one thing, such as a formula. Bold,
 * Clear, headings and lists never write inside one, typing escapes and Replace
 * must not either, and selections treat them as atoms.
 *
 *   protectedRanges.of((state, from, to) => mathRanges(state, from, to))
 *
 * Object kind: something the page shows as one object, framed on the first
 * Backspace or Delete when `block` (removed on a second, new press) and
 * removed in one press when inline. `test` narrows the nodes, `open` runs on
 * Enter or a double-click, and `actions` fills the object bar and its
 * right-click menu. A widget's root element with a `data-object` attribute
 * frames its object on a click, when the widget's `ignoreEvent` lets the
 * editor see the mousedown.
 *
 *   objectKinds.of({ kind: 'table', nodes: ['Table'], block: true,
 *     open: (view, obj) => view.dispatch({ effects: setOpenBlock.of(obj) }),
 *     actions: (state, obj) => [{ id: 'remove', label: 'Remove', run: removeObject }] })
 *
 * Delete handler: a Backspace or Delete rule. `deleteVisibly` asks them, by
 * priority (highest first), after a framed object and before its own rules.
 * `event` is the key press, or null when a command runs without one.
 *
 *   deleteHandlers.of({ priority: 10, run: (view, dir, event) => backspaceAfterCode(view, dir) })
 *
 * Insert item: an entry in the toolbar's Insert menu, by `order` (Image… is 0).
 *
 *   insertItems.of({ id: 'table', label: 'Table', icon: Table, order: 20, run: insertTable })
 *
 * `treeFor(state, to)` parses up to `to` for a range command, or says so in
 * a status message and returns null when that takes too long.
 */

/** Which ranges show as Markdown: `lines` when a selection touches one of their lines, `span` only when it touches the range itself. */
export interface Reveal {
  lines: (from: number, to?: number) => boolean;
  span: (from: number, to?: number) => boolean;
}

/** What a node decorator gets: the page's state and the means to draw on the lines in view. */
export interface DecorateContext {
  state: EditorState;
  reveal: Reveal;
  /** On for a document (.mdo). */
  docMode: boolean;
  /** The page's path. */
  page: string;
  /** Wiki link targets resolved to files, or null when missing. */
  links: ReadonlyMap<string, string | null>;
  /** File versions, so a picture redraws when its file changes. */
  versions: ReadonlyMap<string, number>;
  /** In a document, the selection, which frames a picture it covers exactly; null in a note. */
  picked: { from: number; to: number } | null;
  /** The decorations drawn so far. Push more onto it. */
  out: Range<Decoration>[];
  /** Hides text on one line. `caretAfter` makes the caret rest after it where positions show as one place. */
  hide: (from: number, to: number, caretAfter?: boolean) => void;
  /** Adds a class to the line holding `at`. */
  lineClass: (at: number, className: string, style?: string) => void;
  /** Records an atomic range, which may span line breaks, without drawing anything. */
  unit: (from: number, to: number) => void;
  /** Whether a drawn block covers `at`. */
  covered: (at: number) => boolean;
  /** The lines being drawn, so a long node draws only those. */
  from: number;
  to: number;
}

export interface NodeDecorator {
  nodes: readonly string[];
  /** True when it drew the node: the built-in case and the node's children are skipped. */
  decorate: (ctx: DecorateContext, node: SyntaxNode) => boolean | void;
}

const byNode = <T extends { nodes: readonly string[] }>(values: readonly T[]): ReadonlyMap<string, readonly T[]> => {
  const map = new Map<string, T[]>();
  for (const value of values) for (const name of value.nodes) map.set(name, [...(map.get(name) ?? []), value]);
  return map;
};

/** Node decorators by node name. */
export const nodeDecorators = Facet.define<NodeDecorator, ReadonlyMap<string, readonly NodeDecorator[]>>({ combine: byNode });

/** Where a block sits: inside a quote or callout, and how far a list indents it, in em. */
export interface BlockLayout {
  context: BlockContext;
  indent: number;
}

export interface BlockRenderer {
  nodes: readonly string[];
  /** The block's widget over the lines `from` to `to`, null for no block, undefined to leave the node to others. */
  widget: (state: EditorState, node: SyntaxNode, from: number, to: number, layout: BlockLayout) => WidgetType | null | undefined;
}

/** Block renderers by node name. */
export const blockRenderers = Facet.define<BlockRenderer, ReadonlyMap<string, readonly BlockRenderer[]>>({ combine: byNode });

export interface TextRange {
  from: number;
  to: number;
}

export type ProtectedRanges = (state: EditorState, from: number, to: number) => readonly TextRange[];

export const protectedRanges = Facet.define<ProtectedRanges>();

/** The protected ranges that touch `from` to `to`, in order. */
export function protectedIn(state: EditorState, from: number, to: number): TextRange[] {
  const sources = state.facet(protectedRanges);
  if (sources.length === 0) return [];
  return sources.flatMap((source) => source(state, from, to))
    .filter((range) => range.to > range.from && range.from <= to && range.to >= from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

/** `from` to `to` with each end moved out of any protected range it is inside, outward. */
export function outsideProtected(state: EditorState, from: number, to: number): TextRange {
  for (let moved = true; moved;) {
    moved = false;
    for (const range of protectedIn(state, from, to)) {
      if (range.from < from && from < range.to) { from = range.from; moved = true; }
      if (range.from < to && to < range.to) { to = range.to; moved = true; }
    }
  }
  return { from, to };
}

/** An object on the page: its kind and its Markdown. Block objects cover whole lines. */
export interface PageObject {
  kind: string;
  from: number;
  to: number;
  /** The syntax node it is, so an edit that changes the node's type clears its frame. */
  node: string;
}

export interface ObjectAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  /** Runs the action. Each should be one undo step. */
  run?: (view: EditorView, obj: PageObject) => void;
  /** A menu of more actions in place of `run`, such as Show as, Size or More. */
  items?: readonly ObjectAction[];
}

export interface ObjectKind {
  kind: string;
  nodes: readonly string[];
  /** Block objects frame first; inline objects go in one press. */
  block: boolean;
  /** Whether a node of one of `nodes` is this kind, such as an embed of an image. All of them by default. */
  test?: (state: EditorState, node: SyntaxNode) => boolean;
  /** Enter on the framed object, or a double-click. */
  open: (view: EditorView, obj: PageObject) => void;
  /** The bar's items after its destination, in order. */
  actions: (state: EditorState, obj: PageObject) => readonly ObjectAction[];
  /** What the bar shows first: where the object points. */
  destination?: (state: EditorState, obj: PageObject) => string | null;
  /** A key on the framed object, before the frame's own rules; true when it took the key. */
  onKey?: (view: EditorView, obj: PageObject, event: KeyboardEvent) => boolean;
}

export const objectKinds = Facet.define<ObjectKind>();

/** The kind registered under `name`. */
export function objectKind(state: EditorState, name: string): ObjectKind | null {
  return state.facet(objectKinds).find((kind) => kind.kind === name) ?? null;
}

/** The line a node ends on: a node that ends at a line break belongs to the line before it. */
function lastLineTo(state: EditorState, node: SyntaxNode): number {
  const line = state.doc.lineAt(node.to);
  return line.from === node.to && node.to > node.from ? state.doc.lineAt(node.to - 1).to : line.to;
}

/** `node` as an object of `kind`: a block covers its lines, an inline object its own text. */
export function objectOf(state: EditorState, kind: ObjectKind, node: SyntaxNode): PageObject {
  return kind.block
    ? { kind: kind.kind, from: state.doc.lineAt(node.from).from, to: lastLineTo(state, node), node: node.name }
    : { kind: kind.kind, from: node.from, to: node.to, node: node.name };
}

/**
 * The registered object whose node is at `at`: one that starts there (side 1),
 * ends there (side -1), or holds it (side 0). The outermost node wins.
 */
export function objectAt(state: EditorState, at: number, side: -1 | 0 | 1): PageObject | null {
  const kinds = state.facet(objectKinds);
  if (kinds.length === 0) return null;
  let found: PageObject | null = null;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, side === 0 ? 1 : side); node; node = node.parent) {
    for (const kind of kinds) {
      if (!kind.nodes.includes(node.name) || (kind.test && !kind.test(state, node))) continue;
      const obj = objectOf(state, kind, node);
      const fits = side === 0 ? obj.from <= at && at <= obj.to : side > 0 ? obj.from === at : obj.to === at;
      if (fits) found = obj;
    }
  }
  return found;
}

export interface DeleteHandler {
  /** Higher runs first. */
  priority: number;
  /** True when it handled the key. `dir` is -1 for Backspace and 1 for Delete. */
  run: (view: EditorView, dir: -1 | 1, event: KeyboardEvent | null) => boolean;
}

export const deleteHandlers = Facet.define<DeleteHandler, readonly DeleteHandler[]>({
  combine: (values) => [...values].sort((a, b) => b.priority - a.priority),
});

/** Asks the delete handlers in order; true once one handled the key. */
export function runDeleteHandlers(view: EditorView, dir: -1 | 1, event: KeyboardEvent | null): boolean {
  return view.state.facet(deleteHandlers).some((handler) => handler.run(view, dir, event));
}

export interface InsertItem {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  /** Lower comes first. Image… is 0. */
  order: number;
  run: (view: EditorView) => void | Promise<void>;
}

/** The Insert menu's items, in order. */
export const insertItems = Facet.define<InsertItem, readonly InsertItem[]>({
  combine: (values) => [...values].sort((a, b) => a.order - b.order),
});

const PARSE_MS = 200;

/**
 * The syntax tree up to `to`, parsing for at most 200 ms, so a range command
 * sees every block it covers in a long note. Null, with a status message,
 * when the parse runs out of time; the command then changes nothing.
 */
export function treeFor(state: EditorState, to: number): Tree | null {
  const tree = ensureSyntaxTree(state, to, PARSE_MS);
  if (!tree) toast('This page is still being read. Try again in a moment.');
  return tree;
}

/**
 * The fullest syntax tree this state has, including what `treeFor` parsed
 * past the state's own tree.
 */
export function latestTree(state: EditorState): Tree {
  const own = syntaxTree(state);
  const parsed = ensureSyntaxTree(state, 0, 0);
  return parsed && parsed.length > own.length ? parsed : own;
}
