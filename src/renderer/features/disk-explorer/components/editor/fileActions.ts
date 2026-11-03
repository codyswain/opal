import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { toast } from 'sonner';
import { storedExtension, withoutHash } from '@/common/fileKind';
import { basenameFsPath, isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import type { FileInfo } from '@/types/files';
import { useDiskStore } from '../../store/diskStore';
import { openPdfAtPage } from '../FileViewer';
import { vaultRelativePath } from '../tabLabels';
import { setLinkEditor } from './linkEditorEffect';
import { objectAt, type ObjectAction, type PageObject } from './extensionPoints';
import {
  FILE_NODES,
  PREVIEWED,
  appFor,
  captionOf,
  fileInfo,
  fileName,
  fileRefOf,
  forgetInfo,
  formatBytes,
  fragmentValue,
  isSize,
  kindLabel,
  knownApp,
  knownInfo,
  lookOf,
  shownName,
  slotWidth,
  webPictureOf,
  type FileRef,
  type WebPicture,
} from './fileEmbeds';
import { widthChange } from './imageFrame';
import { embedWidth } from './imageSize';
import { docMode } from './livePreview';
import { fileChanged } from './previewWidgets';
import { removeObject, setFrame } from './objectFrame';
import { linksResolved, pageContext, resolvedLinks } from './wikiLinks';

/*
 * The bar's items for a file on the page, and the Markdown they write. The
 * bar leads with where the file points, then the main action for its type,
 * then Show as, Size and More. Every write is one undo step and changes
 * only its own link. A name goes after a link's "|" only for files that are
 * not pictures or video; those hold a size.
 */

/** The file link inside `obj`, or the one that starts where `obj` does. */
export function refAt(state: EditorState, obj: Pick<PageObject, 'from' | 'to'>): FileRef | null {
  const links = state.field(resolvedLinks, false) ?? new Map<string, string | null>();
  const page = state.facet(pageContext).path;
  const found: FileRef[] = [];
  syntaxTree(state).iterate({
    from: obj.from,
    to: Math.max(obj.to, obj.from),
    enter: (node) => {
      if (!FILE_NODES.includes(node.name)) return;
      const ref = fileRefOf(state, node.node, links, page);
      if (ref) found.push(ref);
      return false;
    },
  });
  return found.find((ref) => ref.from === obj.from) ?? found.find((ref) => ref.from >= obj.from && ref.to <= Math.max(obj.to, ref.from)) ?? found[0] ?? null;
}

// Names that can't go inside a wiki link: its target can't hold these, nor its alias brackets.
export const WIKI_UNSAFE = /[#|[\]^]/;

/** Text for a Markdown link's brackets: backslashes, brackets, stars and underscores escaped, and a pipe inside a table. */
export function escapeLinkText(text: string, inTable = false): string {
  const escaped = text.replace(/[\\[\]*_`]/g, (char) => `\\${char}`);
  return inTable ? escaped.replace(/\|/g, '\\|') : escaped;
}

/** A wiki link's alias: no brackets, and a pipe written `\|` in a table, where it would end the cell. */
export function wikiAlias(name: string, inTable = false): string {
  const clean = name.replace(/\]\]/g, ']').replace(/[[\]]/g, '').replace(/\n/g, ' ');
  return inTable ? clean.replace(/\|/g, '\\|') : clean.replace(/\|/g, '-');
}

/**
 * A path as a Markdown address in angle brackets: `%` first as `%25`, then
 * `#` as `%23`, `<` and `>` as `%3C` and `%3E`, since the Markdown parser
 * ends the brackets at the first `>` even after a backslash, and `|` as
 * `%7C`, which would end a table cell. Readers decode each segment.
 */
export function encodeAddress(path: string): string {
  return `<${path.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\|/g, '%7C')}>`;
}

/** `to` from the folder holding `from`, as "../files/x.pdf". */
export function relativePath(fromFile: string, to: string): string {
  const base = (parentFsPath(fromFile) ?? '').split('/').filter(Boolean);
  const target = to.split('/').filter(Boolean);
  let shared = 0;
  while (shared < base.length && shared < target.length - 1 && base[shared] === target[shared]) shared += 1;
  return [...base.slice(shared).map(() => '..'), ...target.slice(shared)].join('/');
}

/** A file's path from the top of the vault that holds it. */
export function vaultPathOf(path: string): string {
  const roots = useDiskStore.getState().roots.filter((root) => isFsPathAtOrBelow(root, path)).sort((a, b) => b.length - a.length);
  return roots[0] ? vaultRelativePath(path, [roots[0]]) : path;
}

export interface LinkSpec {
  /** The file's path from the vault's top. */
  vaultPath: string;
  /** Absolute, for a Markdown-form link relative to the page. */
  path: string;
  /** The page the link is written on. */
  page: string;
  embed: boolean;
  /** A size for pictures and video, or a name. */
  slot?: string | null;
  inTable?: boolean;
}

/**
 * A link to a file as Opal writes it: `[[path|Name]]` or `![[path|640]]`,
 * or `[Name](<path>)` and `![Name](<path>)` relative to the page when the
 * path holds a character a wiki link can't, or the name a bracket, which
 * Markdown link text keeps escaped.
 */
export function linkFor(spec: LinkSpec): string {
  const bang = spec.embed ? '!' : '';
  const slot = spec.slot ?? null;
  const bracketed = slot !== null && !isSize(slot) && /[[\]]/.test(slot);
  if (!WIKI_UNSAFE.test(spec.vaultPath) && !bracketed) {
    const bar = spec.inTable ? '\\|' : '|';
    return `${bang}[[${spec.vaultPath}${slot !== null && slot !== '' ? `${bar}${isSize(slot) ? slot.trim() : wikiAlias(slot, spec.inTable)}` : ''}]]`;
  }
  const name = slot && !isSize(slot) ? slot : withoutHash(basenameFsPath(spec.path));
  const text = escapeLinkText(name, spec.inTable);
  const size = slot && isSize(slot) ? `${spec.inTable ? '\\|' : '|'}${slot.trim()}` : '';
  return `${bang}[${text}${size}](${encodeAddress(relativePath(spec.page, spec.path))})`;
}

/** The column's width in pixels, for Full width and the default size. */
function columnWidth(view: EditorView): number {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(view.contentDOM) : null;
  const width = view.contentDOM.clientWidth - parseFloat(style?.paddingLeft || '0') - parseFloat(style?.paddingRight || '0');
  return width > 0 ? Math.round(width) : 700;
}

/** The width a picture or video gets when it becomes a preview: its own width in points, within the column. */
export function defaultWidth(view: EditorView, info: FileInfo | null | undefined): number {
  const column = columnWidth(view);
  if (!info?.width || !info.height) return Math.min(column, 560);
  return embedWidth({ width: info.width, height: info.height, retina: info.retina ?? false }, { width: column, height: 0 });
}

/** Writes `insert` over `from` to `to` as one undo step, and keeps the file framed in a document. */
function write(view: EditorView, from: number, to: number, insert: string, userEvent = 'input.file'): void {
  const framed = view.state.facet(docMode);
  view.dispatch({ changes: { from, to, insert }, annotations: isolateHistory.of('full'), userEvent });
  if (!framed) return;
  const obj = objectAt(view.state, from, 1) ?? objectAt(view.state, from, 0);
  if (obj) view.dispatch({ effects: setFrame.of(obj) });
}

/** The target as written, with its heading or fragment, minus any of `drop` (such as "height"). */
function targetWithFragment(ref: FileRef, drop: readonly string[] = []): string {
  if (!ref.fragment) return ref.target;
  const kept = ref.fragment.split('&').filter((part) => !drop.includes(part.split('=')[0]));
  return kept.length > 0 ? `${ref.target}#${kept.join('&')}` : ref.target;
}

/** The address of a Markdown-form link, as written. */
const writtenAddress = (state: EditorState, ref: FileRef) =>
  ref.urlFrom !== null && ref.urlTo !== null ? state.sliceDoc(ref.urlFrom, ref.urlTo) : null;

/** The name a link shows, for writing it after "|" or in brackets: never one that reads as a size, never empty. */
function nameFor(ref: FileRef): string {
  const name = shownName(ref);
  return isSize(name) || !name.trim() ? fileName(ref) : name;
}

/**
 * Show as > Card: `[[path|Name]]`, dropping a size; a Markdown image becomes
 * a Markdown link with its alt text, or the file's name when that is empty.
 */
export function cardText(state: EditorState, ref: FileRef): string | null {
  if (ref.form === 'wiki' || ref.form === 'link') return state.sliceDoc(ref.from, ref.to);
  if (ref.form === 'embed') {
    return `[[${targetWithFragment(ref, ['height', 't'])}${ref.inTable ? '\\|' : '|'}${wikiAlias(nameFor(ref), ref.inTable)}]]`;
  }
  const address = writtenAddress(state, ref);
  if (!address) return null;
  const caption = captionOf(ref);
  return `[${caption ? escapeLinkText(caption, ref.inTable) : escapeLinkText(nameFor(ref), ref.inTable)}](${address})`;
}

/**
 * Show as > Preview: `![[path]]`, with a width for pictures and video and
 * the name for anything else, unless the name reads as a size, which an
 * embed would take as one; it is dropped and `dropped` names it. A Markdown
 * link becomes a Markdown image.
 */
export function previewText(state: EditorState, ref: FileRef, width: number | null): { text: string; dropped: string | null } | null {
  if (ref.form === 'embed' || ref.form === 'image') return { text: state.sliceDoc(ref.from, ref.to), dropped: null };
  const sized = ref.kind === 'image' || ref.kind === 'video';
  if (ref.form === 'link') {
    const address = writtenAddress(state, ref);
    if (!address) return null;
    const text = ref.text ?? '';
    return { text: `![${text}${sized && width ? `|${width}` : ''}](${address})`, dropped: null };
  }
  const bar = ref.inTable ? '\\|' : '|';
  if (sized) return { text: `![[${ref.target}${ref.fragment ? `#${ref.fragment}` : ''}${width ? `${bar}${width}` : ''}]]`, dropped: null };
  const slot = ref.slot?.trim() ?? '';
  const dropped = slot && isSize(slot) ? slot : null;
  const keep = slot && !dropped ? `${bar}${ref.slot}` : '';
  return { text: `![[${ref.target}${ref.fragment ? `#${ref.fragment}` : ''}${keep}]]`, dropped };
}

export async function showAs(view: EditorView, ref: FileRef, look: 'card' | 'preview'): Promise<void> {
  if (look === 'card') {
    const text = cardText(view.state, ref);
    if (text !== null) write(view, ref.from, ref.to, text);
    return;
  }
  const sized = ref.kind === 'image' || ref.kind === 'video';
  const width = sized && ref.path ? defaultWidth(view, await fileInfo(ref.path)) : null;
  const fresh = refAt(view.state, ref);
  if (!fresh || fresh.target !== ref.target) return;
  const result = previewText(view.state, fresh, width);
  if (!result) return;
  write(view, fresh.from, fresh.to, result.text);
  if (result.dropped) toast(`Dropped the name "${result.dropped}", since an embed reads it as a size.`);
}

/** The Markdown that gives a preview `width` (a picture or video) or a PDF `height`. */
export function sizeText(state: EditorState, ref: FileRef, size: { width?: number | null; height?: number }): string | null {
  const bar = ref.inTable ? '\\|' : '|';
  if (size.height !== undefined) {
    const fragment = [...(ref.fragment ?? '').split('&').filter((part) => part && !part.startsWith('height=')), `height=${size.height}`].join('&');
    if (ref.form === 'embed') return `![[${ref.target}#${fragment}${ref.slot !== null ? `${bar}${ref.slot}` : ''}]]`;
    const address = writtenAddress(state, ref);
    if (ref.form !== 'image' || !address) return null;
    const bare = address.replace(/#[^>]*(>?)$/, '$1');
    const withFragment = bare.endsWith('>') ? `${bare.slice(0, -1)}#${fragment}>` : `${bare}#${fragment}`;
    return `${state.sliceDoc(ref.from, ref.urlFrom ?? ref.from)}${withFragment}${state.sliceDoc(ref.urlTo ?? ref.to, ref.to)}`;
  }
  const width = size.width ?? null;
  if (ref.form === 'embed') return `![[${targetWithFragment(ref)}${width ? `${bar}${width}` : ''}]]`;
  if (ref.form === 'image') {
    const before = state.sliceDoc(ref.from, ref.textFrom);
    return `${before}${ref.text ?? ''}${width ? `${bar}${width}` : ''}${state.sliceDoc(ref.textTo, ref.to)}`;
  }
  return null;
}

function setSize(view: EditorView, ref: FileRef, size: { width?: number | null; height?: number }): void {
  const text = sizeText(view.state, ref, size);
  if (text !== null) write(view, ref.from, ref.to, text);
}

/** Puts `name` where a link shows its name: a wiki link's alias, or a Markdown link's text. */
export function renameText(state: EditorState, ref: FileRef, name: string): string | null {
  const clean = name.trim();
  if (!clean) return null;
  if (ref.form === 'wiki' || ref.form === 'embed') {
    if (ref.form === 'embed' && (ref.kind === 'image' || ref.kind === 'video')) return null;
    const bar = ref.inTable ? '\\|' : '|';
    const bang = ref.form === 'embed' ? '!' : '';
    return `${bang}[[${targetWithFragment(ref)}${bar}${wikiAlias(clean, ref.inTable)}]]`;
  }
  if (ref.form === 'link') return `[${escapeLinkText(clean, ref.inTable)}]${state.sliceDoc(ref.textTo + 1, ref.to)}`;
  return null;
}

/** A Markdown image's alt text, keeping its size. */
export function captionText(state: EditorState, ref: FileRef, caption: string): string | null {
  if (ref.form !== 'image') return null;
  const size = ref.slot ? `${ref.inTable ? '\\|' : '|'}${ref.slot}` : '';
  return `![${escapeLinkText(caption.trim(), ref.inTable)}${size}]${state.sliceDoc(ref.textTo + 1, ref.to)}`;
}

/** The link pointing at `path` instead, keeping its size or name. */
export function retargetText(state: EditorState, ref: FileRef, path: string): string {
  const vaultPath = vaultPathOf(path);
  const page = state.facet(pageContext).path;
  if (ref.form === 'wiki' || ref.form === 'embed') {
    if (!WIKI_UNSAFE.test(vaultPath)) {
      const inner = state.sliceDoc(ref.textFrom, ref.textTo);
      const rest = inner.slice(Math.min(...['#', '|', '\\|'].map((mark) => { const at = inner.indexOf(mark); return at === -1 ? inner.length : at; })));
      return `${ref.form === 'embed' ? '!' : ''}[[${vaultPath}${rest}]]`;
    }
    return linkFor({ vaultPath, path, page, embed: ref.form === 'embed', slot: ref.slot, inTable: ref.inTable });
  }
  const address = encodeAddress(relativePath(page, path));
  return `${state.sliceDoc(ref.from, ref.urlFrom ?? ref.to)}${address}${state.sliceDoc(ref.urlTo ?? ref.to, ref.to)}`;
}

function retarget(view: EditorView, ref: FileRef, path: string): void {
  const text = retargetText(view.state, ref, path);
  const target = vaultPathOf(path);
  view.dispatch({ effects: linksResolved.of({ [target]: path }) });
  forgetInfo(path);
  write(view, ref.from, ref.to, text);
}

/** Update link: the path of a file that moved, written only when picked. */
export function updateMovedLink(view: EditorView, ref: FileRef, moved: string): void {
  retarget(view, ref, moved);
}

/** Locate… and Replace…: picks a file and points the link at it, keeping its size or name. */
export async function locateFile(view: EditorView, ref: FileRef): Promise<void> {
  const picked = await window.filesAPI.pickAndImport(view.state.facet(pageContext).path, { anyType: true }).catch(() => null);
  if (!picked) return;
  if (!picked.success) {
    toast.error(picked.error);
    return;
  }
  const file = picked.data.files[0];
  if (!file?.path) return;
  const fresh = refAt(view.state, ref);
  if (fresh && fresh.target === ref.target) retarget(view, fresh, file.path);
}

/** Takes the file off the page; the file stays in the files folder. */
export function removeRef(view: EditorView, ref: FileRef): void {
  const obj = objectAt(view.state, ref.from, 1) ?? objectAt(view.state, ref.from, 0);
  if (obj) removeObject(view, obj, -1, 'delete');
  else view.dispatch({ changes: { from: ref.from, to: ref.to }, annotations: isolateHistory.of('full'), userEvent: 'delete' });
}

const LAUNCHERS = new Set(['app', 'command', 'terminal', 'workflow', 'fileloc', 'jar', 'tool', 'pkg', 'scpt', 'action']);
/** Kinds Opal's own tab shows. */
const OPAL_SHOWS = new Set(['image', 'pdf', 'video', 'audio', 'text', 'markdown']);

const isLauncher = (ref: FileRef) => LAUNCHERS.has(storedExtension(basenameFsPath(ref.path ?? ref.target)));
const opensInOpal = (ref: FileRef) => !ref.url && OPAL_SHOWS.has(ref.kind) && !/\.(heic|heif|tiff?)$/i.test(ref.target);

async function launch(path: string, quickLook = false): Promise<void> {
  const call = (confirmed?: boolean) => (quickLook ? window.filesAPI.quickLook(path, { confirmed }) : window.filesAPI.open(path, { confirmed }));
  const result = await call().catch(() => null);
  if (!result) {
    toast.error(`Could not open ${basenameFsPath(path)}.`);
    return;
  }
  if (!result.success) {
    toast.error(result.error);
    return;
  }
  const answer = result.data;
  if (answer.action === 'opened' && answer.notice) toast(answer.notice);
  if (answer.action === 'revealed') toast(answer.reason);
  if (answer.action === 'confirm') {
    toast(`${basenameFsPath(path)} is outside the vault. Open it in ${answer.app ?? 'its app'}?`, {
      action: { label: 'Open', onClick: () => { void call(true); } },
    });
  }
}

/** Opens a file: in an Opal tab when `how` is "main" and Opal shows its type, otherwise in its app. Web pages open in the browser. */
export async function openFile(view: EditorView, ref: FileRef, how: 'main' | 'app', newTab = true): Promise<void> {
  if (ref.url) {
    window.open(ref.url, '_blank');
    return;
  }
  if (!ref.path) {
    toast.error(`Could not find ${fileName(ref)}.`);
    return;
  }
  if (how === 'main' && opensInOpal(ref)) {
    const page = ref.kind === 'pdf' ? fragmentValue(ref, 'page') : null;
    if (page) openPdfAtPage(ref.path, page);
    view.state.facet(pageContext).openNote(ref.path, newTab);
    return;
  }
  await launch(ref.path);
}

export async function quickLookFile(ref: FileRef): Promise<void> {
  if (ref.path) await launch(ref.path, true);
}

async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast.error('Could not copy.');
  }
}

async function result(call: Promise<{ success: boolean; error?: string }>, done: string): Promise<void> {
  const answer = await call.catch(() => null);
  if (answer?.success) toast(done);
  else toast.error(answer?.error ?? 'That did not work.');
}

/** Asks for one line of text under the file whose link starts at `at`, as Rename… and Caption… do; null when dismissed. */
export type AskText = (view: EditorView, at: number, label: string, value: string) => Promise<string | null>;

let asker: AskText = askInPlace;

/** Tests answer for the person. */
export function setAskText(next: AskText | null): void {
  asker = next ?? askInPlace;
}

/** Resolves once no menu is open and a frame has passed, so a closing menu has given focus back before a field takes it. */
function afterMenus(): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (!document.querySelector('[role="menu"]') || Date.now() - started > 1000) requestAnimationFrame(() => resolve());
      else requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Rename… and Caption…: a field under the file, in the bar's place, which
 * hides while it is open. It opens once the More menu has closed, so the
 * menu's focus return never lands in the text. Enter applies; Escape, a
 * scroll or focus anywhere else closes it.
 */
async function askInPlace(view: EditorView, at: number, label: string, value: string): Promise<string | null> {
  await afterMenus();
  if (!view.dom.isConnected) return null;
  return new Promise((resolve) => {
    const box = document.createElement('form');
    box.className = 'opal-file-ask';
    const input = document.createElement('input');
    input.value = value;
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    const done = document.createElement('button');
    done.type = 'submit';
    done.textContent = 'Done';
    box.append(input, done);
    // Under the file, from its left edge: `at` is where its link starts.
    const place = view.coordsAtPos(at, 1);
    box.style.top = `${Math.min(window.innerHeight - 48, (place?.bottom ?? 80) + 8)}px`;
    box.style.left = `${Math.max(8, Math.min(window.innerWidth - 328, place?.left ?? 80))}px`;
    let finished = false;
    const finish = (answer: string | null) => {
      if (finished) return;
      finished = true;
      box.remove();
      document.body.removeAttribute('data-file-ask');
      view.scrollDOM.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      view.focus();
      resolve(answer);
    };
    const dismiss = () => finish(null);
    box.addEventListener('submit', (event) => {
      event.preventDefault();
      finish(input.value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    });
    box.addEventListener('focusout', () => setTimeout(() => { if (!box.contains(document.activeElement)) finish(null); }, 0));
    view.scrollDOM.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    document.body.setAttribute('data-file-ask', '');
    document.body.append(box);
    input.focus();
    input.select();
  });
}

async function rename(view: EditorView, ref: FileRef): Promise<void> {
  const name = await asker(view, ref.from, 'Name', nameFor(ref));
  const fresh = name === null ? null : refAt(view.state, ref);
  if (!fresh || name === null) return;
  const text = renameText(view.state, fresh, name);
  if (text !== null) write(view, fresh.from, fresh.to, text);
}

async function caption(view: EditorView, ref: FileRef): Promise<void> {
  const text = await asker(view, ref.from, 'Caption', captionOf(ref) ?? '');
  const fresh = text === null ? null : refAt(view.state, ref);
  if (!fresh || text === null) return;
  const written = captionText(view.state, fresh, text);
  if (written !== null) write(view, fresh.from, fresh.to, written);
}

async function getFromMini(view: EditorView, ref: FileRef): Promise<void> {
  if (!ref.path) return;
  const answer = await window.filesAPI.fetch(ref.path).catch(() => null);
  if (!answer?.success || answer.data !== 'here') {
    toast.error(answer && !answer.success ? answer.error : `Could not get ${fileName(ref)} from the Mini.`);
    return;
  }
  forgetInfo(ref.path);
  // The page draws the file again now that its bytes are here.
  view.dispatch({ effects: fileChanged.of(toOpalFileUrl(ref.path)) });
}

/** What the bar shows first: "q3.pdf · PDF · 9.1 MB" for a file, the domain and path for a web page. */
export function destinationOf(state: EditorState, obj: PageObject): string | null {
  const ref = refAt(state, obj);
  if (!ref) return null;
  if (ref.url) {
    try {
      const url = new URL(ref.url);
      return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      return ref.url;
    }
  }
  const name = fileName(ref);
  const info = ref.path ? knownInfo(ref.path) : null;
  if (ref.path && info === undefined) void fileInfo(ref.path);
  return [name, kindLabel(name, ref.kind), info?.size ? formatBytes(info.size) : null].filter(Boolean).join(' · ');
}

const IMAGE_SIZES = [
  { id: 'small', label: 'Small', width: 240 },
  { id: 'medium', label: 'Medium', width: 400 },
  { id: 'large', label: 'Large', width: 560 },
];
const PDF_SIZES = [
  { id: 'short', label: 'Short', height: 240 },
  { id: 'medium', label: 'Medium', height: 360 },
  { id: 'tall', label: 'Tall', height: 600 },
];

/** The bar's items for the file in `obj`, after its destination. */
export function fileActions(state: EditorState, obj: PageObject): ObjectAction[] {
  const ref = refAt(state, obj);
  if (!ref) return [];
  const look = lookOf(ref);
  const path = ref.path ?? null;
  if (path && knownApp(path) === undefined) void appFor(path);
  const app = path ? knownApp(path) : null;
  const appLabel = app ? `Open in ${app}` : 'Open in App';
  const inDoc = state.facet(docMode);
  const fresh = (view: EditorView) => refAt(view.state, obj) ?? ref;
  const actions: ObjectAction[] = [];

  if (ref.url) {
    actions.push({ id: 'open', label: 'Open', run: () => { window.open(ref.url ?? '', '_blank'); } });
  } else if (isLauncher(ref)) {
    actions.push({ id: 'reveal', label: 'Reveal in Finder', disabled: !path, run: () => { if (path) void window.diskAPI.reveal(path); } });
  } else if (opensInOpal(ref)) {
    actions.push({ id: 'open', label: 'Open', disabled: !path, run: (view) => { void openFile(view, fresh(view), 'main'); } });
    actions.push({ id: 'open-app', label: appLabel, disabled: !path, run: (view) => { void openFile(view, fresh(view), 'app'); } });
  } else {
    actions.push({ id: 'open-app', label: appLabel, disabled: !path, run: (view) => { void openFile(view, fresh(view), 'app'); } });
  }

  // Show as only where Card and Preview look different: a file Opal previews. Any other file, and a video page, is a card either way.
  if (ref.alone && !ref.url && PREVIEWED.has(ref.kind)) {
    actions.push({
      id: 'show-as',
      label: 'Show as',
      items: [
        { id: 'card', label: 'Card', disabled: look === 'card' || cardText(state, ref) === null, run: (view) => { void showAs(view, fresh(view), 'card'); } },
        { id: 'preview', label: 'Preview', disabled: look === 'preview', run: (view) => { void showAs(view, fresh(view), 'preview'); } },
      ],
    });
  }

  if (look === 'preview' && (ref.kind === 'image' || ref.kind === 'video')) {
    const current = slotWidth(ref.slot);
    actions.push({
      id: 'size',
      label: 'Size',
      items: [
        ...IMAGE_SIZES.map((size) => ({ id: size.id, label: size.label, disabled: current === size.width, run: (view: EditorView) => setSize(view, fresh(view), { width: size.width }) })),
        { id: 'full', label: 'Full width', run: (view: EditorView) => setSize(view, fresh(view), { width: columnWidth(view) }) },
      ],
    });
  } else if (look === 'preview' && ref.kind === 'pdf' && (ref.form === 'embed' || ref.form === 'image')) {
    actions.push({
      id: 'size',
      label: 'Size',
      items: PDF_SIZES.map((size) => ({ id: size.id, label: size.label, run: (view: EditorView) => setSize(view, fresh(view), { height: size.height }) })),
    });
  }

  if (ref.form === 'image' && !ref.url) actions.push({ id: 'caption', label: 'Caption…', run: (view) => { void caption(view, fresh(view)); } });

  if (inDoc && (ref.form === 'wiki' || ref.form === 'link')) {
    actions.push({
      id: 'edit-link',
      label: 'Edit link',
      shortcut: '⌘K',
      run: (view) => {
        const current = fresh(view);
        view.dispatch({ effects: setLinkEditor.of({ from: current.from, to: current.to, editing: true }) });
      },
    });
  }

  const info = path ? knownInfo(path) : null;
  const named = ref.form === 'wiki' || ref.form === 'link' || (ref.form === 'embed' && ref.kind !== 'image' && ref.kind !== 'video');
  const more: ObjectAction[] = [];
  if (path) {
    more.push(
      { id: 'quick-look', label: 'Quick Look', shortcut: 'Space', run: (view) => { void quickLookFile(fresh(view)); } },
      { id: 'reveal-finder', label: 'Reveal in Finder', run: () => { void window.diskAPI.reveal(path); } },
    );
    if (ref.kind === 'image') more.push({ id: 'copy-image', label: 'Copy image', run: () => { void result(window.filesAPI.copyImage(path), 'Image copied.'); } });
    more.push({ id: 'copy-file', label: 'Copy file', run: () => { void result(window.filesAPI.copyFile(path), 'File copied.'); } });
  }
  if (ref.url) more.push({ id: 'copy-link', label: 'Copy link', run: () => { void copyText(ref.url ?? '', 'Link copied.'); } });
  more.push({ id: 'copy-markdown', label: 'Copy as Markdown', run: (view) => { const current = fresh(view); void copyText(view.state.sliceDoc(current.from, current.to), 'Copied as Markdown.'); } });
  if (path) {
    more.push({ id: 'copy-path', label: 'Copy path', run: () => { void copyText(vaultPathOf(path), 'Path copied.'); } });
    if (info?.status === 'lfs-missing') more.push({ id: 'get', label: 'Get from Mini', run: (view) => { void getFromMini(view, fresh(view)); } });
    more.push({ id: 'save-copy', label: 'Save a copy…', run: () => { void window.filesAPI.saveCopy(path, named ? nameFor(ref) : undefined).then((saved) => { if (saved.success && saved.data.saved) toast(`Saved to ${saved.data.saved}.`); else if (!saved.success) toast.error(saved.error); }); } });
  }
  if (named && !ref.url) more.push({ id: 'rename', label: 'Rename…', run: (view) => { void rename(view, fresh(view)); } });
  if (!ref.url) more.push({ id: 'replace', label: 'Replace…', run: (view) => { void locateFile(view, fresh(view)); } });
  more.push({ id: 'remove', label: 'Remove', run: (view) => removeRef(view, fresh(view)) });
  actions.push({ id: 'more', label: 'More', items: more });
  return actions;
}

/** The picture from the web inside `obj`, with where its node starts. */
export function webPictureIn(state: EditorState, obj: Pick<PageObject, 'from' | 'to'>): (WebPicture & { from: number }) | null {
  const pictures: (WebPicture & { from: number })[] = [];
  syntaxTree(state).iterate({
    from: obj.from,
    to: obj.to,
    enter: (node) => {
      if (pictures.length > 0) return false;
      if (node.name !== 'Image') return undefined;
      const picture = webPictureOf(state, node.node);
      if (picture) pictures.push({ ...picture, from: node.from });
      return false;
    },
  });
  return pictures[0] ?? null;
}

/** The bar for a picture from the web: Open in the browser, Size, and More with Copy link, Copy as Markdown and Remove. */
export function webPictureActions(state: EditorState, obj: PageObject): ObjectAction[] {
  const found = webPictureIn(state, obj);
  if (!found) return [];
  const resize = (view: EditorView, width: number) => {
    const changes = widthChange(view.state, found.from, width);
    if (!changes) return;
    view.dispatch({ changes, annotations: isolateHistory.of('full'), userEvent: 'input.resize' });
    const framed = objectAt(view.state, obj.from, 1) ?? objectAt(view.state, found.from, 1);
    if (framed) view.dispatch({ effects: setFrame.of(framed) });
  };
  return [
    { id: 'open', label: 'Open', run: () => { window.open(found.address, '_blank'); } },
    {
      id: 'size',
      label: 'Size',
      items: [
        ...IMAGE_SIZES.map((size) => ({ id: size.id, label: size.label, disabled: found.width === size.width, run: (view: EditorView) => resize(view, size.width) })),
        { id: 'full', label: 'Full width', run: (view: EditorView) => resize(view, columnWidth(view)) },
      ],
    },
    {
      id: 'more',
      label: 'More',
      items: [
        { id: 'copy-link', label: 'Copy link', run: () => { void copyText(found.address, 'Link copied.'); } },
        { id: 'copy-markdown', label: 'Copy as Markdown', run: (view, current) => { void copyText(view.state.sliceDoc(current.from, current.to), 'Copied as Markdown.'); } },
        { id: 'remove', label: 'Remove', run: (view, current) => removeObject(view, current, -1, 'delete') },
      ],
    },
  ];
}
