import { getSearchQuery, SearchQuery, searchPanelOpen, setSearchQuery } from '@codemirror/search';
import { Annotation, ChangeSet, EditorSelection, EditorState, RangeSetBuilder, StateEffect, Transaction, type ChangeSpec, type Extension, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { toast } from 'sonner';
import { latestTree, objectAt, protectedIn } from './extensionPoints';
import { docMode, drawnBlockAt, setOpenBlock } from './livePreview';
import { setFrame } from './objectFrame';
import { inWikiLink, literalTexts } from './typing';
import { OBJECT, rawRange, visibleLines, visibleSlice, type VisibleLine } from './visibleText';

/*
 * Find and Replace in a document work on the text the page shows. A query
 * matches the visible text of each line, so "plan" is found across hidden
 * marks (`pl**an**`), and never in a link's hidden address or a wiki link's
 * target. Replacing goes through `replaceVisible`, so formatting around a
 * match keeps its marks, and the new text is written literally: what would
 * read as Markdown there is escaped, and a pipe in a table cell is `\|`. A
 * match in a protected range, such as a formula, frames its object and is
 * never replaced. A match in a drawn table shows the table's source.
 */

export interface VisibleMatch {
  from: number;
  to: number;
  /** False in a protected range: found, never replaced. */
  precise: boolean;
  /** The regular expression's match, for `$1` in the replacement. */
  groups: RegExpExecArray | null;
}

const CHUNK = 200;

/** The query's text with `\\n`, `\\t` and `\\\\` read as escapes unless the query is literal, as CodeMirror's search reads them. */
function unquote(spec: SearchQuery, text: string): string {
  return spec.literal ? text : text.replace(/\\([nrt\\])/g, (_, character: string) => (character === 'n' ? '\n' : character === 'r' ? '\r' : character === 't' ? '\t' : '\\'));
}

const WORD = /[\p{L}\p{N}_]/u;

/** The query's matches in one line's visible text, as offsets into it. */
function lineMatches(spec: SearchQuery, visible: VisibleLine): { from: number; to: number; groups: RegExpExecArray | null }[] {
  const found: { from: number; to: number; groups: RegExpExecArray | null }[] = [];
  const { text } = visible;
  const whole = (from: number, to: number) => !spec.wholeWord
    || (!(WORD.test(text[from - 1] ?? '') && WORD.test(text[from] ?? '')) && !(WORD.test(text[to - 1] ?? '') && WORD.test(text[to] ?? '')));
  if (spec.regexp) {
    let pattern: RegExp;
    try { pattern = new RegExp(spec.search, spec.caseSensitive ? 'gu' : 'giu'); } catch { return found; }
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match[0].length === 0) { pattern.lastIndex += 1; continue; }
      const to = match.index + match[0].length;
      if (!match[0].includes(OBJECT) && whole(match.index, to)) found.push({ from: match.index, to, groups: match });
    }
    return found;
  }
  const unquoted = unquote(spec, spec.search);
  const needle = spec.caseSensitive ? unquoted : lower(unquoted);
  if (!needle || needle.includes('\n')) return found;
  const hay = spec.caseSensitive ? text : lower(text);
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    if (whole(at, at + needle.length)) found.push({ from: at, to: at + needle.length, groups: null });
  }
  return found;
}

/** Lower case one character at a time, so offsets stay those of the text. */
function lower(text: string): string {
  let out = '';
  for (const character of text) {
    const low = character.toLowerCase();
    out += low.length === character.length ? low : character;
  }
  return out;
}

// Text the page shows that is also where a link points: a bare address, or a wiki link's target.
const ADDRESSES = new Set(['URL', 'Autolink', 'WikiLink', 'Embed']);

/** Whether `from` to `to` holds text Replace keeps: a protected range, a bare address or a wiki link's target. */
export function keptText(state: EditorState, from: number, to: number): boolean {
  if (protectedIn(state, from, to).some((range) => range.from < to && range.to > from)) return true;
  let kept = false;
  latestTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      if (kept || !ADDRESSES.has(ref.name) || ref.to <= from || ref.from >= to) return !kept;
      if (ref.name === 'URL' && ['Link', 'Image', 'LinkReference'].includes(ref.node.parent?.name ?? '')) return false;
      if (ref.name === 'WikiLink' || ref.name === 'Embed') {
        // An alias is the link's text and can change; the target before it cannot.
        const inner = state.sliceDoc(ref.from, ref.to);
        const bar = inner.indexOf('|');
        if (bar !== -1 && from >= ref.from + bar) return false;
      }
      kept = true;
      return false;
    },
  });
  return kept;
}

function toMatch(state: EditorState, visible: VisibleLine, match: { from: number; to: number; groups: RegExpExecArray | null }): VisibleMatch {
  const { from, to } = rawRange(visible, match.from, match.to);
  return { from, to, precise: !keptText(state, from, to), groups: match.groups };
}

/**
 * The source of each protected object a line draws as one character, such
 * as a formula's TeX, as lines a query can read. A match there is found,
 * frames its object and is never replaced.
 */
function objectSources(state: EditorState, visible: VisibleLine): VisibleLine[] {
  const sources: VisibleLine[] = [];
  for (let index = visible.text.indexOf(OBJECT); index !== -1; index = visible.text.indexOf(OBJECT, index + 1)) {
    const from = visible.starts[index];
    const to = visible.ends[index];
    if (!protectedIn(state, from, to).some((range) => range.from <= from && range.to >= to)) continue;
    const starts = Array.from({ length: to - from }, (_, offset) => from + offset);
    sources.push({ line: visible.line, text: state.sliceDoc(from, to), starts, ends: starts.map((at) => at + 1) });
  }
  return sources;
}

/** The matches on the lines from line number `first` to `last`, in order. */
function matchesIn(state: EditorState, spec: SearchQuery, first: number, last: number): VisibleMatch[] {
  const { doc } = state;
  const found: VisibleMatch[] = [];
  for (let number = first; number <= last; number += CHUNK) {
    const end = Math.min(last, number + CHUNK - 1);
    for (const visible of visibleLines(state, doc.line(number).from, doc.line(end).to)) {
      const line: VisibleMatch[] = [];
      for (const match of lineMatches(spec, visible)) line.push(toMatch(state, visible, match));
      for (const source of objectSources(state, visible)) for (const match of lineMatches(spec, source)) line.push(toMatch(state, source, match));
      found.push(...line.sort((a, b) => a.from - b.from));
    }
  }
  return found;
}

/** The query as CodeMirror's search state uses it, over visible text. */
class VisibleQueryType {
  constructor(readonly spec: SearchQuery) {}

  nextMatch(state: EditorState, curFrom: number, curTo: number): VisibleMatch | null {
    const { doc } = state;
    const start = doc.lineAt(curTo).number;
    for (let number = start; number <= doc.lines; number += CHUNK) {
      const hit = matchesIn(state, this.spec, number, Math.min(doc.lines, number + CHUNK - 1))
        .find((match) => match.from >= curTo && !(match.from === curFrom && match.to === curTo));
      if (hit) return hit;
    }
    for (let number = 1; number <= start; number += CHUNK) {
      const hit = matchesIn(state, this.spec, number, Math.min(start, number + CHUNK - 1))
        .find((match) => !(match.from === curFrom && match.to === curTo));
      if (hit) return hit;
    }
    return null;
  }

  prevMatch(state: EditorState, curFrom: number, curTo: number): VisibleMatch | null {
    const { doc } = state;
    const start = doc.lineAt(curFrom).number;
    for (let number = start; number >= 1; number -= CHUNK) {
      const hits = matchesIn(state, this.spec, Math.max(1, number - CHUNK + 1), number).filter((match) => match.to <= curFrom);
      if (hits.length > 0) return hits[hits.length - 1];
    }
    for (let number = doc.lines; number >= start; number -= CHUNK) {
      const hits = matchesIn(state, this.spec, Math.max(start, number - CHUNK + 1), number)
        .filter((match) => !(match.from === curFrom && match.to === curTo));
      if (hits.length > 0) return hits[hits.length - 1];
    }
    return null;
  }

  getReplacement(match: VisibleMatch): string {
    const replace = unquote(this.spec, this.spec.replace);
    if (!this.spec.regexp || !match.groups) return replace;
    const groups = match.groups;
    return replace.replace(/\$([$&]|\d+)/g, (written: string, which: string) => {
      if (which === '$') return '$';
      if (which === '&') return groups[0];
      const index = Number(which);
      return index < groups.length ? groups[index] ?? '' : written;
    });
  }

  matchAll(state: EditorState, limit: number): VisibleMatch[] | null {
    const found = matchesIn(state, this.spec, 1, state.doc.lines);
    return found.length > limit ? null : found;
  }

  /** Only matches Replace changes; `keptMatches` draws the others. */
  highlight(state: EditorState, from: number, to: number, add: (from: number, to: number) => void): void {
    const { doc } = state;
    for (const match of matchesIn(state, this.spec, doc.lineAt(from).number, doc.lineAt(to).number)) if (match.precise) add(match.from, match.to);
  }
}

/** A search query that matches the page's visible text. */
export class VisibleQuery extends SearchQuery {
  create(): VisibleQueryType {
    return new VisibleQueryType(this);
  }
}

/**
 * `query` over visible text, keeping its settings. A query CodeMirror filled
 * from the selection holds its Markdown, so it takes the selection's visible
 * text instead.
 */
export function visibleQuery(query: SearchQuery, state?: EditorState): VisibleQuery {
  if (query instanceof VisibleQuery) return query;
  let { search } = query;
  const selection = state?.selection.main;
  if (state && selection && !selection.empty) {
    const raw = state.sliceDoc(selection.from, selection.to);
    if (search === raw || search === raw.replace(/\n/g, '\\n')) {
      const shown = visibleSlice(state, selection.from, selection.to);
      search = query.literal ? shown : shown.replace(/\n/g, '\\n');
    }
  }
  return new VisibleQuery({
    search,
    caseSensitive: query.caseSensitive,
    literal: query.literal,
    regexp: query.regexp,
    replace: query.replace,
    wholeWord: query.wholeWord,
  });
}

/** Whether `at` sits in a node named `name`. */
function inNode(state: EditorState, at: number, name: string): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (node.name === name) return true;
  }
  return false;
}

/**
 * The changes that replace each of `edits` with its text as the page shows
 * it: escaped where it would read as Markdown, marks kept around it.
 * Protected ranges keep their text.
 */
export function replaceEdits(
  state: EditorState,
  edits: readonly { from: number; to: number; insert: string }[],
  replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] },
): ChangeSet {
  // A backtick would end inline code early, and a bracket or bar a wiki link's text, so a match there keeps its text.
  const replaced = edits.filter((edit) => !keptText(state, edit.from, edit.to)
    && !(edit.insert.includes('`') && inNode(state, edit.from, 'InlineCode'))
    && !(/[[\]|\n]/.test(edit.insert) && inWikiLink(state, edit.from)));
  const texts = literalTexts(state, replaced.map((edit) => ({ ...edit, table: inNode(state, edit.from, 'Table') })));
  const specs: ChangeSpec[] = [];
  replaced.forEach((edit, index) => specs.push(...replace(state, edit.from, edit.to, texts[index]).changes));
  return ChangeSet.of(specs, state.doc.length);
}

/** How many matches Replace All found and left as they are, for the status message after it. */
const keptByReplace = Annotation.define<{ replaced: number; kept: number }>();

const keptMark = Decoration.mark({ class: 'opal-searchKept' });

/** Matches Replace keeps (link addresses, wiki link targets, formulas), drawn apart from those it changes. */
const keptMatches = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.length > 0)) this.decorations = this.build(update.view);
    for (const tr of update.transactions) {
      const counts = tr.annotation(keptByReplace);
      if (counts) toast(`Replaced ${counts.replaced} of ${counts.replaced + counts.kept}. Link addresses and formulas stay as they are.`);
    }
  }

  build(view: EditorView): DecorationSet {
    const { state } = view;
    const query = getSearchQuery(state);
    if (!searchPanelOpen(state) || !query.valid || !(query instanceof VisibleQuery)) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    let last = 0;
    for (const { from, to } of view.visibleRanges) {
      for (const match of matchesIn(state, query, state.doc.lineAt(from).number, state.doc.lineAt(to).number)) {
        if (match.precise || match.from < last || match.to <= match.from) continue;
        builder.add(match.from, match.to, keptMark);
        last = match.to;
      }
    }
    return builder.finish();
  }
}, { decorations: (plugin) => plugin.decorations });

// No fill, so a kept match reads apart from the grey of those Replace changes.
// The Find bar floats over the page's top right corner on the popover surface, so opening it moves nothing.
const searchTheme = [EditorView.editorAttributes.of({ class: 'opal-docFind' }), EditorView.theme({
  '.opal-searchKept': { textDecoration: 'underline dashed 1px hsl(var(--text-tertiary))', textUnderlineOffset: '3px' },
  '&.opal-docFind.cm-editor .cm-panels.cm-panels-top': { height: '0', overflow: 'visible', border: 'none', background: 'transparent' },
  '&.opal-docFind.cm-editor .cm-panels-top .cm-panel.cm-search': {
    position: 'absolute',
    top: '8px',
    right: '16px',
    maxWidth: 'calc(100% - 32px)',
    background: 'hsl(var(--surface-raised))',
    border: '1px solid hsl(var(--border-overlay))',
    borderRadius: 'var(--radius-overlay)',
    boxShadow: 'var(--shadow-overlay)',
  },
})];

// The Find bar's labels in sentence case.
const searchPhrases = EditorState.phrases.of({
  next: 'Next',
  previous: 'Previous',
  all: 'All',
  'match case': 'Match case',
  regexp: 'Regex',
  'by word': 'Whole word',
  replace: 'Replace',
  'replace all': 'Replace all',
  close: 'Close',
});

/**
 * Doc mode's search: queries over visible text, replacements written as
 * the page shows them, and a found match shown where it sits: a drawn table
 * opens its source, a protected range frames its object.
 */
export function visibleSearch(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }): Extension {
  return [keptMatches, searchTheme, searchPhrases, EditorState.transactionFilter.of((tr) => {
    if (!tr.startState.facet(docMode)) return tr;
    const queries = tr.effects.filter((effect) => effect.is(setSearchQuery) && !(effect.value instanceof VisibleQuery));
    if (queries.length > 0) {
      return {
        changes: tr.changes,
        selection: tr.selection,
        scrollIntoView: tr.scrollIntoView,
        userEvent: tr.annotation(Transaction.userEvent),
        effects: tr.effects.map((effect) => (effect.is(setSearchQuery) ? setSearchQuery.of(visibleQuery(effect.value, tr.startState)) : effect)),
      };
    }
    if (tr.isUserEvent('input.replace') && tr.docChanged) {
      const edits: { from: number; to: number; insert: string }[] = [];
      tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to, insert: inserted.toString() }));
      const changes = replaceEdits(tr.startState, edits, replace);
      // Positions after CodeMirror's changes, such as the next match to scroll to, moved onto the changes written instead.
      const back = tr.changes.invert(tr.startState.doc);
      const selection = tr.selection
        ? EditorSelection.create(tr.newSelection.ranges.map((range) => EditorSelection.range(changes.mapPos(back.mapPos(range.anchor)), changes.mapPos(back.mapPos(range.head)))), tr.newSelection.mainIndex)
        : undefined;
      const effects = StateEffect.mapEffects(StateEffect.mapEffects(tr.effects, back), changes);
      const annotations: Annotation<{ replaced: number; kept: number }>[] = [];
      if (tr.isUserEvent('input.replace.all')) {
        const query = getSearchQuery(tr.startState);
        const found = query instanceof VisibleQuery ? query.create().matchAll(tr.startState, 1e9) ?? [] : [];
        const kept = found.length - edits.length;
        if (kept > 0) annotations.push(keptByReplace.of({ replaced: edits.length, kept }));
      }
      const spec: TransactionSpec = { changes, selection, effects, annotations, scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) };
      return spec;
    }
    if (tr.isUserEvent('select.search') && tr.selection) {
      const { main } = tr.newSelection;
      const state = tr.state;
      const block = drawnBlockAt(state, main.from);
      if (block && main.to <= block.to) return [tr, { effects: setOpenBlock.of(block), sequential: true }];
      const covering = protectedIn(state, main.from, main.to).filter((range) => range.from <= main.from && range.to >= main.to);
      // Code shows its text in place (its ranges carry `lines` or `inline`), so a match there is selected where it is.
      if (covering.length > 0 && !covering.some((range) => range.lines || range.inline)) {
        const obj = objectAt(state, main.from, 0);
        if (obj) return [tr, { effects: setFrame.of(obj), selection: { anchor: obj.to }, sequential: true }];
      }
    }
    return tr;
  })];
}
