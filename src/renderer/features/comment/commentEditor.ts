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

/** A comment as the editor holds it: where it was made, its state and its sending order. */
export interface MarkAt {
  pos: number;
  status: CommentMarkStatus;
  order: number;
}

/** The page's marks as the store has them now. */
const syncMarks = StateEffect.define<null>();
const clamp = (state: EditorState, pos: number) => Math.max(0, Math.min(pos, state.doc.length));

function fromStore(state: EditorState, kept: ReadonlyMap<string, MarkAt>): ReadonlyMap<string, MarkAt> {
  const host = state.facet(commentHost);
  if (!host) return kept;
  const next = new Map<string, MarkAt>();
  for (const mark of marksOf(useCommentStore.getState().marks, host.path)) {
    next.set(mark.id, { pos: kept.get(mark.id)?.pos ?? clamp(state, mark.pos), status: mark.status, order: mark.order });
  }
  return next;
}

/**
 * The page's comments by run id, each at the place it was made. The place
 * maps through every edit, typed or merged from the disk, and keeps to the
 * start of text that replaces the text it was on.
 */
export const commentMarks = StateField.define<ReadonlyMap<string, MarkAt>>({
  create: (state) => fromStore(state, new Map()),
  update(value, tr) {
    let next = value;
    if (tr.docChanged && value.size > 0) {
      const moved = new Map<string, MarkAt>();
      for (const [id, mark] of value) moved.set(id, { ...mark, pos: tr.changes.mapPos(mark.pos, -1) });
      next = moved;
    }
    if (tr.effects.some((effect) => effect.is(syncMarks))) next = fromStore(tr.state, next);
    return next;
  },
});

/** The comments whose shared mark has its popover open; `n` is new for each opening. */
export interface OpenMarks {
  n: number;
  ids: readonly string[];
}

let openings = 0;
export const setOpenMark = StateEffect.define<readonly string[] | null>();
export const openMark = StateField.define<OpenMarks | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setOpenMark)) {
        if (!effect.value || effect.value.length === 0) return null;
        openings += 1;
        return { n: openings, ids: effect.value };
      }
    }
    if (!value) return null;
    const marks = tr.state.field(commentMarks);
    const ids = value.ids.filter((id) => marks.has(id));
    if (ids.length === 0) return null;
    return ids.length === value.ids.length ? value : { n: value.n, ids };
  },
});

/** Comments whose places are on one visual row, sharing one mark. */
export interface MarkGroup {
  /** Oldest first. */
  ids: string[];
  status: CommentMarkStatus;
  /** The middle of the row, in window coordinates. */
  y: number;
}

/** Running if any is running or stopping, else failed if any failed, else done. */
export function groupStatus(statuses: readonly CommentMarkStatus[]): CommentMarkStatus {
  if (statuses.some((entry) => entry === 'running' || entry === 'stopping')) return 'running';
  if (statuses.includes('failed')) return 'failed';
  return 'done';
}

/**
 * The middle of the visual row a place is on, in window coordinates. A place
 * the editor cannot draw a caret at (inside a drawn table or another block
 * shown as a picture) takes its block's first row, so it always has one.
 */
function rowMiddle(view: EditorView, pos: number): number {
  const line = view.defaultLineHeight;
  const coords = view.coordsAtPos(pos, 1);
  if (coords && coords.bottom > coords.top && coords.bottom - coords.top < line * 2) return (coords.top + coords.bottom) / 2;
  const block = view.lineBlockAt(pos);
  return view.documentTop + block.top + Math.min(block.height, line) / 2;
}

/** The page's marks: one for each visual row that has comments, top to bottom. */
export function markGroups(view: EditorView): MarkGroup[] {
  const marks = view.state.field(commentMarks, false);
  if (!marks || marks.size === 0) return [];
  const placed = [...marks]
    .filter(([, mark]) => mark.pos >= view.viewport.from && mark.pos <= view.viewport.to)
    .map(([id, mark]) => ({ id, mark, y: rowMiddle(view, mark.pos) }))
    .sort((a, b) => a.y - b.y || a.mark.order - b.mark.order);
  const half = view.defaultLineHeight / 2;
  const groups: { entries: typeof placed; y: number }[] = [];
  for (const entry of placed) {
    const last = groups[groups.length - 1];
    if (last && entry.y - last.y < half) last.entries.push(entry);
    else groups.push({ entries: [entry], y: entry.y });
  }
  return groups.map(({ entries, y }) => {
    const sorted = [...entries].sort((a, b) => a.mark.order - b.mark.order);
    return { ids: sorted.map((entry) => entry.id), status: groupStatus(sorted.map((entry) => entry.mark.status)), y };
  });
}

/** The shared mark that holds any of `ids`, as the page is drawn now. */
export function groupOf(view: EditorView, ids: readonly string[]): MarkGroup | null {
  return markGroups(view).find((group) => group.ids.some((id) => ids.includes(id))) ?? null;
}

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
    readonly ids: readonly string[],
    readonly status: CommentMarkStatus,
    readonly left: number,
    readonly top: number,
    readonly open: boolean,
  ) {}

  private get key(): string {
    return this.ids.join(' ');
  }

  eq(other: LayerMarker): boolean {
    return other instanceof CommentMarker && other.key === this.key && other.status === this.status
      && other.left === this.left && other.top === this.top && other.open === this.open;
  }

  draw(): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.tabIndex = -1;
    element.className = 'cm-comment-mark';
    this.apply(element);
    return element;
  }

  update(element: HTMLElement, previous: LayerMarker): boolean {
    if (!(previous instanceof CommentMarker)) return false;
    this.apply(element);
    return true;
  }

  private apply(element: HTMLElement): void {
    // The first comment names the mark; all of them are listed for the popover.
    element.dataset.commentMark = this.ids[0];
    element.dataset.commentIds = this.key;
    element.dataset.count = String(this.ids.length);
    if (element.dataset.status !== this.status) {
      element.dataset.status = this.status;
      element.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[this.status]}</svg>`;
    }
    const label = this.ids.length > 1 ? `${this.ids.length} comments, ${LABELS[this.status].replace('Comment ', '')}` : LABELS[this.status];
    if (element.getAttribute('aria-label') !== label) element.setAttribute('aria-label', label);
    if (this.open) element.dataset.open = '';
    else delete element.dataset.open;
    element.style.left = `${this.left}px`;
    element.style.top = `${this.top}px`;
  }
}

/** The marks, drawn in a layer of their own in the page's left padding, beside the row each comment was made on. */
const markLayer = layer({
  above: true,
  class: 'cm-comment-marks',
  update: (update) => update.docChanged || update.viewportChanged || update.geometryChanged
    || update.startState.field(commentMarks) !== update.state.field(commentMarks)
    || update.startState.field(openMark) !== update.state.field(openMark),
  markers(view) {
    const groups = markGroups(view);
    if (groups.length === 0) return [];
    const scroller = view.scrollDOM.getBoundingClientRect();
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft;
    const baseTop = scroller.top - view.scrollDOM.scrollTop;
    const left = Math.round(view.contentDOM.getBoundingClientRect().left - baseLeft + MARK_INSET);
    const open = view.state.field(openMark)?.ids ?? [];
    return groups.map((group) => new CommentMarker(
      group.ids,
      group.status,
      left,
      Math.round(group.y - baseTop - MARK_SIZE / 2),
      group.ids.some((id) => open.includes(id)),
    ));
  },
  mount(element, view) {
    // The layer is aria-hidden for CodeMirror's own layers; the marks are buttons.
    element.removeAttribute('aria-hidden');
    element.addEventListener('pointerdown', (event) => {
      const mark = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-comment-ids]') : null;
      if (!mark || event.button !== 0) return;
      // The caret stays in the text.
      event.preventDefault();
      const ids = (mark.dataset.commentIds ?? '').split(' ').filter(Boolean);
      const open = view.state.field(openMark)?.ids ?? [];
      view.dispatch({ effects: setOpenMark.of(ids.some((id) => open.includes(id)) ? null : ids) });
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
