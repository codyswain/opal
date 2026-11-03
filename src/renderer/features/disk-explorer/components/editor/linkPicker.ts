import { acceptCompletion, autocompletion, completionStatus, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { isolateHistory } from '@codemirror/commands';
import { Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { Link2 } from 'lucide-react';
import { classifyFile, fileTreeLabel, pageName, withoutHash } from '@/common/fileKind';
import { basenameFsPath, isFsPathAtOrBelow, parentFsPath } from '@/common/fsPaths';
import type { CollectionQuery, CollectionRow } from '@/types/collectionQuery';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../../store/diskStore';
import { vaultRelativePath } from '../tabLabels';
import { insertItems } from './extensionPoints';
import { iconFor, inCode, inTableAt } from './fileEmbeds';
import { fileIcon } from './fileIcons';
import { WIKI_UNSAFE, linkFor, wikiAlias } from './fileActions';
import { insertFileItem, insertedText } from './imageInsert';
import { linksResolved, pageContext } from './wikiLinks';

/*
 * The link picker. Typing "[[" (or Insert > Link to note or file…) lists
 * notes, documents and files from the opened folders, recently opened first
 * and then by a fuzzy match on name and path, each with a grey kind icon and
 * its folder. Enter puts the pick in as a file goes in: a chip inside text,
 * its type's look on an empty line, a note as a link. Option+Enter always
 * puts in a plain link. ⌘K's address field lists the same matches.
 */

const LIMIT = 30;

/** Notes, documents and files matching `text`, recent first when it is empty. */
export async function findLinkTargets(text: string, limit = LIMIT): Promise<DiskEntry[]> {
  const query: CollectionQuery = {
    version: 1,
    scope: { kind: 'all-roots' },
    filters: [
      { field: 'kind', op: 'not-in', values: ['directory'] },
      ...(text.trim() ? [{ field: 'name' as const, op: 'matches' as const, value: text.trim() }] : []),
    ],
    sort: text.trim() ? { field: 'match', direction: 'desc' } : { field: 'touched', direction: 'desc' },
  };
  const result: Awaited<ReturnType<typeof window.collectionsAPI.query>> | null = await Promise.resolve()
    .then(() => window.collectionsAPI.query(query, { offset: 0, limit }))
    .catch(() => null);
  return result?.success && result.data ? result.data.rows.map((row: CollectionRow) => row.entry).filter((entry: DiskEntry) => !entry.isDirectory) : [];
}

/** The picked file's path from the top of the opened folder holding it. */
function vaultPath(path: string): string {
  const root = useDiskStore.getState().roots.filter((candidate) => isFsPathAtOrBelow(candidate, path)).sort((a, b) => b.length - a.length)[0];
  return root ? vaultRelativePath(path, [root]) : path;
}

/** The folder a row shows, from the vault's top. */
export function folderOf(path: string): string {
  const relative = vaultPath(path);
  return parentFsPath(relative) ?? '';
}

/** A row's name: a note without ".md", a stored file without its hash. */
export function rowLabel(entry: Pick<DiskEntry, 'name' | 'kind'>): string {
  return entry.kind === 'markdown' ? fileTreeLabel(entry.name, entry.kind) : withoutHash(entry.name);
}

/**
 * What a pick writes. A note: `[[Library/x/Plan|Plan]]`, a document keeping
 * ".mdo". A file: a chip in text, or on an empty line its type's look; with
 * `asLink` always a link, `[[path|Name]]`. In a table the alias pipe is
 * `\|`, and a name a wiki link can't hold is written `[name](<path>)`.
 */
export function pickedText(entry: Pick<DiskEntry, 'path' | 'name'>, page: string, onEmptyLine: boolean, asLink: boolean, inTable = false): { text: string; target: string } {
  const relative = vaultPath(entry.path);
  if (classifyFile(entry.path) === 'markdown') {
    const target = relative.endsWith('.md') ? relative.slice(0, -3) : relative;
    const name = pageName(basenameFsPath(entry.path));
    if (WIKI_UNSAFE.test(target)) return { text: linkFor({ vaultPath: relative, path: entry.path, page, embed: false, slot: name, inTable }), target };
    return { text: `[[${target}${inTable ? '\\|' : '|'}${wikiAlias(name, inTable)}]]`, target };
  }
  const file = { path: entry.path, vaultPath: relative, name: withoutHash(entry.name) };
  return { text: insertedText(file, page, asLink || !onEmptyLine ? 'chip' : 'default', null, inTable), target: relative };
}

// Option+Enter accepts the pick as a plain link.
let asLink = false;

/** Writes the pick over the typed "[[query" (and a "]]" right after it), as one undo step. */
function applyPick(entry: DiskEntry) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const { state } = view;
    const line = state.doc.lineAt(from);
    const end = state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to;
    const rest = line.text.slice(0, from - line.from) + line.text.slice(end - line.from);
    const onEmptyLine = !/[^\s>]/.test(rest);
    const { text, target } = pickedText(entry, state.facet(pageContext).path, onEmptyLine, asLink, inTableAt(state, from));
    asLink = false;
    view.dispatch({
      changes: { from, to: end, insert: text },
      selection: { anchor: from + text.length },
      effects: linksResolved.of({ [target]: entry.path }),
      annotations: isolateHistory.of('full'),
      userEvent: 'input.complete',
      scrollIntoView: true,
    });
  };
}

/** The completion source: "[[" and what follows it on the line, up to a "|" or "]". */
export async function linkCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const typed = context.matchBefore(/\[\[[^[\]|\n]*$/);
  if (!typed || inCode(context.state, typed.from + 1)) return null;
  const { from } = typed;
  const query = typed.text.slice(2);
  const entries = await findLinkTargets(query);
  if (context.aborted) return null;
  return {
    from,
    filter: false,
    options: entries.map((entry, index) => ({
      label: rowLabel(entry),
      detail: folderOf(entry.path),
      type: entry.kind,
      boost: -index,
      apply: applyPick(entry),
      entry,
    } as Completion & { entry: DiskEntry })),
  };
}

const kindIcon = {
  render: (completion: Completion) => {
    const entry = (completion as Completion & { entry?: DiskEntry }).entry;
    const holder = document.createElement('span');
    holder.className = 'cm-link-picker-icon';
    holder.append(fileIcon(entry ? iconFor(entry.name, entry.kind) : 'file', 16));
    return holder;
  },
  position: 20,
};

const pickAsLink = (view: EditorView) => {
  if (completionStatus(view.state) !== 'active') return false;
  asLink = true;
  if (acceptCompletion(view)) return true;
  asLink = false;
  return false;
};

/** Insert > Link to note or file…: types "[[" at the caret, which opens the picker. */
export function startLinkPicker(view: EditorView): void {
  const { head } = view.state.selection.main;
  view.dispatch({ changes: { from: head, insert: '[[' }, selection: { anchor: head + 2 }, userEvent: 'input.type' });
  view.focus();
  startCompletion(view);
}

export const insertLinkItem = insertItems.of({
  id: 'link',
  label: 'Link to note or file…',
  icon: Link2,
  order: 2,
  run: startLinkPicker,
});

/** Insert > File… and Insert > Link to note or file…, for documents. */
export const fileInsertItems: Extension = [insertFileItem, insertLinkItem];

/** The picker on every page. */
export const linkPicker: Extension = [
  autocompletion({
    override: [linkCompletions],
    activateOnTyping: true,
    icons: false,
    addToOptions: [kindIcon],
    optionClass: () => 'cm-link-picker-option',
    tooltipClass: () => 'cm-link-picker',
    closeOnBlur: true,
  }),
  Prec.highest(keymap.of([{ key: 'Alt-Enter', run: pickAsLink }])),
];
