import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { classifyFile, extensionOf, storedExtension, withoutHash, type FileKind } from '@/common/fileKind';
import { basenameFsPath, normalizeFsPath, parentFsPath } from '@/common/fsPaths';
import type { FileInfo } from '@/types/files';
import { protectedIn } from './extensionPoints';
import { linkTarget } from './livePreview';
import { namesFile, parseWikiTarget } from './wikiLinks';

/*
 * Files on a page, read from the four ways Markdown points at one: a wiki
 * link `[[path|Name]]`, an embed `![[path|640]]`, a Markdown image
 * `![alt](path)` and a Markdown link `[text](path)`. Each is drawn in one of
 * three looks: a chip inside text, a card when the link is alone on its
 * line (or an embed of a type with no preview), and a preview for images,
 * PDF, video and audio. Notes and web pages stay links. This file only
 * reads the Markdown; fileWidgets.ts draws and fileActions.ts writes.
 */

/** The syntax nodes a file link can be. */
export const FILE_NODES: readonly string[] = ['Embed', 'WikiLink', 'Image', 'Link', 'URL'];

export type FileForm = 'wiki' | 'embed' | 'image' | 'link';
export type FileLook = 'chip' | 'card' | 'preview';

/** What a file link says, read from its Markdown. */
export interface FileRef {
  form: FileForm;
  /** The link's node. */
  from: number;
  to: number;
  /** Where the text between the brackets starts and ends: a wiki link's target and alias, or a Markdown link's text. */
  textFrom: number;
  textTo: number;
  /** A Markdown link's address as written, from its first to its last character. */
  urlFrom: number | null;
  urlTo: number | null;
  /** The file it points at, as written: a wiki target, or a Markdown address read per segment. */
  target: string;
  /** A wiki link's "#heading", or an address's fragment, such as "page=3". */
  fragment: string | null;
  /** The text after "|": a size or a name. In a Markdown image, the part of the alt text after "|". */
  slot: string | null;
  /** A Markdown link's text, or a Markdown image's alt text without its size. */
  text: string | null;
  /** The file on disk: absolute; null when a wiki link points at nothing; undefined while it is being looked up. */
  path: string | null | undefined;
  /** A web address, for links to the web. */
  url: string | null;
  kind: FileKind;
  /** Alone on its line, past quote marks: not in a list item or a table. */
  alone: boolean;
  inTable: boolean;
}

const SIZE = /^\s*\d+(?:x\d+)?\s*$/;

/** Whether the text after a link's "|" is a size, as Obsidian reads it: `640` or `100x145`. */
export function isSize(slot: string | null | undefined): boolean {
  return slot !== null && slot !== undefined && SIZE.test(slot);
}

/** The width a size slot sets, or null. */
export function slotWidth(slot: string | null | undefined): number | null {
  const match = /^\s*(\d+)(?:x\d+)?\s*$/.exec(slot ?? '');
  return match ? Number(match[1]) : null;
}

export { KNOWN_BINARY, namesFile } from './wikiLinks';

const WEB = /^https?:\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A video service's page: YouTube and Loom draw as a card, never as a picture. */
export function videoService(url: string): 'YouTube' | 'Loom' | null {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/.test(host)) return 'YouTube';
  if (/(^|\.)loom\.com$/.test(host)) return 'Loom';
  return null;
}

/**
 * A Markdown address as the file it names, relative to the page or from the
 * top of the disk with a leading "/". Angle brackets come off, `\<` and `\>`
 * are read as written, and each segment is decoded on its own, so `%23` is a
 * "#" in a name, `%3C` a "<", and a bare "#" starts the fragment.
 */
export function readAddress(written: string, page: string): { path: string; fragment: string | null } {
  let raw = written.trim();
  if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1).replace(/\\([<>])/g, '$1');
  const hash = raw.indexOf('#');
  const fragment = hash === -1 ? null : raw.slice(hash + 1);
  const pathPart = hash === -1 ? raw : raw.slice(0, hash);
  const decoded = pathPart.split('/').map((segment) => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  }).join('/').normalize('NFC');
  const path = decoded.startsWith('/') ? normalizeFsPath(decoded) : normalizeFsPath(`${parentFsPath(page) ?? ''}/${decoded}`);
  return { path, fragment };
}

const CODE = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'HTMLBlock', 'CommentBlock']);

/** Whether `at` is in code, HTML or a protected range such as a formula, where a link or chip would be text. */
export function inCode(state: EditorState, at: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, -1); node; node = node.parent) {
    if (CODE.has(node.name)) return true;
  }
  return protectedIn(state, at, at).some((range) => range.from < at && at < range.to);
}

/** Whether `at` is in a table row, where a link's "|" must be written "\|". */
export function inTableAt(state: EditorState, at: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, -1); node; node = node.parent) {
    if (node.name === 'Table' || node.name === 'TableRow' || node.name === 'TableHeader' || node.name === 'TableCell') return true;
  }
  return false;
}

/**
 * A Markdown link's or image's address as written, and its URL node: the one
 * after "](", not an address the link's own text holds, as in
 * `[henry@x.com](mailto:henry@x.com)`. A reference link's comes from its
 * definition.
 */
function addressOf(state: EditorState, node: SyntaxNode, marks: readonly SyntaxNode[]): { written: string | null; url: SyntaxNode | null } {
  if (marks.length > 2) {
    const url = node.getChildren('URL').find((child) => child.from >= marks[1].to) ?? null;
    return { written: url ? state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '') : null, url };
  }
  return { written: linkTarget(state, node), url: null };
}

/** The line holds this node and nothing else but quote marks and spaces, outside lists and tables. */
export function aloneOnLine(state: EditorState, node: SyntaxNode): { alone: boolean; inTable: boolean } {
  let inTable = false;
  let inList = false;
  for (let at = node.parent; at; at = at.parent) {
    if (at.name === 'Table' || at.name === 'TableCell' || at.name === 'TableRow') inTable = true;
    if (at.name === 'ListItem') inList = true;
  }
  const line = state.doc.lineAt(node.from);
  if (node.to > line.to || inTable || inList) return { alone: false, inTable };
  const rest = line.text.slice(0, node.from - line.from) + line.text.slice(node.to - line.from);
  return { alone: /^[\s>]*$/.test(rest), inTable };
}

/**
 * The file link `node` is, or null when it is no link to a file or a video
 * page: a link to a note or a web page, a web picture, or bracketed text.
 * `links` holds where wiki targets point.
 */
export function fileRefOf(state: EditorState, node: SyntaxNode, links: ReadonlyMap<string, string | null>, page: string): FileRef | null {
  const { alone, inTable } = aloneOnLine(state, node);
  if (node.name === 'WikiLink' || node.name === 'Embed') {
    const [open, close] = node.getChildren('WikiLinkMark');
    if (!open || !close) return null;
    const inner = state.sliceDoc(open.to, close.from);
    const link = parseWikiTarget(inner);
    if (!link.target) return null;
    const path = links.has(link.target) ? links.get(link.target) ?? null : undefined;
    const kind = classifyFile(path ?? link.target);
    const isFile = path ? kind !== 'markdown' : namesFile(link.target);
    if (!isFile) return null;
    return {
      form: node.name === 'Embed' ? 'embed' : 'wiki',
      from: node.from,
      to: node.to,
      textFrom: open.to,
      textTo: close.from,
      urlFrom: null,
      urlTo: null,
      target: link.target,
      fragment: link.heading,
      slot: link.aliasAt === null ? null : inner.slice(link.aliasAt).replace(/^\\/, ''),
      text: null,
      path,
      url: null,
      kind,
      alone,
      inTable,
    };
  }
  if (node.name === 'URL') {
    // A bare YouTube or Loom address alone on its line is a card; in text it is a chip (urlChips.ts).
    const parent = node.parent?.name;
    const address = state.sliceDoc(node.from, node.to);
    if (!alone || parent === 'Link' || parent === 'Image' || parent === 'Autolink' || parent === 'LinkReference' || !videoService(address)) return null;
    return {
      form: 'link', from: node.from, to: node.to, textFrom: node.from, textTo: node.to, urlFrom: node.from, urlTo: node.to,
      target: address, fragment: null, slot: null, text: null, path: null, url: address, kind: 'video', alone, inTable,
    };
  }
  if (node.name !== 'Image' && node.name !== 'Link') return null;
  const marks = node.getChildren('LinkMark');
  if (marks.length < 2) return null;
  const { written, url } = addressOf(state, node, marks);
  if (!written) return null;
  const textFrom = marks[0].to;
  const textTo = marks[1].from;
  const label = state.sliceDoc(textFrom, textTo);
  const image = node.name === 'Image';
  const bar = image ? label.lastIndexOf('|') : -1;
  const slot = bar === -1 ? null : label.slice(bar + 1);
  // In a table the size's pipe is written "\|", and its backslash is no part of the alt text.
  const cut = inTable && bar > 0 && label[bar - 1] === '\\' ? bar - 1 : bar;
  const text = image && bar !== -1 && isSize(slot) ? label.slice(0, cut) : label;
  const base = {
    form: (image ? 'image' : 'link') as FileForm,
    from: node.from,
    to: node.to,
    textFrom,
    textTo,
    urlFrom: url ? url.from : null,
    urlTo: url ? url.to : null,
    slot: image && isSize(slot) ? slot : null,
    text,
    alone,
    inTable,
  };
  if (WEB.test(written.trim())) {
    const address = written.trim().replace(/^<|>$/g, '');
    // A web picture stays a picture; a video page is a card or a chip.
    if (!videoService(address)) return null;
    return { ...base, target: address, fragment: null, path: null, url: address, kind: 'video' };
  }
  // A file outside the vault, `[Report](file:///Users/…/report.pdf)`: a file link with its own path, opened only after a confirm.
  if (!image && /^<?file:\/\//i.test(written.trim())) {
    let path: string;
    try { path = normalizeFsPath(decodeURIComponent(new URL(written.trim().replace(/^<|>$/g, '')).pathname).normalize('NFC')); } catch { return null; }
    const kind = classifyFile(path);
    if (kind === 'markdown' || !extensionOf(basenameFsPath(path))) return null;
    return { ...base, target: path, fragment: null, path, url: null, kind };
  }
  if (SCHEME.test(written.trim())) return null;
  // A heading on this page, or a folder, is no file.
  const bare = written.trim().replace(/^<|>$/g, '');
  if (bare.startsWith('#') || /\/(#|$)/.test(bare)) return null;
  const { path, fragment } = readAddress(written, page);
  const kind = classifyFile(path);
  if (!image && (kind === 'markdown' || !extensionOf(basenameFsPath(path)))) return null;
  return { ...base, target: path, fragment, path, url: null, kind };
}

/** A picture from the web, `![alt|300](https://…)`, that is no video page: its address, alt text and width. */
export interface WebPicture {
  address: string;
  alt: string;
  width: number | null;
  alone: boolean;
}

export function webPictureOf(state: EditorState, node: SyntaxNode): WebPicture | null {
  if (node.name !== 'Image') return null;
  const marks = node.getChildren('LinkMark');
  const written = marks.length >= 2 ? addressOf(state, node, marks).written : null;
  if (!written) return null;
  const address = written.trim().replace(/^<|>$/g, '');
  if (!WEB.test(address) || videoService(address)) return null;
  const [alt, size] = state.sliceDoc(marks[0].to, marks[1].from).split('|');
  return { address, alt, width: slotWidth(size), alone: aloneOnLine(state, node).alone };
}

/** The file link at `node`, with the page's wiki targets and path read from `state`. */
export type RefReader = (state: EditorState, node: SyntaxNode) => FileRef | null;

/** Kinds whose embed shows the file's content. */
export const PREVIEWED: ReadonlySet<FileKind> = new Set(['image', 'pdf', 'video', 'audio']);

/**
 * How a file link draws: a preview for an embed of an image, PDF, video or
 * audio file; a card for any other embed, a video page's embed, and a link
 * alone on its line; a chip inside text. A Markdown image of a file with no
 * preview is a card too.
 */
export function lookOf(ref: FileRef): FileLook {
  const embedded = ref.form === 'embed' || ref.form === 'image';
  if (ref.url) return ref.alone || embedded ? 'card' : 'chip';
  if (embedded) return PREVIEWED.has(ref.kind) ? 'preview' : 'card';
  return ref.alone ? 'card' : 'chip';
}

/** Whether the file's object is a block, framed first: anything alone on its line. Inline ones go in one press. */
export function isBlockRef(ref: FileRef): boolean {
  return ref.alone;
}

/** The file's own name without the hash Opal adds when it stores one. */
export function fileName(ref: FileRef): string {
  if (ref.url) return ref.url;
  return withoutHash(basenameFsPath(ref.path ?? ref.target));
}

/**
 * The name the page shows for a file: a wiki link's alias unless it is a
 * size, a Markdown link's text, otherwise the file's name without its hash.
 */
export function shownName(ref: FileRef): string {
  if (ref.form === 'wiki' || ref.form === 'embed') {
    if (ref.slot && !isSize(ref.slot) && ref.slot.trim()) return ref.slot.trim();
  } else if (ref.form === 'link' && ref.text?.trim()) {
    return ref.text.replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, '$1').trim();
  }
  return ref.url ? (videoService(ref.url) ? `${videoService(ref.url)} video` : ref.url) : fileName(ref);
}

/**
 * A Markdown-form embed's caption: its alt text, unless that is empty,
 * "image", or a file name (the stored name, the shown name, or any name
 * with an extension of four letters or fewer).
 */
export function captionOf(ref: FileRef): string | null {
  if (ref.form !== 'image' || ref.text === null) return null;
  const alt = ref.text.replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, '$1').trim();
  if (!alt || /^(image|img|picture|photo|video|screenshot)$/i.test(alt)) return null;
  const names = new Set([fileName(ref).toLowerCase(), basenameFsPath(ref.target).toLowerCase()]);
  if (names.has(alt.toLowerCase())) return null;
  if (/^[^\s/\\]+\.[a-z0-9]{1,4}$/i.test(alt)) return null;
  return alt;
}

/** A kind's name as a person says it, by extension: "PDF", "PowerPoint", "Keynote". */
export function kindLabel(name: string, kind: FileKind): string {
  const extension = storedExtension(name);
  const labels: Record<string, string> = {
    pdf: 'PDF', pptx: 'PowerPoint', ppt: 'PowerPoint', docx: 'Word', doc: 'Word', xlsx: 'Excel', xls: 'Excel',
    key: 'Keynote', pages: 'Pages', numbers: 'Numbers', stl: 'STL model', obj: 'OBJ model', '3mf': '3MF project',
    'gcode.3mf': 'Bambu project', step: 'STEP model', stp: 'STEP model', zip: 'ZIP archive', 'tar.gz': 'Archive', gz: 'Archive',
    tar: 'Archive', excalidraw: 'Excalidraw drawing', canvas: 'Canvas', base: 'Base', csv: 'CSV', tsv: 'TSV', json: 'JSON',
    jsonl: 'JSON Lines', yaml: 'YAML', yml: 'YAML', log: 'Log', txt: 'Text', html: 'HTML', htm: 'HTML', md: 'Note', mdo: 'Document',
    mp4: 'MP4 video', mov: 'QuickTime movie', m4v: 'Video', webm: 'WebM video', mkv: 'Video', avi: 'AVI video',
    mp3: 'MP3 audio', m4a: 'Audio', wav: 'WAV audio', flac: 'FLAC audio', aac: 'AAC audio', ogg: 'Ogg audio', opus: 'Opus audio',
    aif: 'AIFF audio', aiff: 'AIFF audio', png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image', gif: 'GIF image',
    webp: 'WebP image', heic: 'HEIC image', heif: 'HEIF image', tif: 'TIFF image', tiff: 'TIFF image', svg: 'SVG image',
    avif: 'AVIF image', bmp: 'BMP image', sh: 'Shell script', py: 'Python script', command: 'Command', app: 'App', jar: 'Java archive',
  };
  if (labels[extension]) return labels[extension];
  if (kind === 'text') return 'Text';
  return extension ? extension.toUpperCase() : 'File';
}

/** Bytes as people read them: "9.1 MB", "640 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
}

/** A length in seconds as "0:42" or "1:02:03". */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A PDF embed's `#height=` or `#page=` from its fragment. */
export function fragmentValue(ref: FileRef, key: 'height' | 'page' | 't'): number | null {
  if (!ref.fragment) return null;
  const match = new RegExp(`(?:^|&)${key}=(\\d+(?:\\.\\d+)?)`).exec(ref.fragment);
  return match ? Number(match[1]) : null;
}

/** The type's icon name for a file. */
export function iconFor(name: string, kind: FileKind): 'image' | 'film' | 'music' | 'fileText' | 'presentation' | 'sheet' | 'box' | 'fileArchive' | 'fileCode' | 'fileJson' | 'penTool' | 'appWindow' | 'file' | 'play' | 'layoutGrid' {
  const extension = storedExtension(name);
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'film';
  if (kind === 'audio') return 'music';
  if (kind === 'pdf' || kind === 'markdown') return 'fileText';
  if (['pptx', 'ppt', 'key'].includes(extension)) return 'presentation';
  if (['xlsx', 'xls', 'numbers', 'csv', 'tsv'].includes(extension)) return 'sheet';
  if (['docx', 'doc', 'pages', 'txt'].includes(extension)) return 'fileText';
  if (['stl', 'obj', '3mf', 'gcode.3mf', 'step', 'stp', 'f3d', 'iges', 'igs'].includes(extension)) return 'box';
  if (['zip', 'gz', 'tar.gz', 'tar', 'tgz', 'bz2', 'xz', '7z', 'rar', 'dmg', 'jsonl.gz'].includes(extension)) return 'fileArchive';
  if (['json', 'jsonl', 'ndjson', 'yaml', 'yml'].includes(extension)) return 'fileJson';
  if (['excalidraw'].includes(extension)) return 'penTool';
  if (['canvas', 'base'].includes(extension)) return 'layoutGrid';
  if (['app', 'command', 'terminal', 'workflow', 'fileloc', 'jar'].includes(extension)) return 'appWindow';
  if (kind === 'text') return 'fileCode';
  return 'file';
}

const infos = new Map<string, FileInfo | null>();
const askedAt = new Map<string, number>();
// What a file's status was can change under the page, as when the vault's sync brings its bytes.
const FRESH_MS = 30_000;
const asked = new Map<string, Promise<FileInfo | null>>();
const apps = new Map<string, string | null>();

/** What files:info last said about a file, or undefined before it was asked. */
export function knownInfo(path: string): FileInfo | null | undefined {
  return infos.get(path);
}

/** The file's size, kind, status and header facts, asked once per page load and kept; null when it could not be read. */
export function fileInfo(path: string, fresh = false): Promise<FileInfo | null> {
  if (!fresh && infos.has(path) && Date.now() - (askedAt.get(path) ?? 0) < FRESH_MS) return Promise.resolve(infos.get(path) ?? null);
  const pending = !fresh && asked.get(path);
  if (pending) return pending;
  const request = Promise.resolve()
    .then(() => window.filesAPI.info(path))
    .then((result) => (result.success ? result.data : null))
    .catch(() => null)
    .then((info) => {
      infos.set(path, info);
      askedAt.set(path, Date.now());
      asked.delete(path);
      return info;
    });
  asked.set(path, request);
  return request;
}

/** Forgets what is known about a file, after it was downloaded, moved or replaced. */
export function forgetInfo(path: string): void {
  infos.delete(path);
  asked.delete(path);
}

/** Forgets every file, for tests. */
export function clearFileInfo(): void {
  infos.clear();
  asked.clear();
  askedAt.clear();
  apps.clear();
}

/** The app Open would use ("Keynote"), once asked; undefined before. */
export function knownApp(path: string): string | null | undefined {
  return apps.get(path);
}

export async function appFor(path: string): Promise<string | null> {
  if (apps.has(path)) return apps.get(path) ?? null;
  const result = await Promise.resolve().then(() => window.filesAPI.appName(path)).catch(() => null);
  const name = result?.success ? result.data : null;
  apps.set(path, name);
  return name;
}
