import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { parserFor, type CodeLanguage } from './codeLanguages';

/*
 * Grey highlighting for code. Each fence's text is parsed on its own with its
 * language's parser, and the colours come back as ranges over that text, so
 * nothing about the code ever reaches the page's Markdown tree: a command
 * that reads the tree never sees a ```markdown fence as Markdown. Weight,
 * italic and three greys only (code.css).
 */

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self, t.heading, t.strong], class: 'cm-code-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape, t.character, t.attributeValue, t.url, t.docString], class: 'cm-code-string' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta, t.annotation], class: 'cm-code-comment' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.literal, t.unit, t.color, t.constant(t.variableName)], class: 'cm-code-literal' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.typeName, t.className, t.namespace, t.tagName, t.macroName, t.standard(t.variableName)], class: 'cm-code-name' },
  { tag: [t.punctuation, t.operator, t.bracket, t.separator, t.derefOperator, t.angleBracket, t.squareBracket, t.paren, t.brace, t.processingInstruction], class: 'cm-code-punctuation' },
  { tag: [t.emphasis], class: 'cm-code-em' },
  { tag: [t.inserted], class: 'cm-code-inserted' },
  { tag: [t.deleted], class: 'cm-code-deleted' },
]);

export interface CodeMark {
  from: number;
  to: number;
  className: string;
}

const CACHE_SIZE = 400;
const cache = new Map<string, readonly CodeMark[]>();

// Past this many characters a parse takes a good part of a frame, so typing in such a block
// draws the last colours, moved past the edit, and parses once typing pauses.
const LARGE = 8_000;
const DEFER_MS = 120;
const recentLarge: { id: string; code: string; marks: readonly CodeMark[] }[] = [];
const readyListeners = new Set<() => void>();
let deferred: { code: string; language: CodeLanguage } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Calls `listener` when colours parsed after a pause are ready, until the returned function is called. */
export function onHighlightReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

function compute(code: string, language: CodeLanguage): readonly CodeMark[] | null {
  const parser = parserFor(language);
  if (!parser) return null;
  const marks: CodeMark[] = [];
  highlightTree(parser.parse(code), highlighter, (from, to, className) => {
    if (to > from) marks.push({ from, to, className });
  });
  const key = `${language.id}\u0000${code}`;
  cache.set(key, marks);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  if (code.length > LARGE) {
    recentLarge.unshift({ id: language.id, code, marks });
    recentLarge.length = Math.min(recentLarge.length, 4);
  }
  return marks;
}

/** Marks of `old` for `code`, which differs from it in one place: those after the change move with it, those across it go. */
function shifted(old: { code: string; marks: readonly CodeMark[] }, code: string): readonly CodeMark[] {
  let start = 0;
  const shortest = Math.min(old.code.length, code.length);
  while (start < shortest && old.code.charCodeAt(start) === code.charCodeAt(start)) start += 1;
  let end = 0;
  while (end < shortest - start && old.code.charCodeAt(old.code.length - 1 - end) === code.charCodeAt(code.length - 1 - end)) end += 1;
  const oldEnd = old.code.length - end;
  const delta = code.length - old.code.length;
  return old.marks.flatMap((mark) => {
    if (mark.to <= start) return [mark];
    if (mark.from >= oldEnd) return [{ ...mark, from: mark.from + delta, to: mark.to + delta }];
    return [];
  });
}

function closest(id: string, code: string) {
  let best: (typeof recentLarge)[number] | null = null;
  for (const entry of recentLarge) {
    if (entry.id === id && Math.abs(entry.code.length - code.length) < 2_000 && (!best || Math.abs(entry.code.length - code.length) < Math.abs(best.code.length - code.length))) best = entry;
  }
  return best;
}

function defer(code: string, language: CodeLanguage): void {
  deferred = { code, language };
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const next = deferred;
    deferred = null;
    if (next && compute(next.code, next.language)) for (const listener of [...readyListeners]) listener();
  }, DEFER_MS);
}

/**
 * The highlight ranges of `code` in `language`, in order, from offsets in
 * the code. Empty while the language loads or for plain code. Cached by
 * language and text. A large block just edited gets its last colours, moved
 * past the edit, until it is parsed again after a pause (`onHighlightReady`).
 */
export function highlightMarks(code: string, language: CodeLanguage | null): readonly CodeMark[] {
  if (!language || code === '') return [];
  const key = `${language.id}\u0000${code}`;
  const known = cache.get(key);
  if (known) {
    // Most recently used last, so the oldest goes first.
    cache.delete(key);
    cache.set(key, known);
    return known;
  }
  if (code.length > LARGE) {
    const near = closest(language.id, code);
    if (near) {
      defer(code, language);
      return shifted(near, code);
    }
  }
  return compute(code, language) ?? [];
}

/** The first mark that ends after `at`, by binary search. */
export function firstMarkAfter(marks: readonly CodeMark[], at: number): number {
  let low = 0;
  let high = marks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (marks[middle].to <= at) low = middle + 1;
    else high = middle;
  }
  return low;
}
