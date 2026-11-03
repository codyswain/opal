import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { ImagePlus, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { classifyFile, pageName, withoutHash } from '@/common/fileKind';
import { basenameFsPath, isFsPathAtOrBelow } from '@/common/fsPaths';
import type { FilesResult, ImportedFile } from '@/types/files';
import { useDiskStore } from '../../store/diskStore';
import { draggedTreeFile } from '../dragMoveState';
import { vaultRelativePath } from '../tabLabels';
import { insertItems } from './extensionPoints';
import { WIKI_UNSAFE, escapeLinkText, linkFor, wikiAlias } from './fileActions';
import { inCode, inTableAt } from './fileEmbeds';
import { embedWidth } from './imageSize';
import { linksResolved, pageContext } from './wikiLinks';

/*
 * Files put into a page: dropped from Finder, a browser or Photos, pasted,
 * or picked with Insert > Image… or File…. Each is stored in the files
 * folder first, with a placeholder where it goes, then goes in by its path
 * from the vault's top: inside text as a chip, on a line of its own in its
 * type's look (a preview for pictures, PDF, video and audio, a card
 * otherwise). Each insert is its own undo step, and its link counts as
 * resolved at once. A row dragged from the tree is linked where it is.
 */

const hasText = (text: string) => /[^\s>]/.test(text);
// The quote marks that open a line, with the space after each.
const QUOTE = /^(?:[ \t]*>[ \t]?)*/;

/**
 * Where `embed` goes to sit on a line of its own after the line holding
 * `at`, and the text that puts it there. In a quote the line keeps its ">",
 * and under a list item it lines up with the item's text. In a table or
 * code block it goes after the block, and after a table a blank line first,
 * since a line right under a table is one of its rows. An empty line takes
 * the embed itself.
 */
export function placeEmbed(state: EditorState, at: number, embed: string): { from: number; insert: string } {
  const { doc } = state;
  let line = doc.lineAt(at);
  // The line whose indent or list item the embed lines up with.
  let under = line.text;
  let table = false;
  const textFrom = line.from + (/^[\s>]*/.exec(line.text)?.[0].length ?? 0);
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(textFrom, 1); node; node = node.parent) {
    if (node.name === 'Table' || node.name === 'FencedCode' || node.name === 'CodeBlock') {
      line = doc.lineAt(Math.max(node.from, node.to - 1));
      under = line.text;
      table = node.name === 'Table';
      // An indented code block's own indent would make the embed code: it lines up with the list item holding the block, or the left edge.
      if (node.name === 'CodeBlock') {
        let item = node.parent;
        while (item && item.name !== 'ListItem') item = item.parent;
        under = item ? doc.lineAt(item.from).text : '';
      }
      break;
    }
  }
  if (!hasText(line.text)) return { from: line.to, insert: embed };
  const quote = QUOTE.exec(line.text)?.[0] ?? '';
  const rest = under.slice(QUOTE.exec(under)?.[0].length ?? 0);
  const item = table ? undefined : /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.exec(rest)?.[0];
  const indent = item ? ' '.repeat(item.length) : /^[ \t]*/.exec(rest)?.[0] ?? '';
  return { from: line.to, insert: `${table ? `\n${quote.trimEnd()}` : ''}\n${quote}${indent}${embed}` };
}

/**
 * Where an import still under way puts its files, kept in step with edits
 * made meanwhile, and where the caret was when it began, while it is still
 * there. Text typed at the place stays after it, so the files go after the
 * line they were put on.
 */
interface Place {
  at: number;
  caret: number | null;
  /** Where a chip goes inside text, or null for a line of its own. */
  inline: number | null;
}

const setPlace = StateEffect.define<{ id: number; place: Place | null }>();

const places = StateField.define<ReadonlyMap<number, Place>>({
  create: () => new Map(),
  update(value, tr) {
    const map = (at: number) => tr.changes.mapPos(at, -1);
    let next = value.size > 0 && tr.docChanged
      ? new Map([...value].map(([id, { at, caret, inline }]) => [id, { at: map(at), caret: caret === null ? null : map(caret), inline: inline === null ? null : map(inline) }]))
      : value;
    for (const effect of tr.effects) {
      if (!effect.is(setPlace)) continue;
      const changed = new Map(next);
      if (effect.value.place === null) changed.delete(effect.value.id);
      else changed.set(effect.value.id, effect.value.place);
      next = changed;
    }
    return next;
  },
});

let lastPlace = 0;

function holdPlace(view: EditorView, at: number, inline: number | null = null): number {
  const id = ++lastPlace;
  view.dispatch({ effects: setPlace.of({ id, place: { at, caret: view.state.selection.main.head, inline } }) });
  return id;
}

function letGo(view: EditorView, id: number): void {
  if (view.dom.isConnected) view.dispatch({ effects: setPlace.of({ id, place: null }) });
}

/**
 * A width that keeps a stored picture within the column and one screen
 * height, or null when its size can't be read. The main process reads the
 * size from the file's first bytes (files:info); the page can't fetch them.
 */
async function widthFor(view: EditorView, path: string): Promise<number | null> {
  try {
    const info = await window.filesAPI.info(path);
    const size = info.success && info.data.width && info.data.height
      ? { width: info.data.width, height: info.data.height, retina: info.data.retina ?? false }
      : null;
    if (!size) return null;
    const style = getComputedStyle(view.contentDOM);
    const column = view.contentDOM.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return embedWidth(size, { width: column, height: Math.min(window.innerHeight, view.scrollDOM.clientHeight) });
  } catch {
    return null;
  }
}

type InsertEvent = 'input' | 'input.drop' | 'input.paste';

/** How a stored file goes in: a chip at the caret, the type's default look on a line of its own, or a card. */
export type InsertLook = 'chip' | 'default' | 'card';

/**
 * The Markdown for a file put on a page. The default look embeds images,
 * PDF, video and audio as previews, pictures and video with a width and the
 * others with their name, and links anything else as a card. A chip and a
 * card are a link with the file's name. A dropped `.webloc` or `.url` is a
 * link to its address.
 */
export function insertedText(file: Pick<ImportedFile, 'path' | 'vaultPath' | 'name' | 'url'>, page: string, look: InsertLook, width: number | null, inTable = false): string {
  // A dropped .webloc or .url stored nothing: it links to the address it holds.
  if (file.url) return `[${escapeLinkText(file.name.replace(/\.(webloc|url)$/i, ''), inTable)}](${/[\s()]/.test(file.url) ? `<${file.url}>` : file.url})`;
  const kind = classifyFile(file.path);
  const sized = kind === 'image' || kind === 'video';
  if (look === 'default' && (sized || kind === 'pdf' || kind === 'audio')) {
    return linkFor({ vaultPath: file.vaultPath, path: file.path, page, embed: true, slot: sized ? (width ? String(width) : null) : file.name, inTable });
  }
  return linkFor({ vaultPath: file.vaultPath, path: file.path, page, embed: false, slot: file.name, inTable });
}

/** A chip at `at` inside text, with a space between it and a word it would touch. */
function chipAt(state: EditorState, at: number, chip: string): { from: number; insert: string } {
  const before = state.sliceDoc(Math.max(0, at - 1), at);
  const after = state.sliceDoc(at, at + 1);
  return { from: at, insert: `${before && /\S/.test(before) ? ' ' : ''}${chip}${after && /[^\s.,;:!?)\]]/.test(after) ? ' ' : ''}` };
}

/**
 * Puts a stored file in at its import's place and moves the place past it.
 * The caret goes after it only if it has stayed where it was, so typing
 * meanwhile carries on undisturbed. Nothing once the page has closed: the
 * file stays.
 */
async function putFile(view: EditorView, id: number, file: ImportedFile, userEvent: InsertEvent, look: InsertLook = 'default'): Promise<void> {
  const kind = classifyFile(file.path);
  const sized = !file.url && look === 'default' && (kind === 'image' || kind === 'video');
  const width = sized ? await widthFor(view, file.path) : null;
  const place = view.dom.isConnected ? view.state.field(places).get(id) : undefined;
  if (!place) return;
  const page = view.state.facet(pageContext).path;
  const inline = place.inline !== null && look === 'chip';
  const text = insertedText(file, page, inline ? 'chip' : look, width, inline && place.inline !== null && inTableAt(view.state, place.inline));
  const { from, insert } = inline && place.inline !== null ? chipAt(view.state, place.inline, text) : placeEmbed(view.state, place.at, text);
  const end = from + insert.length;
  const follow = view.state.selection.main.head === place.caret;
  view.dispatch({
    changes: { from, insert },
    selection: follow ? { anchor: end } : undefined,
    effects: [
      ...(file.url ? [] : [linksResolved.of({ [file.vaultPath]: file.path })]),
      setPlace.of({ id, place: inline ? { at: place.at + (from <= place.at ? insert.length : 0), caret: follow ? end : null, inline: end } : { at: end, caret: follow ? end : null, inline: null } }),
    ],
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
    userEvent,
  });
  if (file.warning) toast(file.warning);
}

// Over three files that are not pictures go in as cards, so a page doesn't fill with previews.
const CARDS_OVER = 3;

/**
 * The look each of `files` takes: one file at a caret in text is a chip,
 * except a picture, which goes on its own line to be seen; more than three
 * files that are not pictures are cards.
 */
function looksFor(files: readonly { name: string }[], inline: boolean): InsertLook[] {
  const picture = (file: { name: string }) => classifyFile(file.name) === 'image';
  const others = files.filter((file) => !picture(file)).length;
  return files.map((file) => {
    if (picture(file)) return 'default';
    if (inline && files.length === 1) return 'chip';
    return others > CARDS_OVER ? 'card' : 'default';
  });
}

/** A file being stored, drawn where it will go until it is in, or as an error card with Retry and Remove. */
interface Pending {
  at: number;
  name: string;
  look: InsertLook;
  failed: string | null;
  retry: () => void;
}

const setPending = StateEffect.define<{ id: number; pending: Pending | null }>();

const pendingFiles = StateField.define<ReadonlyMap<number, Pending>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value.size > 0 && tr.docChanged
      ? new Map([...value].map(([id, pending]) => [id, { ...pending, at: tr.changes.mapPos(pending.at, 1) }]))
      : value;
    for (const effect of tr.effects) {
      if (!effect.is(setPending)) continue;
      const changed = new Map(next);
      if (effect.value.pending === null) changed.delete(effect.value.id);
      else changed.set(effect.value.id, effect.value.pending);
      next = changed;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (pending) => Decoration.set([...pending].map(([id, file]) =>
    Decoration.widget({ widget: new PendingWidget(id, file), block: true, side: 1 }).range(file.at)), true)),
});

/** The height a file's look will have, so the page doesn't jump when it lands. */
function pendingHeight(name: string, look: InsertLook): number {
  const kind = classifyFile(name);
  if (look !== 'default') return 64;
  if (kind === 'image' || kind === 'video') return 160;
  if (kind === 'pdf') return 401;
  if (kind === 'audio') return 56;
  return 64;
}

class PendingWidget extends WidgetType {
  constructor(readonly id: number, readonly file: Pending) { super(); }

  eq(other: PendingWidget) {
    return other.id === this.id && other.file.failed === this.file.failed && other.file.name === this.file.name;
  }

  toDOM(view: EditorView) {
    const box = document.createElement('div');
    box.className = 'cm-file-pending';
    const card = document.createElement('span');
    card.className = 'cm-file-card';
    card.dataset.state = this.file.failed ? 'failed' : 'adding';
    const body = document.createElement('span');
    body.className = 'cm-file-card-body';
    const name = document.createElement('span');
    name.className = 'cm-file-card-name';
    name.textContent = this.file.failed ? this.file.name : `Adding ${this.file.name}…`;
    const meta = document.createElement('span');
    meta.className = 'cm-file-card-meta';
    meta.textContent = this.file.failed ?? 'Storing in Library/files';
    body.append(name, meta);
    card.append(body);
    if (this.file.failed) {
      const actions = document.createElement('span');
      actions.className = 'cm-file-card-actions';
      const control = (label: string, run: () => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cm-file-button';
        button.textContent = label;
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', run);
        return button;
      };
      actions.append(
        control('Retry', () => this.file.retry()),
        control('Remove', () => view.dispatch({ effects: setPending.of({ id: this.id, pending: null }) })),
      );
      card.append(actions);
    } else {
      box.style.minHeight = `${pendingHeight(this.file.name, this.file.look)}px`;
    }
    box.append(card);
    return box;
  }

  ignoreEvent() { return true; }
}

let lastPending = 0;

/** Stores one file with a placeholder where it goes; a failure leaves an error card that can try again. */
async function storeOne(view: EditorView, id: number, file: File, look: InsertLook, userEvent: InsertEvent): Promise<void> {
  const page = view.state.facet(pageContext).path;
  const pending = ++lastPending;
  const at = () => {
    const place = view.state.field(places).get(id);
    return place ? placeEmbed(view.state, place.at, '').from : view.state.doc.length;
  };
  const attempt = async (): Promise<void> => {
    if (!view.dom.isConnected) return;
    view.dispatch({ effects: setPending.of({ id: pending, pending: { at: at(), name: file.name, look, failed: null, retry: () => undefined } }) });
    const stored: FilesResult<ImportedFile> = await window.filesAPI.import(page, file)
      .catch(() => ({ success: false as const, error: `"${file.name}" could not be added.` }));
    if (!view.dom.isConnected) return;
    if (stored.success) {
      view.dispatch({ effects: setPending.of({ id: pending, pending: null }) });
      await putFile(view, id, stored.data, userEvent, look);
      return;
    }
    toast.error(stored.error);
    const failed: Pending = { at: at(), name: file.name, look, failed: stored.error, retry: () => {
      // A retry goes where the error card is.
      const kept = holdPlace(view, view.state.field(pendingFiles).get(pending)?.at ?? at(), null);
      view.dispatch({ effects: setPending.of({ id: pending, pending: null }) });
      void storeOne(view, kept, file, look, userEvent).then(() => letGo(view, kept));
    } };
    view.dispatch({ effects: setPending.of({ id: pending, pending: failed }) });
  };
  await attempt();
}

/**
 * Stores each file in order and puts it in after the line holding `at`, or
 * as a chip at `inline` when one file goes in from inside text. More than
 * three files that are not pictures go in as cards. One that fails leaves
 * an error card with Retry and Remove.
 */
export async function addFiles(view: EditorView, files: readonly File[], at: number, userEvent: InsertEvent, inline: number | null = null): Promise<void> {
  const id = holdPlace(view, at, files.length === 1 ? inline : null);
  const looks = looksFor(files, inline !== null);
  for (const [index, file] of files.entries()) await storeOne(view, id, file, looks[index], userEvent);
  letGo(view, id);
}

/**
 * Where a caret at `head` puts one file: inside text, a chip there; on an
 * empty line, or in code or a formula, null, for a line of its own after it.
 */
export function caretInText(state: EditorState, head: number): number | null {
  const line = state.doc.lineAt(head);
  return hasText(line.text) && !inCode(state, head) ? head : null;
}

/** Insert > Image… and Insert > File…: the files picked in the open dialog, at the caret. */
export async function addPickedFiles(view: EditorView, anyType = false): Promise<void> {
  const head = view.state.selection.main.head;
  const page = view.state.facet(pageContext).path;
  const picked = await (anyType ? window.filesAPI.pickAndImport(page, { anyType: true }) : window.filesAPI.pickAndImport(page));
  if (!picked.success) {
    toast.error(picked.error);
    return;
  }
  const { files } = picked.data;
  const inline = files.length === 1 && anyType ? caretInText(view.state, head) : null;
  const id = holdPlace(view, view.state.doc.lineAt(head).to, inline);
  const looks = looksFor(files.map((file) => ({ name: file.path || file.name })), inline !== null);
  for (const [index, file] of files.entries()) await putFile(view, id, file, 'input', looks[index]);
  for (const message of picked.data.skipped) toast.error(message);
  letGo(view, id);
}

/** The toolbar's Image button: the images picked in the open dialog, after the caret's line. */
export async function addPickedImages(view: EditorView): Promise<void> {
  await addPickedFiles(view, false);
}

/**
 * A tree row dropped on the page: a note as a link by its name, any other
 * file in its type's look (a preview for pictures, PDF, video and audio, a
 * card otherwise), by its path from the vault's top. Nothing is copied.
 */
async function linkFile(view: EditorView, path: string, at: number): Promise<void> {
  const root = useDiskStore.getState().roots.filter((candidate) => isFsPathAtOrBelow(candidate, path)).sort((a, b) => a.length - b.length)[0];
  if (!root) return;
  const relative = vaultRelativePath(path, [root]);
  const kind = classifyFile(path);
  let text: string;
  let target = relative;
  if (kind === 'markdown') {
    // A note goes by its name, as [[Name]] does; a document keeps ".mdo".
    target = relative.endsWith('.md') ? relative.slice(0, -3) : relative;
    const name = pageName(basenameFsPath(path));
    text = WIKI_UNSAFE.test(target)
      ? linkFor({ vaultPath: relative, path, page: view.state.facet(pageContext).path, embed: false, slot: name })
      : `[[${target}|${wikiAlias(name)}]]`;
  } else {
    const sized = kind === 'image' || kind === 'video';
    const width = sized ? await widthFor(view, path) : null;
    text = insertedText({ path, vaultPath: relative, name: withoutHash(basenameFsPath(path)) }, view.state.facet(pageContext).path, 'default', width);
  }
  if (!view.dom.isConnected) return;
  const { from, insert } = placeEmbed(view.state, Math.min(at, view.state.doc.length), text);
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length },
    effects: linksResolved.of({ [target]: path }),
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
    userEvent: 'input.drop',
  });
}

/**
 * The end of the line a drop at `height`, from the document's top, goes
 * after: the nearer edge of `block`, the line or drawn block there, then up
 * past blank lines to text. Above the first line it goes after that line.
 */
export function dropAfter(state: EditorState, block: { from: number; to: number; top: number; bottom: number }, height: number): number {
  const { doc } = state;
  const below = height > (block.top + block.bottom) / 2 || block.from === 0;
  let line = doc.lineAt(below ? block.to : block.from - 1);
  while (line.number > 1 && !hasText(line.text)) line = doc.line(line.number - 1);
  return line.to;
}

const setDropLine = StateEffect.define<number | null>();

class DropLineWidget extends WidgetType {
  eq() { return true; }

  toDOM() {
    const line = document.createElement('div');
    line.className = 'cm-md-drop-line';
    return line;
  }
}

const dropLineDecoration = Decoration.widget({ widget: new DropLineWidget(), block: true, side: 1 });

/** Where the line shows that marks the drop's place, while files or a tree row are dragged over the page. */
const dropLine = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setDropLine)) return effect.value;
    return value === null ? value : tr.changes.mapPos(value, 1);
  },
  provide: (field) => EditorView.decorations.from(field, (at) => (at === null ? Decoration.none : Decoration.set(dropLineDecoration.range(at)))),
});

/**
 * Files dragged from Finder, a browser or Photos, and rows dragged from the
 * tree. A line shows where they will go; a drop stores the files and puts
 * them there, or links the row's file. The listeners sit on the whole
 * editor and run first, so a drop beside the column counts and CodeMirror
 * never reads a dropped file in as text. Text dragged within the page is
 * left to CodeMirror, which moves it.
 */
const fileDrops = ViewPlugin.define((view) => {
  const carriesFiles = (event: DragEvent) =>
    !view.state.readOnly && Boolean(event.dataTransfer?.types.includes('Files') || draggedTreeFile());
  const lineAt = (event: DragEvent) =>
    dropAfter(view.state, view.lineBlockAtHeight(event.clientY - view.documentTop), event.clientY - view.documentTop);
  const show = (at: number | null) => {
    if (view.state.field(dropLine) !== at) view.dispatch({ effects: setDropLine.of(at) });
  };
  const listeners: Record<'dragover' | 'dragleave' | 'drop', (event: DragEvent) => void> = {
    dragover(event) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      show(placeEmbed(view.state, lineAt(event), '').from);
    },
    dragleave(event) {
      if (!(event.relatedTarget instanceof Node && view.dom.contains(event.relatedTarget))) show(null);
    },
    drop(event) {
      show(null);
      const row = draggedTreeFile();
      const files = [...(event.dataTransfer?.files ?? [])];
      if (!carriesFiles(event) || (!row && files.length === 0)) return;
      event.preventDefault();
      if (row) void linkFile(view, row, lineAt(event));
      else void addFiles(view, files, lineAt(event), 'input.drop');
      view.focus();
    },
  };
  const entries = Object.entries(listeners) as [string, EventListener][];
  for (const [type, listener] of entries) view.dom.addEventListener(type, listener, true);
  return { destroy: () => { for (const [type, listener] of entries) view.dom.removeEventListener(type, listener, true); } };
});

/**
 * A paste that holds files. Files copied in Finder are stored, even though
 * Finder puts their names on the clipboard as text too. Otherwise text
 * pastes as text, so the picture of the copied text that Word, Excel and web
 * pages add is left out, and a clipboard holding only a picture, as after a
 * screenshot, stores the picture. All go after the caret's line.
 */
const filePaste = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData;
    const files = data ? [...data.files] : [];
    if (!data || files.length === 0 || view.state.readOnly) return false;
    const copied = files.filter((file) => window.filesAPI.hasPath(file));
    const added = copied.length > 0 ? copied : data.getData('text/plain') ? [] : files;
    if (added.length === 0) return false;
    const { head } = view.state.selection.main;
    void addFiles(view, added, view.state.doc.lineAt(head).to, 'input.paste', caretInText(view.state, head));
    return true;
  },
});

export const fileInserts: Extension = [places, pendingFiles, dropLine, fileDrops, filePaste];

/** Insert > Image…: the system picker, then the picked images at the caret. */
export const insertImageItem = insertItems.of({
  id: 'image',
  label: 'Image…',
  icon: ImagePlus,
  order: 0,
  run: async (view) => {
    await addPickedImages(view);
    view.focus();
  },
});

/** Insert > File…: the system picker for any type, then the file at the caret: a chip in text, its look on an empty line. */
export const insertFileItem = insertItems.of({
  id: 'file',
  label: 'File…',
  icon: Paperclip,
  order: 1,
  run: async (view) => {
    await addPickedFiles(view, true);
    view.focus();
  },
});
