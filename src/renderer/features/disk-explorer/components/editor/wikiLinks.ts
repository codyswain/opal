import { syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { Facet, Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';
import { toast } from 'sonner';
import { classifyFile, isDocFile, pageName, storedExtension } from '@/common/fileKind';
import { basenameFsPath, isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import { LINK_TARGET_LIMIT } from '@/types/markdown';
import { setLinkEditor } from './linkEditorEffect';
import { nodeDecorators, objectKinds, type DecorateContext } from './extensionPoints';
import { docMode } from './livePreview';

const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const BANG = 33;
const NEWLINE = 10;

/**
 * Obsidian's [[wiki links]] and ![[embeds]] as WikiLink and Embed nodes, each
 * with a WikiLinkMark on either side. What sits between the marks is the
 * target, with an optional "#heading" and "|alias", and is not parsed any
 * further, so underscores and asterisks in file names stay text.
 */
export const wikiLinkSyntax: MarkdownConfig = {
  defineNodes: ['WikiLink', 'Embed', { name: 'WikiLinkMark', style: tags.processingInstruction }],
  parseInline: [{
    name: 'WikiLink',
    before: 'Link',
    parse(cx, next, pos) {
      const embed = next === BANG;
      const open = embed ? pos + 1 : pos;
      if ((!embed && next !== OPEN_BRACKET) || cx.char(open) !== OPEN_BRACKET || cx.char(open + 1) !== OPEN_BRACKET) return -1;
      for (let close = open + 2; close < cx.end - 1; close += 1) {
        const char = cx.char(close);
        if (char === NEWLINE || char === OPEN_BRACKET) return -1;
        if (char !== CLOSE_BRACKET || cx.char(close + 1) !== CLOSE_BRACKET) continue;
        if (close === open + 2) return -1;
        return cx.addElement(cx.elt(embed ? 'Embed' : 'WikiLink', pos, close + 2, [
          cx.elt('WikiLinkMark', pos, open + 2),
          cx.elt('WikiLinkMark', close, close + 2),
        ]));
      }
      return -1;
    },
  }],
};

export interface WikiTarget {
  /** The note or file name, without heading or alias. Empty for a link to a heading on this page. */
  target: string;
  heading: string | null;
  /** Where the alias starts inside the link text, or null without one. */
  aliasAt: number | null;
}

/** Splits the text between "[[" and "]]". A pipe escaped for a table ("\|") still starts the alias. */
export function parseWikiTarget(inner: string): WikiTarget {
  const bar = inner.indexOf('|');
  const link = (bar === -1 ? inner : inner.slice(0, bar)).replace(/\\$/, '');
  const hash = link.indexOf('#');
  return {
    target: (hash === -1 ? link : link.slice(0, hash)).trim(),
    heading: hash === -1 ? null : link.slice(hash + 1).trim(),
    aliasAt: bar === -1 ? null : bar + 1,
  };
}

/** Opens a followed link's file: in the page's own tab, or in a new tab with `newTab`. */
export type OpenNote = (path: string, newTab: boolean) => void;

/** The page being edited, and how its links open other pages. */
export interface PageContext {
  path: string;
  openNote: OpenNote;
}

/** A Cmd+click or a middle-click follows a link into a new tab, as it opens a file from the tree. */
export function opensNewTab(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

export const pageContext = Facet.define<PageContext, PageContext>({
  combine: (values) => values[0] ?? { path: '', openNote: () => undefined },
});

/** Tells the page where link targets point, such as a file it just stored. */
export const linksResolved = StateEffect.define<Record<string, string | null>>();

/** Wiki link targets on this page and the files they resolve to; null for a link to nothing yet. */
export const resolvedLinks = StateField.define<ReadonlyMap<string, string | null>>({
  create: () => new Map(),
  update(links, tr) {
    for (const effect of tr.effects) {
      if (effect.is(linksResolved)) links = new Map([...links, ...Object.entries(effect.value)]);
    }
    return links;
  },
});

function linkTargets(state: EditorState): Set<string> {
  const targets = new Set<string>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'WikiLink' && node.name !== 'Embed') return;
      const marks = node.node.getChildren('WikiLinkMark');
      if (marks.length < 2) return false;
      const { target } = parseWikiTarget(state.sliceDoc(marks[0].to, marks[1].from));
      if (target) targets.add(target);
      return false;
    },
  });
  return targets;
}

/** Asks the main process where this page's links point, for new targets only, shortly after typing stops. */
const linkResolver = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private live = true;

  constructor(view: EditorView) {
    this.schedule(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.schedule(update.view);
  }

  destroy() {
    this.live = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(view: EditorView) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.resolve(view); }, 150);
  }

  private async resolve(view: EditorView) {
    const known = view.state.field(resolvedLinks);
    const wanted = [...linkTargets(view.state)].filter((target) => !known.has(target)).slice(0, LINK_TARGET_LIMIT);
    if (wanted.length === 0) return;
    const response = await window.markdownAPI.resolveLinks(view.state.facet(pageContext).path, wanted).catch(() => null);
    if (this.live && response?.success) view.dispatch({ effects: linksResolved.of(response.data) });
  }
});

export const wikiLinks = [resolvedLinks, linkResolver];

/**
 * Types a missing link names as a file, not a note: everything Opal shows or
 * stores, Office and iWork, CAD, archives, Excalidraw and Obsidian's canvas
 * and base. A link to one of these that points at nothing creates nothing.
 */
export const KNOWN_BINARY: ReadonlySet<string> = new Set([
  'pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls', 'key', 'pages', 'numbers', 'stl', '3mf', 'step', 'stp', 'obj', 'iges', 'igs', 'f3d',
  'zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar', 'dmg', 'excalidraw', 'canvas', 'base', 'gcode', 'sketch', 'fig',
]);

/** Whether a link target names a file rather than a note, by its extension alone: `deck.pptx` does, `v0.2` and `Meeting 10.30` don't. */
export function namesFile(target: string): boolean {
  const kind = classifyFile(target);
  if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio' || kind === 'text') return true;
  const extension = storedExtension(basenameFsPath(target));
  return KNOWN_BINARY.has(extension) || KNOWN_BINARY.has(extension.split('.').pop() ?? '');
}

/**
 * The note a missing link would create: its name, and ".mdo" for a target
 * that names a document, ".md" otherwise. Null for a target that names a
 * file, which a link can't create.
 */
export function noteToCreate(target: string): { name: string; extension: 'md' | 'mdo' } | null {
  if (namesFile(target)) return null;
  return { name: pageName(basenameFsPath(target)).normalize('NFC'), extension: isDocFile(target) ? 'mdo' : 'md' };
}

/**
 * Follows a wiki link. A link to a note that does not exist yet creates it at
 * the top of the opened folder, the way Obsidian does, and opens it; a link
 * to a missing file says so and creates nothing.
 */
export async function openWikiLink(view: EditorView, written: string, newTab = false): Promise<void> {
  const { path, openNote } = view.state.facet(pageContext);
  const hash = written.indexOf('#');
  const target = hash === -1 ? written : written.slice(0, hash);
  const heading = hash === -1 ? null : written.slice(hash + 1);
  // A heading on this page: scroll to it.
  if (!target && heading) {
    const at = headingLine(view.state, heading);
    if (at !== null) view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    else toast.error(`Could not find the heading ${heading}.`);
    return;
  }
  const wanted = target.normalize('NFC');
  const response = await window.markdownAPI.resolveLinks(path, [wanted]).catch(() => null);
  const resolved = response?.success ? response.data[wanted] : null;
  if (resolved) {
    if (heading) pendingHeadings.set(resolved, heading);
    openNote(resolved, newTab);
    return;
  }
  const note = noteToCreate(wanted);
  const roots = note ? await window.diskAPI.listRoots().catch(() => null) : null;
  const root = roots?.success ? roots.data.find((candidate: string) => isFsPathAtOrBelow(candidate, path)) : undefined;
  const folder = root && (wanted.includes('/') ? parentFsPath(`${root}/${wanted}`) : root);
  if (!note || !folder) {
    toast.error(`Could not find ${target}.`);
    return;
  }
  const created = await window.markdownAPI.create(folder, note.name, note.extension);
  if (!created.success) {
    toast.error(created.error);
    return;
  }
  view.dispatch({ effects: linksResolved.of({ [target]: created.data.path }) });
  openNote(created.data.path, newTab);
}

/** Headings a followed link asked for, by page, until that page's editor opens and scrolls there. */
const pendingHeadings = new Map<string, string>();

/** A page opened from `[[Plan#Goals]]` scrolls to Goals once its text is read. */
const headingOnOpen = ViewPlugin.define((view) => {
  const page = view.state.facet(pageContext).path;
  const heading = pendingHeadings.get(page);
  if (heading) {
    pendingHeadings.delete(page);
    setTimeout(() => {
      const at = view.dom.isConnected ? headingLine(view.state, heading) : null;
      if (at !== null) view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    }, 0);
  }
  return {};
});

/** Where the heading named `name` starts on the page, matching as Obsidian does: case and spacing aside. */
export function headingLine(state: EditorState, name: string): number | null {
  const wanted = name.trim().toLowerCase().replace(/\s+/g, ' ');
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line.text);
    if (match && match[1].toLowerCase().replace(/\s+/g, ' ') === wanted) return line.from;
  }
  return null;
}

/** How a wiki link to a note reads: "Plan", "Plan › Goals", or "Goals" for a heading on this page. */
export function wikiDisplay(link: WikiTarget): string {
  const name = link.target ? pageName(basenameFsPath(link.target.replace(/\/+$/, ''))) : '';
  if (!link.heading) return name || link.target;
  const heading = link.heading.replace(/^\^/, '');
  return name ? `${name} › ${heading}` : heading;
}

/** An unaliased wiki link to a note, drawn as its name so the caret steps over it whole and its target changes only in the link form. */
class WikiNameWidget extends WidgetType {
  constructor(readonly text: string, readonly target: string, readonly missing: boolean) { super(); }

  eq(other: WikiNameWidget) {
    return other.text === this.text && other.target === this.target && other.missing === this.missing;
  }

  toDOM() {
    const link = document.createElement('span');
    link.className = this.missing ? 'cm-md-wikilink cm-md-unresolved' : 'cm-md-wikilink';
    link.dataset.wikiName = '';
    if (this.target) link.dataset.wikiTarget = this.target;
    link.textContent = this.text;
    return link;
  }

  ignoreEvent() { return false; }
}

/** The text between a wiki link's brackets, or null for one with an alias, which stays editable text. */
function unaliased(state: EditorState, node: SyntaxNode): { link: WikiTarget; from: number; to: number } | null {
  const [open, close] = node.getChildren('WikiLinkMark');
  if (!open || !close) return null;
  const link = parseWikiTarget(state.sliceDoc(open.to, close.from));
  if (link.aliasAt !== null || (!link.target && !link.heading)) return null;
  return { link, from: node.from, to: node.to };
}

/** Draws an unaliased wiki link to a note as its name; a link to a file is fileWidgets.ts's. */
function drawWikiName(ctx: DecorateContext, node: SyntaxNode): boolean {
  const found = unaliased(ctx.state, node);
  if (!found || ctx.covered(node.from) || ctx.reveal.span(node.from, node.to)) return false;
  if (found.link.target && (ctx.links.get(found.link.target) ? classifyFile(ctx.links.get(found.link.target) ?? '') !== 'markdown' : namesFile(found.link.target))) return false;
  if (ctx.state.doc.lineAt(node.from).to < node.to) return false;
  const missing = Boolean(found.link.target) && ctx.links.get(found.link.target) === null;
  // A heading is followed as "Plan#Goals", or "#Goals" on this page, which scrolls there.
  const follow = `${found.link.target}${found.link.heading ? `#${found.link.heading}` : ''}`;
  ctx.out.push(Decoration.replace({ widget: new WikiNameWidget(wikiDisplay(found.link), follow, missing) }).range(node.from, node.to));
  return true;
}

/** Copies text to the pasteboard, saying so. */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied as Markdown.');
  } catch {
    toast.error('Could not copy.');
  }
}

/** In a document, an unaliased wiki link to a note is one object: one Backspace takes it, and the link form changes its target. */
const wikiObject = objectKinds.of({
  kind: 'wikilink',
  nodes: ['WikiLink'],
  block: false,
  test: (state, node) => {
    if (!state.facet(docMode)) return false;
    const found = unaliased(state, node);
    if (!found) return false;
    const file = found.link.target ? state.field(resolvedLinks, false)?.get(found.link.target) : undefined;
    return file ? classifyFile(file) === 'markdown' : !namesFile(found.link.target);
  },
  open: (view, obj) => {
    const link = parseWikiTarget(view.state.sliceDoc(obj.from + 2, obj.to - 2));
    if (link.target || link.heading) void openWikiLink(view, `${link.target}${link.heading ? `#${link.heading}` : ''}`);
  },
  destination: (state, obj) => {
    const inner = state.sliceDoc(obj.from + 2, obj.to - 2);
    const link = parseWikiTarget(inner);
    const file = link.target ? state.field(resolvedLinks, false)?.get(link.target) : null;
    const folder = file ? parentFsPath(file)?.split('/').pop() : link.target.includes('/') ? parentFsPath(link.target) : null;
    return [wikiDisplay(link), folder].filter(Boolean).join(' · ');
  },
  actions: () => [
    {
      id: 'open',
      label: 'Open',
      run: (view, obj) => {
        const link = parseWikiTarget(view.state.sliceDoc(obj.from + 2, obj.to - 2));
        // Another page opens in a new tab at the heading; a heading on this page scrolls to it.
        if (link.target || link.heading) void openWikiLink(view, `${link.target}${link.heading ? `#${link.heading}` : ''}`, Boolean(link.target));
      },
    },
    { id: 'edit-link', label: 'Edit link', shortcut: '⌘K', run: (view, obj) => view.dispatch({ effects: setLinkEditor.of({ from: obj.from, to: obj.to, editing: true }) }) },
    { id: 'copy-markdown', label: 'Copy as Markdown', run: (view, obj) => { void copy(view.state.sliceDoc(obj.from, obj.to)); } },
    { id: 'remove', label: 'Remove', run: (view, obj) => view.dispatch({ changes: { from: obj.from, to: obj.to }, selection: { anchor: obj.from }, annotations: isolateHistory.of('full'), userEvent: 'delete' }) },
  ],
});

/**
 * A click on a link drawn by name, in a document: the caret goes after it,
 * since it is one object, and its popover shows. Cmd+click follows it.
 */
const wikiNameClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || opensNewTab(event) || !view.state.facet(docMode) || !(event.target instanceof Element)) return false;
    const element = event.target.closest('[data-wiki-name]');
    if (!element) return false;
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(view.posAtDOM(element), 1);
    while (node && node.name !== 'WikiLink') node = node.parent;
    if (!node) return false;
    event.preventDefault();
    view.dispatch({ selection: { anchor: node.to }, effects: setLinkEditor.of({ from: node.from, to: node.to, editing: false }) });
    view.focus();
    return true;
  },
});

/** Wiki links to notes drawn by name, and in documents as objects. */
export const wikiNames: Extension = [
  nodeDecorators.of({ nodes: ['WikiLink'], decorate: drawWikiName }),
  wikiObject,
  Prec.highest(wikiNameClicks),
  headingOnOpen,
];

/**
 * Follows a Markdown link to a file by its path: relative to the page, or to
 * the top of the opened folder when it starts with "/". The main process
 * resolves it, so only files under the opened roots open.
 */
export async function openPathLink(view: EditorView, href: string, newTab = false): Promise<void> {
  const { path, openNote } = view.state.facet(pageContext);
  let written = href.replace(/[?#].*$/, '');
  // A link to a heading on this page goes nowhere yet.
  if (!written) return;
  try { written = decodeURI(written); } catch { /* keep it as written */ }
  const target = /^(\/|\.\.?\/)/.test(written) ? written : `./${written}`;
  const response = await window.markdownAPI.resolveLinks(path, [target]).catch(() => null);
  const resolved = response?.success ? response.data[target] : null;
  if (resolved) openNote(resolved, newTab);
  else toast.error(`Could not find ${written}.`);
}
