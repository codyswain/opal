import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { classifyFile, pageName } from '@/common/fileKind';
import { basenameFsPath, isFsPathAtOrBelow } from '@/common/fsPaths';
import type { FilesResult, ImportedFile } from '@/types/files';
import { useDiskStore } from '../../store/diskStore';
import { draggedTreeFile } from '../dragMoveState';
import { vaultRelativePath } from '../tabLabels';
import { insertItems } from './extensionPoints';
import { embedWidth } from './imageSize';
import { linksResolved, pageContext } from './wikiLinks';

/*
 * Files put into a page: dropped from Finder, a browser or Photos, pasted,
 * or picked with the toolbar's Image button. Each is stored in the files
 * folder first, then goes in on a line of its own, an image as an embed with
 * a width and any other file as a link, by its path from the vault's top.
 * Each insert is its own undo step, and its link counts as resolved at once.
 * A row dragged from the tree is linked where it is.
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
}

const setPlace = StateEffect.define<{ id: number; place: Place | null }>();

const places = StateField.define<ReadonlyMap<number, Place>>({
  create: () => new Map(),
  update(value, tr) {
    const map = (at: number) => tr.changes.mapPos(at, -1);
    let next = value.size > 0 && tr.docChanged
      ? new Map([...value].map(([id, { at, caret }]) => [id, { at: map(at), caret: caret === null ? null : map(caret) }]))
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

function holdPlace(view: EditorView, at: number): number {
  const id = ++lastPlace;
  view.dispatch({ effects: setPlace.of({ id, place: { at, caret: view.state.selection.main.head } }) });
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

/**
 * Puts a stored file in at its import's place and moves the place past it.
 * The caret goes after it only if it has stayed where it was, so typing
 * meanwhile carries on undisturbed. Nothing once the page has closed: the
 * file stays.
 */
async function putFile(view: EditorView, id: number, file: ImportedFile, userEvent: InsertEvent): Promise<void> {
  if (file.warning) toast(file.warning);
  const image = !file.url && classifyFile(file.path) === 'image';
  const width = image ? await widthFor(view, file.path) : null;
  const place = view.dom.isConnected ? view.state.field(places).get(id) : undefined;
  if (!place) return;
  // A dropped .webloc or .url stored nothing: it links to the address it holds.
  const embed = file.url
    ? `[${file.name.replace(/[\\[\]*|]/g, '\\$&')}](${/[\s()]/.test(file.url) ? `<${file.url}>` : file.url})`
    : image ? `![[${file.vaultPath}${width ? `|${width}` : ''}]]` : `[[${file.vaultPath}|${file.name.replace(/[[\]|]/g, '')}]]`;
  const { from, insert } = placeEmbed(view.state, place.at, embed);
  const end = from + insert.length;
  const follow = view.state.selection.main.head === place.caret;
  view.dispatch({
    changes: { from, insert },
    selection: follow ? { anchor: end } : undefined,
    effects: [...(file.url ? [] : [linksResolved.of({ [file.vaultPath]: file.path })]), setPlace.of({ id, place: { at: end, caret: follow ? end : null } })],
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
    userEvent,
  });
}

/** Stores each file in order and puts it in after the line holding `at`. One that fails, or is over 100 MB, is skipped with its reason. */
export async function addFiles(view: EditorView, files: readonly File[], at: number, userEvent: InsertEvent): Promise<void> {
  const page = view.state.facet(pageContext).path;
  const id = holdPlace(view, at);
  for (const file of files) {
    const stored: FilesResult<ImportedFile> = await window.filesAPI.import(page, file)
      .catch(() => ({ success: false as const, error: `"${file.name}" could not be added.` }));
    if (stored.success) await putFile(view, id, stored.data, userEvent);
    else toast.error(stored.error);
  }
  letGo(view, id);
}

/** The toolbar's Image button: the images picked in the open dialog, after the caret's line. */
export async function addPickedImages(view: EditorView): Promise<void> {
  const id = holdPlace(view, view.state.doc.lineAt(view.state.selection.main.head).to);
  const picked = await window.filesAPI.pickAndImport(view.state.facet(pageContext).path);
  if (picked.success) {
    for (const file of picked.data.files) await putFile(view, id, file, 'input');
    for (const message of picked.data.skipped) toast.error(message);
  } else {
    toast.error(picked.error);
  }
  letGo(view, id);
}

/** A tree row dropped on the page: a link to its file by its path from the vault's top. Nothing is copied. */
function linkFile(view: EditorView, path: string, at: number): void {
  const root = useDiskStore.getState().roots.filter((candidate) => isFsPathAtOrBelow(candidate, path)).sort((a, b) => a.length - b.length)[0];
  if (!root) return;
  const relative = vaultRelativePath(path, [root]);
  // A note goes by its name, as [[Name]] does; a document keeps ".mdo".
  const target = relative.endsWith('.md') ? relative.slice(0, -3) : relative;
  const name = classifyFile(path) === 'markdown' ? pageName(basenameFsPath(path)) : basenameFsPath(path);
  const { from, insert } = placeEmbed(view.state, at, `[[${target}|${name.replace(/[[\]|]/g, '')}]]`);
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
      if (row) linkFile(view, row, lineAt(event));
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
    void addFiles(view, added, view.state.doc.lineAt(view.state.selection.main.head).to, 'input.paste');
    return true;
  },
});

export const fileInserts: Extension = [places, dropLine, fileDrops, filePaste];

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
