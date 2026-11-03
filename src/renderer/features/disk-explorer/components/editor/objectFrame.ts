import { Prec, StateEffect, StateField, Transaction, type EditorState, type Extension, type Line } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { objectAt, objectKind, runDeleteHandlers, type PageObject } from './extensionPoints';

/*
 * The object frame, in documents. A block object (a table, a rule, a
 * preview) frames on the first Backspace or Delete beside it and goes on a
 * second, new press; an inline object goes in one press. A frame is its own
 * state, not a selection: the caret stays where it was, so a typed key,
 * paste, drop or input method lands beside the object and deletes nothing.
 * Enter opens the object, Space and Tab do nothing, arrows and Escape clear
 * the frame, and Cmd+C or Cmd+X copy or cut its Markdown. Kinds come from
 * `objectKinds`; with none registered nothing frames.
 */

export const setFrame = StateEffect.define<PageObject | null>();

/** Whether a change touches the inside of `from` to `to`, not only its edges. */
function changedInside(tr: Transaction, from: number, to: number): boolean {
  let inside = false;
  tr.changes.iterChangedRanges((changeFrom, changeTo) => {
    if (changeFrom < to && changeTo > from) inside = true;
    if (changeFrom === changeTo && changeFrom > from && changeFrom < to) inside = true;
  });
  return inside;
}

/** Whether `tr` puts the caret somewhere other than where its changes carry it. */
function caretMoved(tr: Transaction): boolean {
  if (!tr.selection) return false;
  const carried = tr.startState.selection.main.map(tr.changes);
  return tr.selection.main.anchor !== carried.anchor || tr.selection.main.head !== carried.head;
}

/**
 * The framed object, or null. It follows edits made elsewhere, such as an
 * agent's merge, and clears when the object itself changes or is gone, so a
 * second press never removes part of it. Any edit or caret move of the
 * user's clears it too.
 */
export const objectFrame = StateField.define<PageObject | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFrame)) return effect.value;
    if (!value) return value;
    if (tr.annotation(Transaction.userEvent) !== undefined || caretMoved(tr)) return null;
    if (!tr.docChanged) return value;
    if (changedInside(tr, value.from, value.to)) return null;
    const from = tr.changes.mapPos(value.from, 1);
    const to = tr.changes.mapPos(value.to, -1);
    const found = objectAt(tr.state, from, 1);
    if (!found || found.kind !== value.kind || found.node !== value.node || found.to !== to) return null;
    return found;
  },
});

const blockFrame = Decoration.mark({ class: 'cm-object-framed' });
const inlineFrame = Decoration.mark({ class: 'cm-object-framed-inline' });

const frameMarks = EditorView.decorations.compute([objectFrame], (state): DecorationSet => {
  const frame = state.field(objectFrame);
  if (!frame || frame.to <= frame.from) return Decoration.none;
  return Decoration.set((objectKind(state, frame.kind)?.block ? blockFrame : inlineFrame).range(frame.from, frame.to));
});

/**
 * A mark never reaches a block widget, which replaces whole lines, so the
 * frame sets `data-object-framed` on the widget's own element instead.
 * CodeMirror ignores attribute changes on widgets.
 */
const blockWidgetFrame = ViewPlugin.fromClass(class {
  marked: HTMLElement[] = [];

  constructor(view: EditorView) {
    this.schedule(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.startState.field(objectFrame) !== update.state.field(objectFrame)) this.schedule(update.view);
  }

  schedule(view: EditorView) {
    view.requestMeasure({ key: this, read: () => null, write: () => this.apply(view) });
  }

  apply(view: EditorView) {
    this.clear();
    const frame = view.state.field(objectFrame, false);
    if (!frame || !objectKind(view.state, frame.kind)?.block) return;
    for (const child of view.contentDOM.children) {
      if (!(child instanceof HTMLElement) || child.classList.contains('cm-line')) continue;
      let at: number;
      try { at = view.posAtDOM(child); } catch { continue; }
      if (at < frame.from || at > frame.to) continue;
      child.setAttribute('data-object-framed', frame.kind);
      this.marked.push(child);
    }
  }

  clear() {
    for (const element of this.marked) element.removeAttribute('data-object-framed');
    this.marked = [];
  }

  destroy() {
    this.clear();
  }
});

// A line with text, past quote marks and spaces.
const hasText = (line: Line) => /[^\s>]/.test(line.text);
const quoteMarks = (line: Line) => (/^(?:[ \t]*>[ \t]?)*/.exec(line.text)?.[0] ?? '').replace(/[ \t]+$/, '');

/**
 * The change that takes a block object's lines out and leaves the separator
 * its neighbours need: one blank line between two text blocks (with their
 * quote marks when both share them), none at either edge of the page. The
 * caret goes to the side the key came from.
 */
export function removalOf(state: EditorState, obj: PageObject, dir: -1 | 1): { changes: { from: number; to: number; insert: string }; caret: number } {
  const { doc } = state;
  const first = doc.lineAt(obj.from);
  const last = doc.lineAt(obj.to);
  let above: Line | null = null;
  for (let number = first.number - 1; number >= 1 && !above; number -= 1) if (hasText(doc.line(number))) above = doc.line(number);
  let below: Line | null = null;
  for (let number = last.number + 1; number <= doc.lines && !below; number += 1) if (hasText(doc.line(number))) below = doc.line(number);
  if (above && below) {
    const blank = quoteMarks(above) === quoteMarks(below) ? quoteMarks(above) : '';
    const insert = `\n${blank}\n`;
    return { changes: { from: above.to, to: below.from, insert }, caret: dir < 0 ? above.to + insert.length : above.to };
  }
  if (above) return { changes: { from: above.to, to: doc.length, insert: doc.sliceString(doc.length - 1) === '\n' ? '\n' : '' }, caret: above.to };
  return { changes: { from: 0, to: below ? below.from : doc.length, insert: '' }, caret: 0 };
}

/** Takes an object off the page in one undoable step: an inline one's text, or a block's lines. */
export function removeObject(view: EditorView, obj: PageObject, dir: -1 | 1 = -1, userEvent = dir < 0 ? 'delete.backward' : 'delete.forward'): void {
  const { state } = view;
  if (!objectKind(state, obj.kind)?.block) {
    view.dispatch({ changes: { from: obj.from, to: obj.to }, selection: { anchor: obj.from }, effects: setFrame.of(null), scrollIntoView: true, userEvent });
    return;
  }
  const { changes, caret } = removalOf(state, obj, dir);
  view.dispatch({ changes, selection: { anchor: caret }, effects: setFrame.of(null), scrollIntoView: true, userEvent });
}

/** The object Backspace (-1) or Delete (1) at `at` would reach: one that ends or starts there, or a block on the line before or after. */
export function objectBeside(state: EditorState, at: number, dir: -1 | 1): PageObject | null {
  const touching = objectAt(state, at, dir);
  if (touching) return touching;
  const line = state.doc.lineAt(at);
  const across = dir < 0 ? (at === line.from && at > 0 ? objectAt(state, at - 1, -1) : null) : (at === line.to && at < state.doc.length ? objectAt(state, at + 1, 1) : null);
  return across && objectKind(state, across.kind)?.block ? across : null;
}

/**
 * Backspace (-1) or Delete (1) in a document, before doc mode's own rules: a
 * framed object goes on a new press and holds against a held key, then the
 * delete handlers run, then a block object beside the caret frames and an
 * inline one goes. False when none of them applies.
 */
export function deleteObject(view: EditorView, dir: -1 | 1, event: KeyboardEvent | null): boolean {
  const { state } = view;
  const frame = state.field(objectFrame, false);
  if (frame) {
    if (!event?.repeat) removeObject(view, frame, dir);
    return true;
  }
  if (runDeleteHandlers(view, dir, event)) return true;
  const { main } = state.selection;
  if (frame === undefined || !main.empty || state.selection.ranges.length > 1) return false;
  const obj = objectBeside(state, main.head, dir);
  if (!obj) return false;
  if (objectKind(state, obj.kind)?.block) view.dispatch({ effects: setFrame.of(obj), scrollIntoView: true });
  else removeObject(view, obj, dir);
  return true;
}

const keyEvents = new WeakMap<EditorView, KeyboardEvent>();

/** The press of `key` being handled right now, for commands, which CodeMirror runs without it. */
export function currentKeyEvent(view: EditorView, key: string): KeyboardEvent | null {
  const event = keyEvents.get(view);
  return event && event.key === key ? event : null;
}

/** Moves focus to the framed object's bar. */
export function focusObjectBar(view: EditorView): boolean {
  if (!view.state.field(objectFrame, false)) return false;
  const button = view.dom.closest('.opal-editor')?.querySelector<HTMLElement>('[data-object-bar] [tabindex="0"]');
  button?.focus();
  return Boolean(button);
}

const MODIFIERS = new Set(['Shift', 'Meta', 'Alt', 'Control', 'CapsLock', 'Fn']);

/** A key while an object is framed. True when the frame took it. */
function frameKey(view: EditorView, frame: PageObject, event: KeyboardEvent): boolean {
  const kind = objectKind(view.state, frame.kind);
  const clear = () => view.dispatch({ effects: setFrame.of(null) });
  const command = event.metaKey || event.ctrlKey;
  const take = () => {
    event.preventDefault();
    return true;
  };
  if (MODIFIERS.has(event.key)) return false;
  if (kind?.onKey?.(view, frame, event)) return take();
  if ((event.key === 'Backspace' || event.key === 'Delete') && !command && !event.altKey) {
    deleteObject(view, event.key === 'Delete' ? 1 : -1, event);
    return take();
  }
  // Option+F10, or ⌃⌥T, whose key on a Mac reads "†".
  if ((event.key === 'F10' && event.altKey) || (event.ctrlKey && event.altKey && (event.code === 'KeyT' || event.keyCode === 84 || event.key.toLowerCase() === 't'))) {
    return focusObjectBar(view) ? take() : false;
  }
  if (command && /^[cx]$/i.test(event.key)) return false;
  if (event.key === 'Enter' && !command) {
    clear();
    kind?.open(view, frame);
    return take();
  }
  if ((event.key === ' ' && !command) || event.key === 'Tab') return take();
  if (event.key === 'Escape') {
    clear();
    return take();
  }
  // Arrows, typing and every other command go on from the caret.
  clear();
  return false;
}

const clearOnInput = (_event: Event, view: EditorView) => {
  if (view.state.field(objectFrame, false)) view.dispatch({ effects: setFrame.of(null) });
  return false;
};

/** Copies the framed object's Markdown; a cut also takes the object out. */
function copyFrame(cut: boolean) {
  return (event: ClipboardEvent, view: EditorView) => {
    const frame = view.state.field(objectFrame, false);
    if (!frame || !event.clipboardData) return false;
    event.clipboardData.setData('text/plain', view.state.sliceDoc(frame.from, frame.to));
    event.preventDefault();
    if (cut) removeObject(view, frame, -1, 'delete.cut');
    return true;
  };
}

const frameEvents = EditorView.domEventHandlers({
  keydown(event, view) {
    keyEvents.set(view, event);
    queueMicrotask(() => { if (keyEvents.get(view) === event) keyEvents.delete(view); });
    const frame = view.state.field(objectFrame, false);
    return frame ? frameKey(view, frame, event) : false;
  },
  // A click on a widget that marks itself `data-object` frames its object; a double-click opens it.
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const element = event.target.closest('[data-object]');
    if (!element || !view.contentDOM.contains(element)) return false;
    const obj = objectAt(view.state, view.posAtDOM(element), 1) ?? objectAt(view.state, view.posAtDOM(element), 0);
    if (!obj) return false;
    event.preventDefault();
    view.dispatch({ effects: setFrame.of(event.detail >= 2 ? null : obj) });
    if (event.detail >= 2) objectKind(view.state, obj.kind)?.open(view, obj);
    view.focus();
    return true;
  },
  copy: copyFrame(false),
  cut: copyFrame(true),
  paste: clearOnInput,
  drop: clearOnInput,
  compositionstart: clearOnInput,
});

/** The frame, its look, and its keys and clicks, ahead of every other handler. */
export const objectFrameExtension: Extension = [objectFrame, frameMarks, blockWidgetFrame, Prec.highest(frameEvents)];
