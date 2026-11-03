import { isolateHistory } from '@codemirror/commands';
import { Prec, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { toast } from 'sonner';
import { nodeDecorators, objectKinds, type DecorateContext } from './extensionPoints';
import { escapeLinkText } from './fileActions';
import { fileIcon, type FileIconName } from './fileIcons';
import { fileRefOf, inCode, inTableAt, videoService } from './fileEmbeds';
import { autolinkHref, docMode, openLink } from './livePreview';

/*
 * Bare addresses of the services Cody works in, drawn as chips with a grey
 * glyph and a label read from the address alone: "SW-640", "opal#13",
 * "Google Doc", "Email". Nothing is fetched. A chip forms once the address
 * is ended by a space, Enter or a paste, so typing one is never interrupted.
 * A YouTube or Loom address alone on its line is a card (fileWidgets.ts).
 * Written links with their own text stay ordinary links.
 */

export interface UrlChip {
  label: string;
  icon: FileIconName;
  service: string;
}

const segments = (url: URL) => url.pathname.split('/').filter(Boolean).map((part) => {
  try { return decodeURIComponent(part); } catch { return part; }
});

/** The chip for a known service's address, or null for any other. */
export function urlChip(address: string): UrlChip | null {
  let url: URL;
  try { url = new URL(address); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = segments(url);
  if (host === 'linear.app') {
    const issue = path.indexOf('issue');
    if (issue !== -1 && path[issue + 1]) return { label: path[issue + 1].toUpperCase(), icon: 'squareKanban', service: 'Linear' };
    if (path.includes('project')) return { label: 'Linear project', icon: 'squareKanban', service: 'Linear' };
    return { label: 'Linear', icon: 'squareKanban', service: 'Linear' };
  }
  if (host === 'github.com' && path.length >= 2) {
    const [owner, repo, kind, id] = path;
    if ((kind === 'pull' || kind === 'issues') && id) return { label: `${repo}#${id}`, icon: 'github', service: 'GitHub' };
    if (kind === 'commit' && id) return { label: `${repo}@${id.slice(0, 7)}`, icon: 'github', service: 'GitHub' };
    if ((kind === 'blob' || kind === 'tree') && path.length > 4) return { label: path[path.length - 1], icon: 'github', service: 'GitHub' };
    return { label: `${owner}/${repo}`, icon: 'github', service: 'GitHub' };
  }
  if (host === 'docs.google.com') {
    if (path[0] === 'document') return { label: 'Google Doc', icon: 'fileText', service: 'Google Docs' };
    if (path[0] === 'spreadsheets') return { label: 'Google Sheet', icon: 'sheet', service: 'Google Sheets' };
    if (path[0] === 'presentation') return { label: 'Google Slides', icon: 'presentation', service: 'Google Slides' };
    if (path[0] === 'forms') return { label: 'Google Form', icon: 'fileText', service: 'Google Forms' };
    return null;
  }
  if (host === 'drive.google.com') return { label: path.includes('folders') ? 'Drive folder' : 'Drive file', icon: path.includes('folders') ? 'folder' : 'file', service: 'Google Drive' };
  if (host === 'calendar.google.com') return { label: 'Calendar event', icon: 'calendar', service: 'Google Calendar' };
  if (host === 'mail.google.com') return { label: 'Email', icon: 'mail', service: 'Gmail' };
  if (host.endsWith('.slack.com') || host === 'slack.com') {
    return { label: path[0] === 'archives' && path[2] ? 'Slack message' : path[0] === 'archives' ? 'Slack channel' : 'Slack', icon: 'slack', service: 'Slack' };
  }
  if (host === 'figma.com') {
    const name = path.length >= 3 && ['file', 'design', 'board', 'proto'].includes(path[0]) ? path[2].replace(/-/g, ' ').trim() : '';
    return { label: name || 'Figma file', icon: 'figma', service: 'Figma' };
  }
  if (host.endsWith('onshape.com') && path[0] === 'documents') return { label: 'Onshape document', icon: 'box', service: 'Onshape' };
  if (host === 'notion.so' || host.endsWith('.notion.site')) {
    const slug = path[path.length - 1] ?? '';
    const title = slug.replace(/-?[0-9a-f]{32}$/i, '').replace(/-/g, ' ').trim();
    return { label: title || 'Notion page', icon: 'fileText', service: 'Notion' };
  }
  const video = videoService(url.href);
  if (video) return { label: `${video} video`, icon: 'play', service: video };
  return null;
}

/** Where an address being typed ends, while the caret sits right after it; null once a space, Enter, paste or move ends it. */
const typingAddress = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    if (tr.isUserEvent('input.type')) {
      const head = tr.state.selection.main.head;
      return /\S/.test(tr.state.sliceDoc(head - 1, head)) ? head : null;
    }
    if (!tr.docChanged && !tr.selection) return value;
    return null;
  },
});

class UrlChipWidget extends WidgetType {
  constructor(readonly href: string, readonly chip: UrlChip) { super(); }

  eq(other: UrlChipWidget) {
    return other.href === this.href && other.chip.label === this.chip.label;
  }

  toDOM() {
    const chip = document.createElement('span');
    chip.className = 'cm-file-chip cm-url-chip';
    chip.dataset.object = 'url';
    chip.dataset.href = this.href;
    chip.setAttribute('role', 'link');
    chip.setAttribute('aria-label', `${this.chip.service}, ${this.chip.label}`);
    chip.title = this.href;
    const icon = document.createElement('span');
    icon.className = 'cm-file-chip-icon';
    icon.append(fileIcon(this.chip.icon, 16));
    const label = document.createElement('span');
    label.className = 'cm-file-chip-name';
    label.textContent = this.chip.label;
    chip.append(icon, label);
    return chip;
  }

  ignoreEvent() { return false; }
}

/** A bare address of a known service, not inside a written link. */
function bareAddress(state: EditorState, node: SyntaxNode): { href: string; chip: UrlChip } | null {
  const parent = node.parent?.name;
  if (parent === 'Link' || parent === 'Image' || parent === 'LinkReference' || parent === 'Autolink') return null;
  const href = autolinkHref(state.sliceDoc(node.from, node.to));
  const chip = urlChip(href);
  return chip ? { href, chip } : null;
}

/** In a document, the caret at an address's start shows it as written. */
export function caretAtStart(state: EditorState, from: number): boolean {
  return state.selection.ranges.some((range) => range.empty && range.head === from);
}

/** Whether the address ending at `to` is still being typed, so it shows as written. */
export function typingAt(state: EditorState, to: number): boolean {
  return state.field(typingAddress, false) === to;
}

/**
 * Whether a bare address of a known service draws as a chip: not while it is
 * typed, only at a word's start, and in a document not while the caret is at
 * its start. The chip and its object follow the same rule.
 */
function chipShown(state: EditorState, node: SyntaxNode): { href: string; chip: UrlChip } | null {
  const found = bareAddress(state, node);
  if (!found || typingAt(state, node.to)) return null;
  // Only an address that starts a word: "https://www.x.com" with a letter typed before it reads "www.x.com" as one.
  if (!/^$|[\s(*_~<>"']$/.test(state.sliceDoc(node.from - 1, node.from))) return null;
  // A letter typed right before an address joins it, and Markdown then reads neither as a link, so in a document
  // the address shows as written while the caret is at its start.
  if (state.facet(docMode) && caretAtStart(state, node.from)) return null;
  return found;
}

function drawUrl(ctx: DecorateContext, node: SyntaxNode): boolean {
  const found = chipShown(ctx.state, node);
  if (!found || ctx.covered(node.from) || ctx.reveal.span(node.from, node.to)) return false;
  ctx.out.push(Decoration.replace({ widget: new UrlChipWidget(found.href, found.chip) }).range(node.from, node.to));
  return true;
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast.error('Could not copy.');
  }
}

/**
 * In a document, a drawn service chip is one object: one Backspace takes it,
 * and its bar opens or copies the address. A video address alone on its line
 * is a card instead (fileWidgets.ts).
 */
const urlObject = objectKinds.of({
  kind: 'url',
  nodes: ['URL'],
  block: false,
  test: (state, node) => chipShown(state, node) !== null && fileRefOf(state, node, new Map(), '') === null,
  open: (view, obj) => openLink(view, autolinkHref(view.state.sliceDoc(obj.from, obj.to)), false),
  destination: (state, obj) => {
    try {
      const url = new URL(autolinkHref(state.sliceDoc(obj.from, obj.to)));
      return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      return null;
    }
  },
  actions: () => [
    { id: 'open', label: 'Open', run: (view, obj) => openLink(view, autolinkHref(view.state.sliceDoc(obj.from, obj.to)), false) },
    { id: 'copy-link', label: 'Copy link', run: (view, obj) => { void copy(autolinkHref(view.state.sliceDoc(obj.from, obj.to)), 'Link copied.'); } },
    { id: 'remove', label: 'Remove', run: (view, obj) => view.dispatch({ changes: { from: obj.from, to: obj.to }, annotations: isolateHistory.of('full'), userEvent: 'delete' }) },
  ],
});

/** The anchor text and address of a link dragged from a browser, or null for any other drag. */
export function droppedLink(data: Pick<DataTransfer, 'getData' | 'types'>): { text: string; url: string } | null {
  if (data.types.includes('Files')) return null;
  const url = (data.getData('text/uri-list') || '').split(/\r?\n/).find((line) => line && !line.startsWith('#'))?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const html = data.getData('text/html');
  let text = '';
  if (html) {
    const anchor = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    text = anchor?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }
  return { text: text || url, url };
}

/**
 * A link dragged from a browser goes in as `[Anchor](url)` where it drops,
 * its text escaped so it stays the link's text, with `\|` in a table. Into
 * code it goes in as the bare address. Text dragged within the page is left
 * to CodeMirror.
 */
const browserLinkDrops = EditorView.domEventHandlers({
  drop(event, view) {
    const data = event.dataTransfer;
    if (!data || view.state.readOnly || data.types.includes('application/x-codemirror')) return false;
    const link = droppedLink(data);
    if (!link) return false;
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    const insert = inCode(view.state, at) ? link.url : `[${escapeLinkText(link.text, inTableAt(view.state, at))}](${/[\s()<>]/.test(link.url) ? `<${link.url}>` : link.url})`;
    event.preventDefault();
    view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, annotations: isolateHistory.of('full'), userEvent: 'input.drop' });
    view.focus();
    return true;
  },
});

/** Service chips on every page, and links dropped from a browser. */
export const urlChips: Extension = [typingAddress, nodeDecorators.of({ nodes: ['URL'], decorate: drawUrl }), urlObject, Prec.high(browserLinkDrops)];
