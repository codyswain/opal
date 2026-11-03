import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState, Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { classifyFile } from '@/common/fileKind';
import { objectAt } from './extensionPoints';
import { linkTarget } from './livePreview';
import { setFrame } from './objectFrame';
import { parseWikiTarget, resolvedLinks } from './wikiLinks';

/*
 * Images in a document. An image is a file object (fileWidgets.ts): a click
 * frames it and the frame shows a square at each corner (ImageWidget).
 * Dragging a corner resizes it, keeping its shape, and writes only its width
 * when the button comes up. Backspace and Delete frame it first and take it
 * out on a second press, as every block object does; the file stays in the
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
  const at = view.posAtDOM(frame);
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    const node = view.dom.isConnected ? imageNode(view.state, at, 1) : null;
    const changes = node && width !== Math.round(box.width) ? widthChange(view.state, node.from, width) : null;
    if (!changes) {
      image.style.width = before;
      return;
    }
    view.dispatch({ changes, annotations: isolateHistory.of('full'), userEvent: 'input.resize' });
    // The image stays framed at its new width.
    const obj = objectAt(view.state, at, 1) ?? objectAt(view.state, at, 0);
    if (obj) view.dispatch({ effects: setFrame.of(obj) });
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/**
 * A drag on a framed image's corner resizes it. The listener sits on the
 * whole editor and runs first, ahead of the frame's own click, which frames
 * an image on a plain click (objectFrame.ts).
 */
const cornerDrags = ViewPlugin.define((view) => {
  const down = (event: MouseEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const corner = event.target.closest<HTMLElement>('.cm-md-image-handle')?.dataset.corner;
    const frame = corner ? event.target.closest<HTMLElement>('.cm-md-image') : null;
    if (!corner || !frame || !imageNode(view.state, view.posAtDOM(frame), 1)) return;
    event.preventDefault();
    event.stopPropagation();
    resize(view, frame, corner, event);
  };
  view.dom.addEventListener('mousedown', down, true);
  return { destroy: () => view.dom.removeEventListener('mousedown', down, true) };
});

export const imageFrame: Extension = [cornerDrags];
