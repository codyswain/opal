import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { Prec, type ChangeSpec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Command } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { classifyFile } from '@/common/fileKind';
import { linkTarget } from './livePreview';
import { parseWikiTarget, resolvedLinks } from './wikiLinks';

/*
 * Images in a document. A click selects one: the selection covers its
 * Markdown, and the image draws a frame with a square at each corner
 * (ImageWidget). Dragging a corner resizes it, keeping its shape, and writes
 * only its width when the button comes up. Arrow keys step over it, as doc
 * mode steps over anything drawn. Delete on a selected image, or Backspace
 * just after one, takes its line out of the page; the file stays in the
 * files folder.
 */

interface Range {
  from: number;
  to: number;
}

const SIZE = /^\s*\d+(?:x\d+)?\s*$/;
const MIN_WIDTH = 32;

/** The text between an image's brackets: an embed's target and size, or a Markdown image's alt text and size. */
function bracketed(node: SyntaxNode): Range | null {
  const [open, close] = node.getChildren(node.name === 'Embed' ? 'WikiLinkMark' : 'LinkMark');
  return open && close ? { from: open.to, to: close.from } : null;
}

/** The Markdown image, or embed of an image file, that starts at `at` (side 1) or ends there (side -1). */
function imageNode(state: EditorState, at: number, side: -1 | 1): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, side); node; node = node.parent) {
    if (node.name !== 'Embed' && node.name !== 'Image') continue;
    if ((side > 0 ? node.from : node.to) !== at) return null;
    const text = bracketed(node);
    if (!text) return null;
    if (node.name === 'Image') return linkTarget(state, node) ? node : null;
    const file = state.field(resolvedLinks).get(parseWikiTarget(state.sliceDoc(text.from, text.to)).target);
    return file && classifyFile(file) === 'image' ? node : null;
  }
  return null;
}

/** The image the selection covers exactly, if it does. */
function selectedImage(state: EditorState): SyntaxNode | null {
  const { main } = state.selection;
  const node = main.empty ? null : imageNode(state, main.from, 1);
  return node && node.to === main.to ? node : null;
}

/**
 * The change that writes `width` as the size of the image starting at
 * `from`, in place of the size it has, or after its target or alt text when
 * it has none. Null when the text after its "|" is not a size.
 */
export function widthChange(state: EditorState, from: number, width: number): ChangeSpec | null {
  const node = imageNode(state, from, 1);
  const text = node && bracketed(node);
  if (!node || !text) return null;
  const written = state.sliceDoc(text.from, text.to);
  const bar = written.indexOf('|');
  if (bar === -1) return { from: text.to, insert: `|${width}` };
  // An embed's size is all of its alias; a Markdown image's is the part after the alt text.
  const size = node.name === 'Embed' ? written.slice(bar + 1) : written.slice(bar + 1).split('|')[0];
  return SIZE.test(size) ? { from: text.from + bar + 1, to: text.from + bar + 1 + size.length, insert: String(width) } : null;
}

/** Takes an image out: its whole line when only quote marks and spaces share it, otherwise just its Markdown. */
function removeImage(view: EditorView, image: Range, userEvent: string): void {
  const { doc } = view.state;
  const line = doc.lineAt(image.from);
  let { from, to } = image;
  if (!/[^\s>]/.test(line.text.slice(0, from - line.from) + line.text.slice(to - line.from))) {
    from = line.number > 1 ? line.from - 1 : line.from;
    to = line.number > 1 ? line.to : Math.min(doc.length, line.to + 1);
  }
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, scrollIntoView: true, userEvent });
}

/** Backspace just after an image, Delete just before one, or either on a selected one, takes it out. */
function deleteImage(forward: boolean): Command {
  return (view) => {
    const { state } = view;
    const { main } = state.selection;
    if (state.readOnly || state.selection.ranges.length > 1) return false;
    const image = main.empty ? imageNode(state, main.head, forward ? 1 : -1) : selectedImage(state);
    if (!image) return false;
    removeImage(view, image, forward ? 'delete.forward' : 'delete.backward');
    return true;
  };
}

/** Drags a corner: the image keeps its shape and follows the pointer, and its width is written when the button comes up. */
function resize(view: EditorView, frame: HTMLElement, corner: string, start: MouseEvent): void {
  const image = frame.querySelector('img');
  if (!image) return;
  const box = image.getBoundingClientRect();
  const shape = box.height > 0 ? box.width / box.height : 0;
  const east = corner.endsWith('e') ? 1 : -1;
  const south = corner.startsWith('s') ? 1 : -1;
  const before = image.style.width;
  let width = Math.round(box.width);
  const move = (event: MouseEvent) => {
    const across = (event.clientX - start.clientX) * east;
    const down = (event.clientY - start.clientY) * south * shape;
    width = Math.round(Math.max(MIN_WIDTH, Math.min(frame.clientWidth, box.width + (Math.abs(across) >= Math.abs(down) ? across : down))));
    image.style.width = `${width}px`;
    view.requestMeasure();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    const selected = view.dom.isConnected ? selectedImage(view.state) : null;
    const changes = selected && width !== Math.round(box.width) ? widthChange(view.state, selected.from, width) : null;
    if (changes) view.dispatch({ changes, annotations: isolateHistory.of('full'), userEvent: 'input.resize' });
    else image.style.width = before;
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/** A click on an image selects it; on one of its corners it also starts a resize. */
const imageClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const frame = event.target.closest<HTMLElement>('.cm-md-image');
    const image = frame && imageNode(view.state, view.posAtDOM(frame), 1);
    if (!frame || !image) return false;
    event.preventDefault();
    view.dispatch({ selection: { anchor: image.from, head: image.to } });
    view.focus();
    const corner = event.target.closest<HTMLElement>('.cm-md-image-handle')?.dataset.corner;
    if (corner) resize(view, frame, corner, event);
    return true;
  },
});

export const imageFrame: Extension = [
  Prec.highest(imageClicks),
  Prec.highest(keymap.of([
    { key: 'Backspace', run: deleteImage(false) },
    { key: 'Delete', run: deleteImage(true) },
  ])),
];
