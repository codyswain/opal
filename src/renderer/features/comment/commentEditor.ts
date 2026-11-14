import { Facet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, layer, type LayerMarker } from '@codemirror/view';
import { marksOf, registerCommentView, useCommentStore, type CommentMarkStatus } from './commentStore';

/**
 * Comment in the page editor: the box's place, the marks in the margin and
 * the key that opens the box. The box and the popovers are React
 * (CommentBox.tsx, CommentMarkPopover.tsx); this keeps what they need in the
 * editor's state, so it maps through every edit, typed or from the disk.
 */

/** The page an editor shows, and how to save it now. */
export interface CommentHost {
  path: string;
  flush: () => Promise<void>;
}

export const commentHost = Facet.define<CommentHost, CommentHost | null>({
  combine: (values) => values[0] ?? null,
});

/** The box while it is open: the text it is about, from the selection when it opened. */
export interface CommentBoxAt {
  /** New for each opening, so the box starts empty. */
  id: number;
  from: number;
  to: number;
}

let boxes = 0;
export const setCommentBox = StateEffect.define<CommentBoxAt | null>();
const target = Decoration.mark({ class: 'cm-comment-target' });

/** Where the open box is. The text it is about stays marked while focus is in the box. */
export const commentBox = StateField.define<CommentBoxAt | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    if (next && tr.docChanged) {
      const from = tr.changes.mapPos(next.from, 1);
      next = { ...next, from, to: Math.max(from, tr.changes.mapPos(next.to, -1)) };
    }
    for (const effect of tr.effects) if (effect.is(setCommentBox)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (box) =>
    box && box.to > box.from ? Decoration.set([target.range(box.from, box.to)]) : Decoration.none),
});

/** A mark as the editor holds it: the start of its line, and its state. */
export interface MarkAt {
  pos: number;
  status: CommentMarkStatus;
}

/** The page's marks as the store has them now. */
const syncMarks = StateEffect.define<null>();
const lineStart = (state: EditorState, pos: number) => state.doc.lineAt(Math.max(0, Math.min(pos, state.doc.length))).from;

function fromStore(state: EditorState, kept: ReadonlyMap<string, MarkAt>): ReadonlyMap<string, MarkAt> {
  const host = state.facet(commentHost);
  if (!host) return kept;
  const next = new Map<string, MarkAt>();
  for (const mark of marksOf(useCommentStore.getState().marks, host.path)) {
    next.set(mark.id, { pos: kept.get(mark.id)?.pos ?? lineStart(state, mark.pos), status: mark.status });
  }
  return next;
}

/**
 * The page's marks by run id. Each stays at the start of the line it was put
 * beside: text typed or merged in before it moves it down, and a change to
 * the line itself keeps it on that line.
 */
export const commentMarks = StateField.define<ReadonlyMap<string, MarkAt>>({
  create: (state) => fromStore(state, new Map()),
  update(value, tr) {
    let next = value;
    if (tr.docChanged && value.size > 0) {
      const moved = new Map<string, MarkAt>();
      for (const [id, mark] of value) moved.set(id, { ...mark, pos: lineStart(tr.state, tr.changes.mapPos(mark.pos, 1)) });
      next = moved;
    }
    if (tr.effects.some((effect) => effect.is(syncMarks))) next = fromStore(tr.state, next);
    return next;
  },
});

/** The mark whose popover is open. */
export const setOpenMark = StateEffect.define<string | null>();
export const openMark = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setOpenMark)) return effect.value;
    return value && tr.state.field(commentMarks).has(value) ? value : null;
  },
});

/**
 * The selected lines, numbered from 1 in the editor's text, and the selected
 * text; null for no selection. A selection that ends at the start of a line
 * does not count that line.
 */
export function selectedLines(state: EditorState, from: number, to: number): { from: number; to: number; text: string } | null {
  if (to <= from) return null;
  const first = state.doc.lineAt(from);
  let last = state.doc.lineAt(to);
  if (to === last.from && last.number > first.number) last = state.doc.line(last.number - 1);
  return { from: first.number, to: last.number, text: state.sliceDoc(from, to) };
}

/** Opens the box under the selection, or for the whole page with none. */
export function openCommentBox(view: EditorView): boolean {
  if (!view.state.facet(commentHost)) return false;
  const { from, to } = view.state.selection.main;
  boxes += 1;
  view.dispatch({ effects: [setCommentBox.of({ id: boxes, from, to }), setOpenMark.of(null)] });
  return true;
}

/** The editor that last had focus, while it is still on the page. */
let lastView: EditorView | null = null;

/** The editor Comment from the palette or the menu acts on: the one that last had focus, or the first one on screen. */
export function commentTarget(): EditorView | null {
  if (lastView?.dom.isConnected && lastView.state.facet(commentHost)) return lastView;
  for (const element of document.querySelectorAll<HTMLElement>('.opal-editor .cm-editor')) {
    const view = EditorView.findFromDOM(element);
    const rect = element.getBoundingClientRect();
    if (view?.state.facet(commentHost) && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) return view;
  }
  return null;
}

/** Whether the window's selection runs across two editors, as from one page of a stack into the next. */
export function selectionCrossesPages(): boolean {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return false;
  const editor = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.cm-editor') ?? null;
  return editor(selection.anchorNode) !== editor(selection.focusNode);
}

const ICONS: Record<CommentMarkStatus, string> = {
  running: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  stopping: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  done: '<path d="M20 6 9 17l-5-5"/>',
  failed: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};
const LABELS: Record<CommentMarkStatus, string> = {
  running: 'Comment running',
  stopping: 'Comment stopping',
  done: 'Comment done',
  failed: 'Comment failed',
};

/** How far the mark sits from the column's left edge, inside the page's padding. */
const MARK_INSET = 6;
const MARK_SIZE = 16;

class CommentMarker implements LayerMarker {
  constructor(
    readonly id: string,
    readonly status: CommentMarkStatus,
    readonly left: number,
    readonly top: number,
    readonly open: boolean,
  ) {}

  eq(other: LayerMarker): boolean {
    return other instanceof CommentMarker && other.id === this.id && other.status === this.status
      && other.left === this.left && other.top === this.top && other.open === this.open;
  }

  draw(): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.tabIndex = -1;
    element.className = 'cm-comment-mark';
    element.dataset.commentMark = this.id;
    this.apply(element);
    return element;
  }

  update(element: HTMLElement, previous: LayerMarker): boolean {
    if (!(previous instanceof CommentMarker) || previous.id !== this.id) return false;
    this.apply(element);
    return true;
  }

  private apply(element: HTMLElement): void {
    if (element.dataset.status !== this.status) {
      element.dataset.status = this.status;
      element.setAttribute('aria-label', LABELS[this.status]);
      element.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[this.status]}</svg>`;
    }
    if (this.open) element.dataset.open = '';
    else delete element.dataset.open;
    element.style.left = `${this.left}px`;
    element.style.top = `${this.top}px`;
  }
}

/** The marks, drawn in a layer of their own in the page's left padding, beside the first row of their line. */
const markLayer = layer({
  above: true,
  class: 'cm-comment-marks',
  update: (update) => update.docChanged || update.viewportChanged
    || update.startState.field(commentMarks) !== update.state.field(commentMarks)
    || update.startState.field(openMark) !== update.state.field(openMark),
  markers(view) {
    const marks = view.state.field(commentMarks);
    if (marks.size === 0) return [];
    const scroller = view.scrollDOM.getBoundingClientRect();
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft;
    const baseTop = scroller.top - view.scrollDOM.scrollTop;
    const left = view.contentDOM.getBoundingClientRect().left - baseLeft + MARK_INSET;
    const open = view.state.field(openMark);
    const perLine = new Map<number, number>();
    const markers: CommentMarker[] = [];
    for (const [id, mark] of [...marks].sort((a, b) => a[1].pos - b[1].pos)) {
      if (mark.pos < view.viewport.from || mark.pos > view.viewport.to) continue;
      const coords = view.coordsAtPos(mark.pos, 1);
      if (!coords) continue;
      // A second mark on the same line sits just right of the first, still in the padding.
      const index = perLine.get(mark.pos) ?? 0;
      perLine.set(mark.pos, index + 1);
      const top = (coords.top + coords.bottom) / 2 - baseTop - MARK_SIZE / 2;
      markers.push(new CommentMarker(id, mark.status, Math.round(left + Math.min(index, 1) * 12), Math.round(top), open === id));
    }
    return markers;
  },
  mount(element, view) {
    // The layer is aria-hidden for CodeMirror's own layers; the marks are buttons.
    element.removeAttribute('aria-hidden');
    element.addEventListener('pointerdown', (event) => {
      const mark = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-comment-mark]') : null;
      if (!mark || event.button !== 0) return;
      // The caret stays in the text.
      event.preventDefault();
      const id = mark.dataset.commentMark ?? null;
      view.dispatch({ effects: setOpenMark.of(view.state.field(openMark) === id ? null : id) });
    });
  },
});

/** Follows the store for this page's marks, and keeps their places when the editor goes. */
const markSync = ViewPlugin.fromClass(class {
  private readonly unsubscribe: () => void;
  private readonly unregister: () => void;
  private live = true;

  constructor(private readonly view: EditorView) {
    const host = view.state.facet(commentHost);
    this.unregister = host ? registerCommentView(host.path, view) : () => undefined;
    let shown = useCommentStore.getState().marks;
    this.unsubscribe = useCommentStore.subscribe((state) => {
      if (state.marks === shown) return;
      shown = state.marks;
      // A store change can come from inside an editor update; the dispatch waits for it to end.
      queueMicrotask(() => { if (this.live) this.view.dispatch({ effects: syncMarks.of(null) }); });
    });
  }

  update(update: { focusChanged: boolean; view: EditorView }): void {
    if (update.focusChanged && update.view.hasFocus) lastView = update.view;
  }

  destroy(): void {
    this.live = false;
    this.unsubscribe();
    this.unregister();
    if (lastView === this.view) lastView = null;
    const { keep } = useCommentStore.getState();
    for (const [id, mark] of this.view.state.field(commentMarks)) keep(id, mark.pos);
  }
});

/** Comment for one page's editor. */
export function commentExtensions(host: CommentHost): Extension {
  return [
    commentHost.of(host),
    commentBox,
    commentMarks,
    openMark,
    markLayer,
    markSync,
    keymap.of([{ key: 'Mod-Shift-m', preventDefault: true, run: openCommentBox }]),
  ];
}
