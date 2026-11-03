import { StateEffect, StateField } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import { toast } from 'sonner';
import { basenameFsPath, parentFsPath } from '@/common/fsPaths';
import { OPAL_FILE_SCHEME, opalFileUrlToPath } from '@/common/opalFileUrl';
import type { FileStatus } from '@/types/files';

/** Where a block sits: inside a callout or quote it takes the box's ground. */
export type BlockContext = 'callout' | 'callout-last' | 'quote' | null;

/** The frame of a table or code block, inside its callout or quote and indented to its list item's text. */
function blockFrame(base: string, context: BlockContext, indent: number): HTMLDivElement {
  const frame = document.createElement('div');
  frame.className = `cm-md-block ${base}`;
  if (context) frame.classList.add(context === 'quote' ? 'cm-md-in-quote' : 'cm-md-in-callout');
  if (context === 'callout-last') frame.classList.add('cm-md-in-callout-last');
  if (indent) frame.style.setProperty('--list-indent', `${indent}em`);
  return frame;
}

/** The file name above the body, styled like a level 1 heading. It is not part of the text. */
export class InlineTitleWidget extends WidgetType {
  constructor(readonly title: string) { super(); }

  eq(other: InlineTitleWidget) { return other.title === this.title; }

  toDOM() {
    const title = document.createElement('div');
    title.className = 'cm-md-inline-title';
    title.textContent = this.title;
    return title;
  }
}

/**
 * A list item's indentation and marker: a bullet, the item's own number, or
 * a checkbox, after its number in a numbered list. The line is indented to
 * match, so wrapped text hangs under the text and not under the marker.
 * `depth` picks the bullet's shape: a dot, a ring, a square.
 */
export class ListMarkerWidget extends WidgetType {
  constructor(
    readonly kind: 'bullet' | 'number' | 'task',
    readonly label: string,
    readonly checked = false,
    readonly depth = 0,
    /** A numbered task's number, shown before its box. */
    readonly ordinal: string | null = null,
  ) { super(); }

  eq(other: ListMarkerWidget) {
    return other.kind === this.kind && other.label === this.label && other.checked === this.checked && other.depth === this.depth && other.ordinal === this.ordinal;
  }

  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'cm-md-list-marker';
    marker.dataset.kind = this.kind;
    marker.dataset.depth = String(this.depth % 3);
    if (this.ordinal) {
      const number = document.createElement('span');
      number.className = 'cm-md-number';
      number.textContent = this.ordinal;
      marker.append(number);
    }
    const inner = document.createElement('span');
    if (this.kind === 'bullet') {
      inner.className = 'cm-md-bullet';
    } else if (this.kind === 'number') {
      inner.className = 'cm-md-number';
      inner.textContent = this.label;
    } else {
      inner.className = 'cm-md-task';
      inner.setAttribute('role', 'checkbox');
      inner.setAttribute('aria-checked', String(this.checked));
    }
    marker.append(inner);
    return marker;
  }

  // The checkbox handles its own clicks.
  ignoreEvent() { return this.kind !== 'task'; }
}

/** A callout's default title, shown when "> [!type]" has none of its own. */
export class CalloutTitleWidget extends WidgetType {
  constructor(readonly title: string) { super(); }

  eq(other: CalloutTitleWidget) { return other.title === this.title; }

  toDOM() {
    const title = document.createElement('span');
    title.className = 'cm-md-callout-title';
    title.textContent = this.title;
    return title;
  }
}

/** A rule. In a document it is an object: a click frames it and shows its bar. */
export class HorizontalRuleWidget extends WidgetType {
  constructor(readonly object = false) { super(); }

  eq(other: HorizontalRuleWidget) { return other.object === this.object; }

  toDOM() {
    const rule = document.createElement('span');
    rule.className = 'cm-md-hr';
    if (this.object) rule.dataset.object = 'horizontal rule';
    return rule;
  }

  ignoreEvent() { return !this.object; }
}

/** Stands in for the hidden end of a long link target. */
export class EllipsisWidget extends WidgetType {
  eq() { return true; }

  toDOM() {
    const ellipsis = document.createElement('span');
    ellipsis.textContent = '…';
    return ellipsis;
  }
}

/** Says a picture's file changed, such as one just downloaded, by the URL the page loads it from. */
export const fileChanged = StateEffect.define<string>();

/** How often each picture's file has changed while the page is open, so the picture loads it again. */
export const fileVersions = StateField.define<ReadonlyMap<string, number>>({
  create: () => new Map(),
  update(versions, tr) {
    for (const effect of tr.effects) {
      if (effect.is(fileChanged)) versions = new Map(versions).set(effect.value, (versions.get(effect.value) ?? 0) + 1);
    }
    return versions;
  },
});

async function fileStatus(file: string): Promise<FileStatus | null> {
  try {
    const result = await window.filesAPI.status(file);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const CORNERS = ['nw', 'ne', 'sw', 'se'];

/** Stops watching the folder of a picture that waits for its bytes, once its frame is gone. */
const unwatch = new WeakMap<HTMLElement, () => void>();

/**
 * An image, from the vault through opal-file:// or from the web. Its height
 * lands after it loads. `version` counts changes to a vault file, which then
 * loads again under a new URL, since the browser keeps what it loaded.
 * Selected in a document, it draws a frame with a square at each corner to
 * resize it by (imageFrame.ts). A vault file whose bytes are not on this Mac
 * yet shows "Not downloaded yet" and a Download button, and loads once the
 * bytes arrive, from Download or from the vault's sync.
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width: number | null,
    readonly version = 0,
    readonly selected = false,
  ) { super(); }

  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.width === this.width && other.version === this.version && other.selected === this.selected;
  }

  private get url() { return this.version ? `${this.src}?v=${this.version}` : this.src; }

  toDOM(view: EditorView) {
    const frame = document.createElement('span');
    frame.className = 'cm-md-image';
    // The box hugs the image, so the frame and its corners sit on the image's edges.
    const box = document.createElement('span');
    box.className = 'cm-md-image-box';
    const image = document.createElement('img');
    image.src = this.url;
    image.alt = this.alt;
    image.draggable = false;
    image.addEventListener('load', () => view.requestMeasure());
    image.addEventListener('error', () => { void this.explainMissing(view, frame); });
    box.append(image);
    frame.append(box);
    this.dress(frame);
    return frame;
  }

  /** A new width or selection keeps the loaded image. */
  updateDOM(frame: HTMLElement) {
    const image = frame.querySelector('img');
    if (!image || image.getAttribute('src') !== this.url || image.alt !== this.alt) return false;
    this.dress(frame);
    return true;
  }

  private dress(frame: HTMLElement) {
    const box = frame.querySelector('.cm-md-image-box');
    const image = box?.querySelector('img');
    if (!box || !image) return;
    image.style.width = this.width ? `${this.width}px` : '';
    frame.classList.toggle('cm-md-image-selected', this.selected);
    for (const handle of box.querySelectorAll('.cm-md-image-handle')) handle.remove();
    if (!this.selected) return;
    box.append(...CORNERS.map((corner) => {
      const handle = document.createElement('span');
      handle.className = 'cm-md-image-handle';
      handle.dataset.corner = corner;
      return handle;
    }));
  }

  /** A vault file still on the file store offers Download; anything else shows its alt text, as a missing file always has. */
  private async explainMissing(view: EditorView, frame: HTMLElement) {
    frame.replaceChildren();
    const file = this.src.startsWith(`${OPAL_FILE_SCHEME}:`) ? opalFileUrlToPath(this.src) : null;
    if (file && (await fileStatus(file)) === 'remote') {
      this.offerDownload(view, frame, file);
    } else {
      frame.classList.add('cm-md-image-missing');
      frame.textContent = this.alt || 'Image not found';
    }
    view.requestMeasure();
  }

  private offerDownload(view: EditorView, frame: HTMLElement, file: string) {
    frame.classList.add('cm-md-image-remote');
    const note = document.createElement('span');
    note.textContent = 'Not downloaded yet';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-md-image-download';
    button.textContent = 'Download';
    const reload = () => {
      if (view.dom.isConnected) view.dispatch({ effects: fileChanged.of(this.src) });
    };
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Downloading…';
      const result = await window.filesAPI.fetch(file).catch(() => null);
      if (result?.success && result.data === 'here') {
        reload();
        return;
      }
      toast.error(result && !result.success ? result.error : `Could not download ${basenameFsPath(file)}.`);
      button.disabled = false;
      button.textContent = 'Download';
    });
    frame.append(note, button);
    // The vault's sync may bring the bytes first.
    const folder = parentFsPath(file);
    unwatch.set(frame, window.diskAPI.onChanged(({ directories }) => {
      if (folder && directories.includes(folder)) reload();
    }));
  }

  destroy(frame: HTMLElement) {
    unwatch.get(frame)?.();
  }

  // The Download button takes its own clicks.
  ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('.cm-md-image-download') !== null;
  }
}

/** Inline content of a table cell, already stripped of its Markdown marks. */
export type InlinePiece =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em' | 'strike'; children: InlinePiece[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; children: InlinePiece[]; href: string | null }
  | { kind: 'wiki'; text: string; target: string }
  | { kind: 'break' };

export interface TableCell {
  /** Where the cell's text starts, from the start of the table. */
  offset: number;
  content: InlinePiece[];
}

export interface TableModel {
  align: ('left' | 'center' | 'right' | null)[];
  header: TableCell[];
  rows: TableCell[][];
}

function renderInline(pieces: InlinePiece[], parent: HTMLElement) {
  for (const piece of pieces) {
    if (piece.kind === 'break') {
      parent.append(document.createElement('br'));
    } else if (piece.kind === 'text') {
      parent.append(piece.text);
    } else if (piece.kind === 'code') {
      const code = document.createElement('code');
      code.className = 'cm-md-code';
      code.textContent = piece.text;
      parent.append(code);
    } else if (piece.kind === 'wiki') {
      const link = document.createElement('span');
      link.className = 'cm-md-wikilink';
      link.dataset.wikiTarget = piece.target;
      link.textContent = piece.text;
      parent.append(link);
    } else if (piece.kind === 'link') {
      const link = document.createElement('span');
      link.className = 'cm-md-link';
      if (piece.href) link.dataset.href = piece.href;
      renderInline(piece.children, link);
      parent.append(link);
    } else {
      const element = document.createElement(piece.kind === 'strong' ? 'strong' : piece.kind === 'em' ? 'em' : 's');
      renderInline(piece.children, element);
      parent.append(element);
    }
  }
}

/** The resize watch of each drawn table, so a redraw or removal stops it. */
const clipWatch = new WeakMap<HTMLElement, ResizeObserver>();

/** Marks a wide table's clipped edges, where a fade shows there is more to scroll to. */
function markClipped(frame: HTMLElement, scroller: HTMLElement) {
  const left = scroller.scrollLeft > 0;
  const right = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
  frame.classList.toggle('cm-md-clipped-left', left);
  frame.classList.toggle('cm-md-clipped-right', right);
}

/**
 * A GFM table, shown as a table while no selection is in it. A click puts a
 * cell caret in the clicked cell, outlined, and the table stays drawn.
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly model: TableModel,
    readonly context: BlockContext,
    readonly indent: number,
    /** Where the cell with the cell caret starts, from the start of the table. */
    readonly cellCaret: number | null = null,
  ) { super(); }

  withCellCaret(offset: number): TableWidget {
    return new TableWidget(this.source, this.model, this.context, this.indent, offset);
  }

  eq(other: TableWidget) {
    return other.source === this.source && other.context === this.context && other.indent === this.indent && other.cellCaret === this.cellCaret;
  }

  toDOM() {
    const frame = blockFrame('cm-md-table', this.context, this.indent);
    const scroller = document.createElement('div');
    scroller.className = 'cm-md-table-scroll';
    const table = document.createElement('table');
    // Cells past the header's columns still show, in a muted column of their own.
    const columns = Math.max(this.model.align.length, ...this.model.rows.map((cells) => cells.length));
    const row = (cells: TableCell[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      Array.from({ length: columns }, (_, column) => column).forEach((column) => {
        const cell = document.createElement(tag);
        const source = cells[column];
        const align = this.model.align[column];
        if (column >= this.model.align.length) cell.classList.add('cm-md-cell-extra');
        if (align) cell.style.textAlign = align;
        if (source) {
          cell.dataset.offset = String(source.offset);
          if (source.offset === this.cellCaret) cell.classList.add('cm-md-cell-caret');
          // The cell's text sits in a box no wider than 24em, which a table cell cannot cap by itself.
          const text = document.createElement('div');
          text.className = 'cm-md-cell';
          renderInline(source.content, text);
          cell.append(text);
        }
        tr.append(cell);
      });
      return tr;
    };
    const head = document.createElement('thead');
    head.append(row(this.model.header, 'th'));
    const body = document.createElement('tbody');
    for (const cells of this.model.rows) body.append(row(cells, 'td'));
    table.append(head, body);
    scroller.append(table);
    scroller.addEventListener('scroll', () => markClipped(frame, scroller), { passive: true });
    frame.append(scroller);
    clipWatch.get(frame)?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => markClipped(frame, scroller));
      observer.observe(scroller);
      observer.observe(table);
      clipWatch.set(frame, observer);
    }
    return frame;
  }

  /** An edit, an agent's included, redraws the table in place and keeps its sideways scroll. */
  updateDOM(frame: HTMLElement) {
    const left = frame.querySelector('.cm-md-table-scroll')?.scrollLeft ?? 0;
    const fresh = this.toDOM();
    frame.className = fresh.className;
    frame.style.cssText = fresh.style.cssText;
    frame.replaceChildren(...fresh.childNodes);
    clipWatch.get(frame)?.disconnect();
    const scroller = frame.querySelector<HTMLElement>('.cm-md-table-scroll');
    const table = scroller?.querySelector('table');
    if (scroller && table) {
      scroller.scrollLeft = left;
      scroller.addEventListener('scroll', () => markClipped(frame, scroller), { passive: true });
      const moved = clipWatch.get(fresh);
      moved?.disconnect();
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => markClipped(frame, scroller));
        observer.observe(scroller);
        observer.observe(table);
        clipWatch.set(frame, observer);
      }
      markClipped(frame, scroller);
    }
    return true;
  }

  destroy(frame: HTMLElement) {
    clipWatch.get(frame)?.disconnect();
  }

  get estimatedHeight() { return (this.model.rows.length + 1) * 34 + 16; }

  ignoreEvent() { return false; }
}

export interface CodeLine {
  /** Where the line's code starts, from the start of the block. */
  offset: number;
  text: string;
}

/**
 * A fenced code block, shown as a sunken block that scrolls sideways rather
 * than wrapping while no selection is in it. A click puts the caret where it
 * landed in the code.
 */
export class CodeBlockWidget extends WidgetType {
  constructor(readonly source: string, readonly lines: CodeLine[], readonly context: BlockContext, readonly indent: number) { super(); }

  eq(other: CodeBlockWidget) {
    return other.source === this.source && other.context === this.context && other.indent === this.indent;
  }

  toDOM() {
    const frame = blockFrame('cm-md-codeblock-widget', this.context, this.indent);
    const box = document.createElement('div');
    box.className = 'cm-md-codeblock-box';
    const code = document.createElement('div');
    code.className = 'cm-md-codeblock-lines';
    for (const line of this.lines) {
      const element = document.createElement('div');
      element.dataset.offset = String(line.offset);
      element.textContent = line.text || '\u200b';
      code.append(element);
    }
    box.append(code);
    frame.append(box);
    return frame;
  }

  get estimatedHeight() { return this.lines.length * 21 + 26; }

  ignoreEvent() { return false; }
}
