import { syntaxTree } from '@codemirror/language';
import { Facet, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';
import { toast } from 'sonner';
import { classifyFile } from '@/common/fileKind';
import { basenameFsPath, isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import { LINK_TARGET_LIMIT } from '@/types/markdown';

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

/** The page being edited, and how its links open other pages. */
export interface PageContext {
  path: string;
  openNote: (path: string) => void;
}

export const pageContext = Facet.define<PageContext, PageContext>({
  combine: (values) => values[0] ?? { path: '', openNote: () => undefined },
});

const linksResolved = StateEffect.define<Record<string, string | null>>();

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
 * Follows a wiki link. A link to a note that does not exist yet creates it at
 * the top of the opened folder, the way Obsidian does, and opens it.
 */
export async function openWikiLink(view: EditorView, target: string): Promise<void> {
  const { path, openNote } = view.state.facet(pageContext);
  const response = await window.markdownAPI.resolveLinks(path, [target]).catch(() => null);
  const resolved = response?.success ? response.data[target] : null;
  if (resolved) {
    openNote(resolved);
    return;
  }
  const kind = classifyFile(target);
  const roots = await window.diskAPI.listRoots().catch(() => null);
  const root = roots?.success ? roots.data.find((candidate: string) => isFsPathAtOrBelow(candidate, path)) : undefined;
  const folder = root && (target.includes('/') ? parentFsPath(`${root}/${target}`) : root);
  if (!folder || (kind !== 'markdown' && kind !== 'other')) {
    toast.error(`Could not find ${target}.`);
    return;
  }
  const created = await window.markdownAPI.create(folder, basenameFsPath(target).replace(/\.md$/i, ''));
  if (!created.success) {
    toast.error(created.error);
    return;
  }
  view.dispatch({ effects: linksResolved.of({ [target]: created.data.path }) });
  openNote(created.data.path);
}
