import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { toast } from 'sonner';
import { storedExtension, type FileKind } from '@/common/fileKind';
import { basenameFsPath, isFsPathAtOrBelow } from '@/common/fsPaths';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import type { FileInfo } from '@/types/files';
import { nodeDecorators, objectKinds, type DecorateContext, type ObjectKind } from './extensionPoints';
import {
  FILE_NODES,
  appFor,
  captionOf,
  fileInfo,
  fileName,
  fileRefOf,
  forgetInfo,
  formatBytes,
  formatDuration,
  fragmentValue,
  iconFor,
  kindLabel,
  knownApp,
  knownInfo,
  lookOf,
  shownName,
  slotWidth,
  videoService,
  webPictureOf,
  type FileLook,
  type FileRef,
} from './fileEmbeds';
import { useDiskStore } from '../../store/diskStore';
import { fileIcon, type FileIconName } from './fileIcons';
import { destinationOf, fileActions, locateFile, openFile, quickLookFile, refAt, removeRef, updateMovedLink, webPictureActions, webPictureIn } from './fileActions';
import { objectFrame } from './objectFrame';
import { ImageWidget, fileChanged } from './previewWidgets';
import { linkPicker } from './linkPicker';
import { docMode } from './livePreview';
import { caretAtStart, typingAt, urlChips } from './urlChips';
import { opensNewTab, pageContext, resolvedLinks, wikiNames } from './wikiLinks';
import './files.css';

/*
 * How files draw on a page: a chip inside text, a card on its own line, and
 * a preview for images, PDF, video and audio (see fileEmbeds.ts). Every
 * look knows its height before the file loads, from files:info. A file not
 * on this Mac, gone, moved, or one Opal can't play turns into a card that
 * says so and offers what can be done. Video and audio players are kept
 * across redraws, pause when scrolled away, and one plays at a time.
 */

const PDF_HEIGHT = 360;
const THUMB_PX = 48;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function iconNode(name: FileIconName, size = 16, className = 'cm-file-icon'): HTMLElement {
  const holder = element('span', className);
  holder.append(fileIcon(name, size));
  return holder;
}

function button(label: string, run: () => void): HTMLButtonElement {
  const control = element('button', 'cm-file-button', label);
  control.type = 'button';
  control.addEventListener('mousedown', (event) => event.preventDefault());
  control.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    run();
  });
  return control;
}

/** The file's facts as a card's second line: "PowerPoint · 26 MB", "PDF · 15 pages · 9.1 MB". */
export function metaLine(name: string, kind: FileKind, info: FileInfo | null | undefined): string {
  const parts = [kindLabel(name, kind)];
  if (info?.pages) parts.push(`${info.pages} ${info.pages === 1 ? 'page' : 'pages'}`);
  if (info?.duration) parts.push(formatDuration(info.duration));
  if (info?.size) parts.push(formatBytes(info.size));
  return parts.join(' · ');
}

/** What a widget needs to know about its link, as a key its `eq` compares. */
interface Drawn {
  ref: FileRef;
  name: string;
  /** How often the file changed while the page is open, as after Get from Mini. */
  version: number;
}

const keyOf = (drawn: Drawn, extra = '') => {
  const { ref } = drawn;
  return [ref.form, ref.target, ref.fragment ?? '', ref.slot ?? '', ref.text ?? '', String(ref.path), ref.alone, drawn.name, drawn.version, extra].join('\u0000');
};

/** The link a widget stands for, found again from its place on the page, since edits move it. */
function refFrom(view: EditorView, dom: HTMLElement): FileRef | null {
  let at: number;
  try { at = view.posAtDOM(dom); } catch { return null; }
  return refAt(view.state, { from: at, to: at });
}

/** A file inside text: a grey icon and the name. A file that is gone is faded with a dashed edge. */
export class FileChipWidget extends WidgetType {
  readonly key: string;

  constructor(readonly drawn: Drawn) {
    super();
    this.key = keyOf(drawn);
  }

  eq(other: FileChipWidget) { return other.key === this.key; }

  toDOM() {
    const { ref, name } = this.drawn;
    const chip = element('span', 'cm-file-chip');
    chip.dataset.object = 'file';
    chip.setAttribute('role', 'link');
    chip.setAttribute('aria-label', `${ref.url ? 'Video' : kindLabel(fileName(ref), ref.kind)}, ${name}`);
    if (ref.path === null && !ref.url) chip.classList.add('cm-file-unresolved');
    chip.append(iconNode(ref.url ? 'play' : iconFor(fileName(ref), ref.kind), 16, 'cm-file-chip-icon'), element('span', 'cm-file-chip-name', name));
    if (ref.path) {
      void fileInfo(ref.path).then((info) => {
        if (info?.status === 'missing') chip.classList.add('cm-file-unresolved');
      });
    }
    return chip;
  }

  ignoreEvent() { return false; }
}

/** The ways a card can say its file can't be shown. */
type CardState = 'ready' | 'remote' | 'missing' | 'moved' | 'unplayable' | 'unreadable';

/**
 * A file on its own line: a 48px tile (a thumbnail, or the type's icon),
 * the name, and the kind and size. It says when the file is not downloaded
 * (Get from Mini), gone (Locate…, Remove), moved (Update link), or one Opal
 * can't play (Open in the app). Actions live in the bar, not on the card.
 */
export class FileCardWidget extends WidgetType {
  readonly key: string;

  constructor(readonly drawn: Drawn, readonly forced: CardState | null = null) {
    super();
    this.key = keyOf(drawn, forced ?? '');
  }

  eq(other: FileCardWidget) { return other.key === this.key; }

  get estimatedHeight() { return 64; }

  toDOM(view: EditorView) {
    const card = element('span', 'cm-file-card');
    card.dataset.object = 'file';
    fillCard(view, card, this.drawn.ref, this.drawn.name, this.forced);
    return card;
  }

  ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('button') !== null;
  }
}

/** Fills `card` for `ref`, then again once files:info answers. */
function fillCard(view: EditorView, card: HTMLElement, ref: FileRef, name: string, forced: CardState | null): void {
  const draw = (state: CardState, info: FileInfo | null | undefined, moved: string | null = null) => {
    card.replaceChildren();
    card.dataset.state = state;
    const service = ref.url ? videoService(ref.url) : null;
    const tile = element('span', 'cm-file-card-tile');
    const icon: FileIconName = service ? 'play'
      : state === 'remote' ? 'download'
        : state === 'missing' ? 'fileQuestion'
          : iconFor(fileName(ref), ref.kind);
    tile.append(iconNode(icon, 20));
    const body = element('span', 'cm-file-card-body');
    const title = element('span', 'cm-file-card-name', name);
    title.title = name;
    const meta = element('span', 'cm-file-card-meta');
    const actions = element('span', 'cm-file-card-actions');
    const app = ref.path ? knownApp(ref.path) : null;
    switch (state) {
      case 'remote':
        meta.textContent = 'Not downloaded yet';
        actions.append(button('Get from Mini', () => void getFromMini(view, card, ref, name)));
        break;
      case 'missing':
        meta.textContent = 'File not found';
        actions.append(
          button('Locate…', () => { const at = refFrom(view, card); if (at) void locateFile(view, at); }),
          button('Remove', () => { const at = refFrom(view, card); if (at) removeRef(view, at); }),
        );
        break;
      case 'moved':
        meta.textContent = 'Moved';
        actions.append(button('Update link', () => { const at = refFrom(view, card); if (at && moved) updateMovedLink(view, at, moved); }));
        break;
      case 'unplayable':
      case 'unreadable': {
        const what = ref.kind === 'video' ? "Can't play this video in Opal" : ref.kind === 'audio' ? "Can't play this audio in Opal" : ref.kind === 'pdf' ? "Can't read this PDF" : "Can't read this file";
        meta.textContent = what;
        actions.append(button(app ? `Open in ${app}` : 'Open in App', () => { const at = refFrom(view, card); if (at) void openFile(view, at, 'app'); }));
        break;
      }
      default:
        meta.textContent = service ? `${service} video · ${hostOf(ref.url ?? '')}` : metaLine(fileName(ref), ref.kind, info);
    }
    if (state === 'ready' && service && ref.url) videoStill(view, card, tile, actions, ref.url);
    body.append(title, meta);
    card.append(tile, body);
    if (actions.childElementCount > 0) card.append(actions);
    card.setAttribute('aria-label', `${service ? `${service} video` : kindLabel(fileName(ref), ref.kind)}, ${name}`);
    if (state === 'ready' && ref.path && !service) dragOut(tile, ref.path);
    if (state === 'ready' && ref.path && !service && hasPicture(ref)) {
      void thumbnailInto(view, tile, ref.path);
      hoverPreview(card, ref.path);
    }
  };
  if (forced) {
    draw(forced, ref.path ? knownInfo(ref.path) : null);
    return;
  }
  if (ref.url || ref.path === undefined) {
    // A web page, or a wiki target still being looked up.
    draw('ready', null);
    return;
  }
  if (ref.path === null) {
    // A stored file's wiki target is its path from the vault's top, so its twin can still be found.
    const guess = storedPathOf(view, ref);
    if (guess) void movedOrMissing(view, { ...ref, path: guess }, draw);
    else draw('missing', null);
    return;
  }
  const path = ref.path;
  const known = knownInfo(path);
  draw(stateOf(known), known);
  if (known === undefined || known?.status === 'missing') {
    void fileInfo(path).then((info) => {
      if (!card.isConnected && known !== undefined) return;
      if (info?.status === 'missing') void movedOrMissing(view, ref, draw);
      else draw(stateOf(info), info);
      view.requestMeasure();
    });
  }
  void appFor(path);
}

/** Where a wiki link's target would be if it is a path from the vault's top, as Opal writes stored files. */
function storedPathOf(view: EditorView, ref: FileRef): string | null {
  if (ref.form !== 'wiki' && ref.form !== 'embed') return null;
  if (!ref.target.includes('/')) return null;
  const page = view.state.facet(pageContext).path;
  const root = useDiskStore.getState().roots.filter((candidate) => isFsPathAtOrBelow(candidate, page)).sort((a, b) => b.length - a.length)[0];
  return root ? `${root}/${ref.target}` : null;
}

// Types whose thumbnail shows their content; for the rest macOS would draw the app's icon, which the page never shows.
const PICTURED = new Set(['pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls', 'key', 'pages', 'numbers', '3mf', 'gcode.3mf', 'stl', 'obj']);

/** Whether a card's tile shows the file's own picture rather than its type's icon. */
function hasPicture(ref: FileRef): boolean {
  if (ref.kind === 'image' || ref.kind === 'pdf' || ref.kind === 'video') return true;
  return PICTURED.has(storedExtension(basenameFsPath(ref.path ?? ref.target)));
}

const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

function stateOf(info: FileInfo | null | undefined): CardState {
  if (info?.status === 'lfs-missing') return 'remote';
  if (info?.status === 'missing') return 'missing';
  return 'ready';
}

/** A stored file that is gone: "Moved" when its twin with the same hash is in the files folder, otherwise "File not found". */
async function movedOrMissing(view: EditorView, ref: FileRef, draw: (state: CardState, info: null, moved?: string | null) => void): Promise<void> {
  draw('missing', null);
  const path = ref.path ?? null;
  if (!path) return;
  const found = await Promise.resolve().then(() => window.filesAPI.findMoved(path)).catch(() => null);
  if (found?.success && found.data) draw('moved', null, found.data);
  view.requestMeasure();
}

async function getFromMini(view: EditorView, card: HTMLElement, ref: FileRef, name: string): Promise<void> {
  if (!ref.path) return;
  const control = card.querySelector('button');
  if (control) {
    control.disabled = true;
    control.textContent = 'Getting…';
  }
  const result = await window.filesAPI.fetch(ref.path).catch(() => null);
  if (!result?.success || result.data !== 'here') {
    toast.error(result && !result.success ? result.error : `Could not get ${name} from the Mini.`);
    if (control) {
      control.disabled = false;
      control.textContent = 'Get from Mini';
    }
    return;
  }
  forgetInfo(ref.path);
  if (view.dom.isConnected) view.dispatch({ effects: fileChanged.of(toOpalFileUrl(ref.path)) });
  fillCard(view, card, ref, name, null);
}

const thumbnails = new Map<string, Promise<string | null>>();

/** The file's picture `px` points wide from macOS, asked once per size while the page is open. */
function thumbnailUrl(path: string, px: number): Promise<string | null> {
  const key = `${path}@${px}`;
  let url = thumbnails.get(key);
  if (!url) {
    url = Promise.resolve()
      .then(() => window.filesAPI.thumbnail(path, px, { visible: true }))
      .then((result) => (result.success ? result.data : null))
      .catch(() => null)
      .then((found) => {
        // Main keeps its own record of failures; the page asks again next time.
        if (!found) thumbnails.delete(key);
        return found;
      });
    thumbnails.set(key, url);
  }
  return url;
}

/** Puts a video's still in its card's tile, over the play glyph. */
function showStill(tile: HTMLElement, url: string): void {
  if (tile.querySelector('.cm-file-thumb')) return;
  const image = element('img', 'cm-file-thumb');
  image.src = url;
  image.alt = '';
  image.draggable = false;
  tile.append(image, iconNode('play', 16, 'cm-file-still-play'));
  tile.classList.add('cm-file-card-tile-thumb');
}

/**
 * A YouTube or Loom card shows the still kept from an earlier Load preview;
 * otherwise it offers Load preview, which has main fetch it once. The page
 * itself never fetches it.
 */
function videoStill(view: EditorView, card: HTMLElement, tile: HTMLElement, actions: HTMLElement, address: string): void {
  const load = button('Load preview', () => {
    load.disabled = true;
    load.textContent = 'Loading…';
    void Promise.resolve().then(() => window.filesAPI.videoStill(address)).catch(() => null).then((result) => {
      if (result?.success && result.data) {
        showStill(tile, result.data);
        load.remove();
        view.requestMeasure();
        return;
      }
      toast.error(result && !result.success ? result.error : 'Could not load the preview.');
      load.disabled = false;
      load.textContent = 'Load preview';
    });
  });
  actions.append(load);
  void Promise.resolve().then(() => window.filesAPI.videoStill(address, { cached: true })).catch(() => null).then((result) => {
    if (!result?.success || !result.data) return;
    showStill(tile, result.data);
    load.remove();
  });
}

/**
 * The tile is a handle that drags the file itself out of the window, to
 * Finder, Slack or Gmail. The page ignores its clicks, so the browser's own
 * drag starts; the rest of the card frames it.
 */
function dragOut(tile: HTMLElement, path: string): void {
  tile.draggable = true;
  tile.dataset.dragFile = path;
  tile.title = 'Drag to Finder, Slack or Gmail';
  tile.addEventListener('dragstart', (event) => {
    event.preventDefault();
    window.filesAPI.startDrag(path);
  });
}

const HOVER_MS = 400;
const HOVER_PX = 240;

/** After 400 ms on a card with a picture, a 240px preview of it floats above the card. Off under reduced motion. */
function hoverPreview(card: HTMLElement, path: string): void {
  if (card.dataset.hoverPreview) return;
  card.dataset.hoverPreview = 'on';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    card.querySelector('.cm-file-hover')?.remove();
  };
  card.addEventListener('mouseenter', () => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = setTimeout(() => {
      void thumbnailUrl(path, HOVER_PX).then((url) => {
        if (!url || !timer || card.querySelector('.cm-file-hover')) return;
        const float = element('span', 'cm-file-hover');
        const image = element('img');
        image.src = url;
        image.alt = '';
        float.append(image);
        card.append(float);
      });
    }, HOVER_MS);
  });
  card.addEventListener('mouseleave', hide);
}

async function thumbnailInto(view: EditorView, tile: HTMLElement, path: string, px = THUMB_PX): Promise<void> {
  const url = await thumbnailUrl(path, px);
  if (!url) return;
  const image = element('img', 'cm-file-thumb');
  image.src = url;
  image.alt = '';
  image.draggable = false;
  // Over the type's icon, which shows through a thumbnail with a transparent ground.
  tile.append(image);
  tile.classList.add('cm-file-card-tile-thumb');
  view.requestMeasure();
}

/** A caption under a preview, from Markdown-form alt text. */
function captionNode(text: string | null): HTMLElement | null {
  return text ? element('span', 'cm-file-caption', text) : null;
}

/**
 * A PDF: its first page at the column's width, cut at 360px (or its
 * `#height`), a rule, then a 40px footer with the name and "15 pages ·
 * 9.1 MB". Not downloaded, gone or unreadable, it becomes a card.
 */
export class PdfPreviewWidget extends WidgetType {
  readonly key: string;

  constructor(readonly drawn: Drawn) {
    super();
    this.key = keyOf(drawn);
  }

  eq(other: PdfPreviewWidget) { return other.key === this.key; }

  get estimatedHeight() { return (fragmentValue(this.drawn.ref, 'height') ?? PDF_HEIGHT) + 41; }

  toDOM(view: EditorView) {
    const { ref, name } = this.drawn;
    const preview = element('span', 'cm-file-preview cm-file-pdf');
    preview.dataset.object = 'file';
    const height = fragmentValue(ref, 'height') ?? PDF_HEIGHT;
    const page = element('span', 'cm-file-pdf-page');
    page.style.height = `${height}px`;
    page.append(iconNode('fileText', 20, 'cm-file-pdf-blank'));
    const footer = element('span', 'cm-file-pdf-footer');
    const meta = element('span', 'cm-file-card-meta');
    const handle = iconNode('fileText');
    footer.append(handle, element('span', 'cm-file-card-name', name), meta);
    if (ref.path) dragOut(handle, ref.path);
    preview.append(page, footer);
    const caption = captionNode(captionOf(ref));
    const wrap = element('span', 'cm-file-figure');
    wrap.append(preview);
    if (caption) wrap.append(caption);
    const path = ref.path;
    if (!path) {
      fillAsCard(view, wrap, this.drawn, 'missing');
      return wrap;
    }
    const firstPage = async () => {
      const url = await thumbnailUrl(path, Math.max(240, Math.round(view.contentDOM.clientWidth || 700)));
      if (!url || reading.has(this.key)) return;
      const image = element('img', 'cm-file-pdf-image');
      image.src = url;
      image.alt = `First page of ${name}`;
      image.draggable = false;
      page.replaceChildren(image);
    };
    const done = button('Done', () => closeReader());
    done.classList.add('cm-file-pdf-done');
    done.hidden = true;
    const read = button('Read here', () => openReader());
    read.classList.add('cm-file-pdf-read');
    const closeReader = () => {
      reading.delete(this.key);
      if (liveReader?.key === this.key) liveReader = null;
      page.classList.remove('cm-file-pdf-reading');
      page.style.height = `${height}px`;
      page.replaceChildren(iconNode('fileText', 20, 'cm-file-pdf-blank'));
      read.hidden = false;
      done.hidden = true;
      void firstPage();
      view.requestMeasure();
    };
    // Chromium's viewer, one per window; it stays through redraws until Done or Escape.
    const openReader = () => {
      if (liveReader && liveReader.key !== this.key) liveReader.close();
      let viewer = reading.get(this.key);
      if (!viewer) {
        viewer = document.createElement('embed');
        viewer.setAttribute('type', 'application/pdf');
        viewer.setAttribute('src', `${toOpalFileUrl(path)}#toolbar=0&view=FitH${fragmentValue(ref, 'page') ? `&page=${fragmentValue(ref, 'page')}` : ''}`);
        viewer.className = 'cm-file-pdf-viewer';
        reading.set(this.key, viewer);
      }
      liveReader = { key: this.key, close: closeReader, view, page };
      page.classList.add('cm-file-pdf-reading');
      page.style.height = '80vh';
      page.replaceChildren(viewer);
      read.hidden = true;
      done.hidden = false;
      view.requestMeasure();
    };
    preview.append(read, done);
    const show = (info: FileInfo | null) => {
      const state = stateOf(info);
      if (state !== 'ready') {
        fillAsCard(view, wrap, this.drawn, null);
        return;
      }
      meta.textContent = [info?.pages ? `${info.pages} ${info.pages === 1 ? 'page' : 'pages'}` : null, info?.size ? formatBytes(info.size) : null].filter(Boolean).join(' · ');
      if (reading.has(this.key)) openReader();
      else void firstPage();
    };
    const known = knownInfo(path);
    if (known !== undefined) show(known);
    else void fileInfo(path).then((info) => { show(info); view.requestMeasure(); });
    return wrap;
  }

  ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('button, embed, [data-drag-file]') !== null;
  }
}

/** The PDF viewers open with Read here, by widget, so a redraw keeps them; one is live in the window at a time. */
const reading = new Map<string, HTMLElement>();
let liveReader: { key: string; close: () => void; view: EditorView; page: HTMLElement } | null = null;

// Escape in the page that holds the reader puts the first page back. Escape anywhere else, as in a menu, is left alone.
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !liveReader) return;
    if (!liveReader.page.isConnected || !liveReader.view.dom.isConnected) {
      liveReader = null;
      return;
    }
    if (!(event.target instanceof Node) || !liveReader.view.dom.contains(event.target)) return;
    liveReader.close();
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

/** Replaces a preview's content with a card for the same file, in `state` or the one files:info says. */
function fillAsCard(view: EditorView, wrap: HTMLElement, drawn: Drawn, state: CardState | null): void {
  const card = element('span', 'cm-file-card');
  card.dataset.object = 'file';
  wrap.replaceChildren(card);
  fillCard(view, card, drawn.ref, drawn.name, state);
  view.requestMeasure();
}

/*
 * Players kept across redraws. CodeMirror may draw a line again, which makes
 * a widget's element anew; a player taken off the page waits a few seconds
 * for its widget to come back, keeping its place, and is released after.
 * Each embed has its own player, even two of the same file.
 */
const RELEASE_MS = 5000;
// MediaError.MEDIA_ERR_ABORTED: the load was stopped, which is no failure.
const MEDIA_ERR_ABORTED = 1;
const resting = new Map<string, HTMLMediaElement[]>();
const releases = new WeakMap<HTMLMediaElement, ReturnType<typeof setTimeout>>();

function takeMedia(tag: 'video' | 'audio', src: string): HTMLMediaElement {
  const waiting = resting.get(src) ?? [];
  const kept = waiting.shift();
  if (kept) {
    clearTimeout(releases.get(kept));
    return kept;
  }
  const media = document.createElement(tag);
  media.className = 'cm-file-media';
  media.controls = true;
  media.preload = 'metadata';
  media.src = src;
  watchMedia(media);
  return media;
}

function restMedia(media: HTMLMediaElement): void {
  const src = media.getAttribute('src') ?? '';
  media.remove();
  resting.set(src, [...(resting.get(src) ?? []), media]);
  releases.set(media, setTimeout(() => {
    resting.set(src, (resting.get(src) ?? []).filter((other) => other !== media));
    media.pause();
    media.removeAttribute('src');
    media.load();
  }, RELEASE_MS));
}

let observer: IntersectionObserver | null = null;

/** Pauses a player scrolled out of view. */
function watchMedia(media: HTMLMediaElement): void {
  if (typeof IntersectionObserver === 'undefined') return;
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target as HTMLMediaElement;
      if (!entry.isIntersecting && !target.paused) target.pause();
    }
  });
  observer.observe(media);
}

// Starting one player pauses the others in the window.
if (typeof document !== 'undefined') {
  document.addEventListener('play', (event) => {
    if (!(event.target instanceof HTMLMediaElement) || !event.target.classList.contains('cm-file-media')) return;
    for (const other of document.querySelectorAll<HTMLMediaElement>('.cm-file-media')) if (other !== event.target && !other.paused) other.pause();
  }, true);
}

/**
 * A video: native controls at its written width or the column's, its height
 * from the known aspect ratio, on black while it loads. Clicks go to the
 * player; a handle at its top left selects it. One Opal can't play becomes a
 * card with Open in QuickTime Player.
 */
export class VideoWidget extends WidgetType {
  readonly key: string;

  constructor(readonly drawn: Drawn) {
    super();
    this.key = keyOf(drawn);
  }

  eq(other: VideoWidget) { return other.key === this.key; }

  toDOM(view: EditorView) {
    const { ref } = this.drawn;
    const wrap = element('span', 'cm-file-figure');
    const box = element('span', 'cm-file-preview cm-file-video');
    const width = slotWidth(ref.slot);
    if (width) {
      box.style.width = `${width}px`;
      wrap.classList.add('cm-file-figure-sized');
    }
    const known = ref.path ? knownInfo(ref.path) : undefined;
    box.style.aspectRatio = known?.width && known.height ? `${known.width} / ${known.height}` : '16 / 9';
    const handle = element('span', 'cm-file-handle');
    handle.dataset.object = 'file';
    handle.title = 'Select';
    handle.append(fileIcon('film', 14));
    box.append(handle);
    wrap.append(box);
    const caption = captionNode(captionOf(ref));
    if (caption) wrap.append(caption);
    const path = ref.path;
    if (!path) {
      fillAsCard(view, wrap, this.drawn, 'missing');
      return wrap;
    }
    const start = fragmentValue(ref, 't');
    const src = `${toOpalFileUrl(path)}${start ? `#t=${start}` : ''}`;
    const attach = (info: FileInfo | null) => {
      if (stateOf(info) !== 'ready') {
        fillAsCard(view, wrap, this.drawn, null);
        return;
      }
      if (info?.width && info.height) box.style.aspectRatio = `${info.width} / ${info.height}`;
      // After the old element, if CodeMirror is drawing this line again, has been put to rest.
      queueMicrotask(() => {
        if (box.querySelector('video')) return;
        const media = takeMedia('video', src);
        media.addEventListener('error', () => {
          if (media.error && media.error.code !== MEDIA_ERR_ABORTED && wrap.contains(media)) fillAsCard(view, wrap, this.drawn, 'unplayable');
        }, { once: true });
        box.prepend(media);
      });
    };
    if (known !== undefined) attach(known);
    else void fileInfo(path).then((info) => { attach(info); view.requestMeasure(); });
    void appFor(path);
    return wrap;
  }

  destroy(dom: HTMLElement) {
    for (const media of dom.querySelectorAll<HTMLMediaElement>('video')) restMedia(media);
  }

  // Clicks go to the player, except on the handle and the card it may have become.
  ignoreEvent(event: Event) {
    if (!(event.target instanceof Element)) return true;
    if (event.target.closest('.cm-file-handle')) return false;
    return event.target.closest('.cm-file-card') === null || event.target.closest('button, [data-drag-file]') !== null;
  }
}

/** Audio: one row with the card's edge, an icon, the name and duration, and a native player on the right. */
export class AudioWidget extends WidgetType {
  readonly key: string;

  constructor(readonly drawn: Drawn) {
    super();
    this.key = keyOf(drawn);
  }

  eq(other: AudioWidget) { return other.key === this.key; }

  get estimatedHeight() { return 56; }

  toDOM(view: EditorView) {
    const { ref, name } = this.drawn;
    const wrap = element('span', 'cm-file-figure');
    const row = element('span', 'cm-file-preview cm-file-audio');
    row.dataset.object = 'file';
    const meta = element('span', 'cm-file-card-meta');
    const body = element('span', 'cm-file-card-body');
    body.append(element('span', 'cm-file-card-name', name), meta);
    const handle = iconNode('music');
    row.append(handle, body);
    if (ref.path) dragOut(handle, ref.path);
    wrap.append(row);
    const caption = captionNode(captionOf(ref));
    if (caption) wrap.append(caption);
    const path = ref.path;
    if (!path) {
      fillAsCard(view, wrap, this.drawn, 'missing');
      return wrap;
    }
    const attach = (info: FileInfo | null) => {
      if (stateOf(info) !== 'ready') {
        fillAsCard(view, wrap, this.drawn, null);
        return;
      }
      meta.textContent = [info?.duration ? formatDuration(info.duration) : null, info?.size ? formatBytes(info.size) : null].filter(Boolean).join(' · ');
      queueMicrotask(() => {
        if (row.querySelector('audio')) return;
        const media = takeMedia('audio', toOpalFileUrl(path));
        media.addEventListener('error', () => {
          if (media.error && media.error.code !== MEDIA_ERR_ABORTED && wrap.contains(media)) fillAsCard(view, wrap, this.drawn, 'unplayable');
        }, { once: true });
        row.append(media);
      });
    };
    const known = knownInfo(path);
    if (known !== undefined) attach(known);
    else void fileInfo(path).then((info) => { attach(info); view.requestMeasure(); });
    void appFor(path);
    return wrap;
  }

  destroy(dom: HTMLElement) {
    for (const media of dom.querySelectorAll<HTMLMediaElement>('audio')) restMedia(media);
  }

  ignoreEvent(event: Event) {
    if (!(event.target instanceof Element)) return true;
    return event.target.closest('audio, button, [data-drag-file]') !== null;
  }
}

/** An image the vault can't show: gone (Locate…, Remove), moved (Update link), or unreadable (Open in Preview). */
function imageFailure(view: EditorView, frame: HTMLElement, reason: 'missing' | 'unreadable'): void {
  const at = refFrom(view, frame);
  if (!at) return;
  const state: CardState = reason;
  const card = element('span', 'cm-file-card');
  card.dataset.object = 'file';
  frame.replaceChildren(card);
  frame.classList.add('cm-file-image-failed');
  const draw = (moved: string | null) => fillCard(view, card, at, shownName(at), moved ? 'moved' : state);
  draw(null);
  if (reason === 'missing' && at.path) {
    void Promise.resolve().then(() => window.filesAPI.findMoved(at.path ?? '')).then((found) => {
      if (found?.success && found.data) {
        card.replaceChildren();
        fillCardMoved(view, card, at, found.data);
      }
    }).catch(() => undefined);
  }
}

function fillCardMoved(view: EditorView, card: HTMLElement, ref: FileRef, moved: string): void {
  fillCard(view, card, ref, shownName(ref), 'moved');
  const update = card.querySelector('button');
  update?.replaceWith(button('Update link', () => { const at = refFrom(view, card); if (at) updateMovedLink(view, at, moved); }));
}

/** The widget for a file link in its look. */
function widgetFor(ctx: DecorateContext, ref: FileRef, look: FileLook): WidgetType {
  const drawn = { ref, name: shownName(ref), version: ref.path ? ctx.versions.get(toOpalFileUrl(ref.path)) ?? 0 : 0 };
  if (look === 'chip') return new FileChipWidget(drawn);
  if (look === 'card') return new FileCardWidget(drawn);
  // A preview whose file is gone is a card that says so, or that it moved.
  if (ref.path === null) return new FileCardWidget(drawn);
  if (ref.kind === 'pdf') return new PdfPreviewWidget(drawn);
  if (ref.kind === 'video') return new VideoWidget(drawn);
  if (ref.kind === 'audio') return new AudioWidget(drawn);
  const src = ref.path ? toOpalFileUrl(ref.path) : toOpalFileUrl(ref.target);
  const info = ref.path ? knownInfo(ref.path) : undefined;
  const ratio = info?.width && info.height ? info.width / info.height : null;
  return new ImageWidget(src, ref.form === 'image' ? ref.text ?? '' : fileName(ref), slotWidth(ref.slot), ctx.versions.get(src), false, {
    caption: captionOf(ref),
    file: ref.path ?? null,
    object: true,
    ratio,
    fail: imageFailure,
    measure: pictureRatio,
  });
}

/** A picture's width over height from files:info. */
async function pictureRatio(file: string): Promise<number | null> {
  const info = await fileInfo(file);
  return info?.width && info.height ? info.width / info.height : null;
}

const syntax = Decoration.mark({ class: 'cm-md-syntax' });

/**
 * In a document, a picture from the web is an object like a stored one: a
 * click frames it, its corners resize it, and Backspace frames it first.
 * A note leaves it to the live preview.
 */
function drawWebPicture(ctx: DecorateContext, node: SyntaxNode): boolean {
  if (!ctx.docMode || ctx.covered(node.from) || ctx.state.doc.lineAt(node.from).to < node.to) return false;
  const picture = webPictureOf(ctx.state, node);
  if (!picture) return false;
  const widget = new ImageWidget(picture.address, picture.alt, picture.width, ctx.versions.get(picture.address), false, { object: true });
  ctx.out.push(Decoration.replace({ widget }).range(node.from, node.to));
  return true;
}

/** Draws a file link in its look, or leaves it to the live preview when it is not a file. */
function drawFile(ctx: DecorateContext, node: SyntaxNode): boolean {
  const ref = fileRefOf(ctx.state, node, ctx.links, ctx.page);
  if (!ref) return node.name === 'Image' && drawWebPicture(ctx, node);
  if (ref.to > ctx.state.doc.lineAt(ref.from).to) return false;
  if (ctx.covered(ref.from)) return true;
  if (node.name === 'URL' && !urlCardShown(ctx.state, ref)) return false;
  const look = lookOf(ref);
  // A preview waits until its wiki target is found; the link shows as text meanwhile, one place for the caret in a document.
  if (look === 'preview' && ref.path === undefined) {
    if (ctx.docMode) ctx.unit(ref.from, ref.to);
    return false;
  }
  const widget = widgetFor(ctx, ref, look);
  if (ctx.reveal.span(ref.from, ref.to)) {
    // A note shows the link as written while the caret is in it, with its preview after it.
    ctx.out.push(syntax.range(ref.from, ref.textFrom));
    if (ref.to > ref.textTo) ctx.out.push(syntax.range(ref.textTo, ref.to));
    if (look === 'preview') ctx.out.push(Decoration.widget({ widget, side: 1 }).range(ref.to));
    return true;
  }
  ctx.out.push(Decoration.replace({ widget }).range(ref.from, ref.to));
  return true;
}

/**
 * A bare video address alone on its line shows as written while it is typed,
 * and while a document's caret is at its start (urlChips.ts).
 */
function urlCardShown(state: EditorState, ref: FileRef): boolean {
  return !typingAt(state, ref.to) && !(state.facet(docMode) && caretAtStart(state, ref.from));
}

/** The file link a syntax node is, read with the page's links. */
export function refOfNode(state: EditorState, node: SyntaxNode): FileRef | null {
  const links = state.field(resolvedLinks, false) ?? new Map<string, string | null>();
  return fileRefOf(state, node, links, state.facet(pageContext).path);
}

function kindFor(block: boolean): ObjectKind {
  return {
    kind: block ? 'file' : 'file-inline',
    nodes: FILE_NODES,
    block,
    test: (state, node) => {
      const ref = refOfNode(state, node);
      return ref !== null && ref.alone === block && (node.name !== 'URL' || urlCardShown(state, ref));
    },
    open: (view, obj) => { const ref = refAt(view.state, obj); if (ref) void openFile(view, ref, 'main'); },
    actions: (state, obj) => fileActions(state, obj),
    destination: (state, obj) => destinationOf(state, obj),
    // Space on a framed file opens Quick Look.
    onKey: (view, obj, event) => {
      if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return false;
      const ref = refAt(view.state, obj);
      if (!ref?.path) return false;
      void quickLookFile(ref);
      return true;
    },
  };
}

/** A picture from the web in a document: a block on its own line, framed first, and inline in text. */
function webPictureKind(block: boolean): ObjectKind {
  return {
    kind: block ? 'web-picture' : 'web-picture-inline',
    nodes: ['Image'],
    block,
    test: (state, node) => {
      if (!state.facet(docMode)) return false;
      const picture = webPictureOf(state, node);
      return picture !== null && picture.alone === block;
    },
    open: (view, obj) => { const picture = webPictureIn(view.state, obj); if (picture) window.open(picture.address, '_blank'); },
    actions: (state, obj) => webPictureActions(state, obj),
    destination: (state, obj) => {
      const picture = webPictureIn(state, obj);
      if (!picture) return null;
      try {
        const url = new URL(picture.address);
        return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;
      } catch {
        return picture.address;
      }
    },
  };
}

/**
 * In a note, a click on a chip or card opens its file; Cmd+click opens it in
 * a new tab. A document frames it on a click and follows it on Cmd+click.
 */
const fileClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const target = event.target.closest<HTMLElement>('.cm-file-chip:not(.cm-url-chip), .cm-file-card, .cm-file-preview, .cm-md-image[data-object]');
    if (!target || target.closest('button')) return false;
    const inDocument = view.state.field(objectFrame, false) !== undefined;
    if (inDocument ? !opensNewTab(event) : !target.matches('.cm-file-chip, .cm-file-card')) return false;
    const ref = refFrom(view, target);
    if (!ref) return false;
    event.preventDefault();
    void openFile(view, ref, 'main', opensNewTab(event));
    return true;
  },
});

const FRAMEABLE = '.cm-file-chip, .cm-file-card, .cm-file-preview, .cm-md-image[data-object]';

/**
 * A frame's mark never reaches a widget inside a line, so the framed file's
 * own element takes `data-file-framed`, which draws the ring (files.css).
 */
const framedFiles = ViewPlugin.fromClass(class {
  marked: Element[] = [];

  constructor(view: EditorView) {
    this.schedule(view);
  }

  update(update: ViewUpdate) {
    const frame = (state: EditorState) => state.field(objectFrame, false) ?? null;
    if (update.docChanged || update.viewportChanged || update.geometryChanged || frame(update.startState) !== frame(update.state)) this.schedule(update.view);
  }

  schedule(view: EditorView) {
    view.requestMeasure({ key: this, read: () => null, write: () => this.apply(view) });
  }

  apply(view: EditorView) {
    const frame = view.state.field(objectFrame, false) ?? null;
    const next: Element[] = [];
    if (frame) {
      for (const candidate of view.contentDOM.querySelectorAll(FRAMEABLE)) {
        if (candidate.parentElement?.closest(FRAMEABLE)) continue;
        let at: number;
        try { at = view.posAtDOM(candidate); } catch { continue; }
        if (at >= frame.from && at <= frame.to) next.push(candidate);
      }
    }
    // Only real changes: each one is a mutation CodeMirror reads.
    for (const element of this.marked) if (!next.includes(element)) element.removeAttribute('data-file-framed');
    for (const element of next) if (!element.hasAttribute('data-file-framed')) element.setAttribute('data-file-framed', '');
    this.marked = next;
  }

  destroy() {
    for (const element of this.marked) element.removeAttribute('data-file-framed');
  }
});

/** Files on every page: their looks, and in documents their objects and bar. */
export const fileObjects: Extension = [
  nodeDecorators.of({ nodes: FILE_NODES, decorate: drawFile }),
  objectKinds.of(kindFor(true)),
  objectKinds.of(kindFor(false)),
  objectKinds.of(webPictureKind(true)),
  objectKinds.of(webPictureKind(false)),
  Prec.highest(fileClicks),
  framedFiles,
  wikiNames,
  urlChips,
  linkPicker,
];
