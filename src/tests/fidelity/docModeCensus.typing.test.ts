import { describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { MarkdownError, parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { replaceVisible } from '@/renderer/features/disk-explorer/components/editor/docMode';
import { clearFormatting, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { keepsVisibleText } from '@/renderer/features/disk-explorer/components/editor/typing';
import { VisibleQuery, replaceEdits } from '@/renderer/features/disk-explorer/components/editor/visibleSearch';
import { visibleLines, visibleOffset } from '@/renderer/features/disk-explorer/components/editor/visibleText';
import { wordStep } from '@/renderer/features/disk-explorer/components/editor/wordMotion';
import { expectTyped, openedLine, pendingOwner, sampleSpots, vaultFiles } from './censusHelpers';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

/**
 * A read-only census of typing in documents, over every note of a real
 * vault opened as a .mdo:
 *
 * - Option+Right from every line's start reaches the line's end, one
 *   visible word at a time.
 * - Replace All of a word sampled from the page's visible text changes no
 *   byte inside hidden text (marks, link addresses, targets) or bare URLs.
 * - Bold, italic, strikethrough and Clear on a sampled word leave the page
 *   showing the same text: no marker character shows.
 * - Typing `*`, `_`, `\`, `1984. ` and `<!--` at sampled places shows
 *   exactly what was typed (`expectTyped`), with escapes as the only extra
 *   bytes.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault [OPAL_CENSUS_OUT=report.json] npx vitest run src/tests/fidelity/docModeCensus.typing.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;

const TYPED = ['*', '_', '\\', '1984. ', '<!--'];
const FORMATS: [string, StateCommand][] = [
  ['bold', toggleMarker('**')],
  ['italic', toggleMarker('*')],
  ['strikethrough', toggleMarker('~~')],
  ['clear formatting', clearFormatting],
];
// Text Replace must keep: bare addresses and wiki link targets show on the page but point somewhere.
const KEPT = new Set(['URL', 'Autolink', 'WikiLink', 'Embed']);

function open(file: string, body: string): EditorState {
  const state = EditorState.create({ doc: body, extensions: markdownEditorExtensions(file.replace(/\.md$/i, '.mdo')) });
  ensureSyntaxTree(state, state.doc.length, 10_000);
  // A transaction carries the parsed tree into the state that commands read.
  return state.update({}).state;
}

/** Types `typed` one character at a time at `at`, as the keyboard does. */
function typeAt(state: EditorState, at: number, typed: string): { before: EditorState; after: EditorState; caret: number } {
  const before = state.update({ selection: { anchor: at } }).state;
  const caret = before.selection.main.head;
  let after = before;
  for (const character of typed) {
    const head = after.selection.main.head;
    after = after.update({ changes: { from: head, insert: character }, selection: { anchor: head + 1 }, userEvent: 'input.type' }).state;
  }
  return { before, after, caret };
}

/** The ranges Replace must leave alone: hidden text, bare addresses and wiki link targets. */
function keptRanges(state: EditorState): { from: number; to: number }[] {
  const kept = hiddenRanges(state, 0, state.doc.length).filter((range) => !range.unit).map(({ from, to }) => ({ from, to }));
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (!KEPT.has(ref.name)) return;
      if (ref.name === 'URL' && ['Link', 'Image', 'LinkReference'].includes(ref.node.parent?.name ?? '')) return false;
      const text = state.sliceDoc(ref.from, ref.to);
      const bar = text.indexOf('|');
      kept.push({ from: ref.from, to: ref.name === 'URL' || ref.name === 'Autolink' || bar === -1 ? ref.to : ref.from + bar });
      return false;
    },
  });
  return kept;
}

/**
 * Whether `after` is `before` with the characters of `typed`, in order, and
 * backslashes put in among the marks at one place, as when a typed space
 * goes after the closing marks of bold.
 */
function insertedAround(before: string, after: string, typed: string): boolean {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < before.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  const was = before.slice(start, before.length - end);
  const now = after.slice(start, after.length - end);
  let old = 0;
  let next = 0;
  for (const character of now) {
    if (old < was.length && character === was[old]) old += 1;
    else if (next < typed.length && character === typed[next]) next += 1;
    else if (character !== '\\') return false;
  }
  return old === was.length && next === typed.length && /^[*_~`\s]*$/.test(was);
}

/** Whether the line above `at` is in an ordered list, where a typed `N. ` continues it. */
function continuesOrderedList(state: EditorState, at: number): boolean {
  const line = state.doc.lineAt(at);
  if (line.number < 2) return false;
  const above = state.doc.line(line.number - 1);
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(above.to, -1); node; node = node.parent) {
    if (node.name === 'OrderedList') return true;
  }
  return false;
}

/** A lone `*` typed on an empty line is a bullet with no text, which PR 1 shows as text until a space follows. */
function lonePending(state: EditorState, typed: string, at: number): string | null {
  return typed === '*' && !/\S/.test(state.doc.lineAt(at).text) ? 'PR 1: a lone * on an empty line' : null;
}

describe.skipIf(!ROOT)('doc mode typing census', () => {
  it('moves by visible words, replaces only visible text, never shows a mark and types what was typed', async () => {
    const vault = await vaultFiles(ROOT as string);
    const failures: string[] = [];
    const pending = new Map<string, string[]>();
    const counts = { lines: 0, replaced: 0, formats: 0, typed: 0 };
    let opened = 0;
    for (const file of vault.found) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch (error) {
        if (error instanceof MarkdownError) continue;
        throw error;
      }
      opened += 1;
      const relative = path.relative(ROOT as string, file);
      const state = open(file, body);
      const { doc } = state;

      // Option+Right from each line's start to its end.
      for (const visible of visibleLines(state, 0, doc.length)) {
        if (visible.text.length === 0) continue;
        counts.lines += 1;
        let head = visible.starts[0];
        let steps = 0;
        while (visibleOffset(visible, head) < visible.text.length && steps <= visible.text.length) {
          const next = wordStep(state, head, true);
          if (next <= head || next > visible.line.to) break;
          head = next;
          steps += 1;
        }
        if (visibleOffset(visible, head) < visible.text.length) failures.push(`${relative}:${visible.line.number} Option+Right stopped at ${visibleOffset(visible, head)} of ${visible.text.length}`);
      }

      const spots = sampleSpots(state, { limit: 4 });
      for (const spot of spots) {
        const where = `${relative}@${spot.at} (${spot.why})`;
        const word = state.wordAt(spot.at);

        // Replace All of the word the caret is on.
        if (word && word.to - word.from >= 3) {
          counts.replaced += 1;
          const search = state.sliceDoc(word.from, word.to);
          const matches = new VisibleQuery({ search, caseSensitive: true, wholeWord: true }).create().matchAll(state, 1e9) ?? [];
          const changes: ChangeSet = replaceEdits(state, matches.filter((match) => match.precise).map((match) => ({ from: match.from, to: match.to, insert: `${search}Zq` })), replaceVisible);
          const kept = keptRanges(state);
          changes.iterChangedRanges((from, to) => {
            const inside = kept.find((range) => (from > range.from && from < range.to) || (to > range.from && to < range.to) || (from <= range.from && to >= range.to && to > from));
            if (inside) failures.push(`${where} Replace All "${search}" changed ${JSON.stringify(state.sliceDoc(inside.from, inside.to))}`);
          });
        }

        // Formatting the word never shows a mark.
        const selected = state.update({ selection: word ? EditorSelection.range(word.from, word.to) : EditorSelection.cursor(spot.at) }).state;
        for (const [name, command] of FORMATS) {
          counts.formats += 1;
          let result: Transaction | null = null;
          try {
            command({ state: selected, dispatch: (tr) => { result = tr; } });
          } catch (error) {
            failures.push(`${where} ${name} threw ${(error as Error).message}`);
            continue;
          }
          if (result && !keepsVisibleText(result)) failures.push(`${where} ${name} showed a mark`);
        }

        // Typed delimiters show as typed, mid-line and at the line's text start.
        const line = doc.lineAt(spot.at);
        // The line's text starts at its first visible character that is not a space.
        const shown = visibleLines(state, line.from, line.from)[0];
        const first = shown.text.search(/\S/);
        const lineStart = first === -1 ? line.from : shown.starts[first];
        for (const at of [spot.at, lineStart]) {
          for (const typed of TYPED) {
            counts.typed += 1;
            const { before, after, caret } = typeAt(state, at, typed);
            let problems = expectTyped(before, after, typed, caret, { escapes: '\\' });
            // A space typed at the end of bold goes after its closing marks, splitting the typed bytes around them.
            if (problems.length > 0 && problems.every((problem) => problem.startsWith('bytes at the caret')) && insertedAround(before.doc.toString(), after.doc.toString(), typed)) problems = [];
            // `N. ` under an ordered item continues the list, as decided.
            if (problems.length > 0 && typed === '1984. ' && continuesOrderedList(before, caret)) problems = [];
            if (problems.length === 0) continue;
            const owner = lonePending(before, typed, caret) ?? pendingOwner(before, after, typed, caret);
            if (owner) pending.set(owner, [...(pending.get(owner) ?? []), `${where} typed ${JSON.stringify(typed)}: ${problems.join('; ')}`]);
            else failures.push(`${where} typed ${JSON.stringify(typed)} at ${caret}: ${problems.join('; ')}`);
          }
        }
      }
    }
    console.info(openedLine('typing census', opened, vault));
    console.info(`[typing census] Option+Right on ${counts.lines} lines, Replace All of ${counts.replaced} words, ${counts.formats} format commands, ${counts.typed} typed runs: ${failures.length} failed`);
    for (const [owner, cases] of pending) console.info(`[typing census] pending, ${owner}: ${cases.length} typed runs`);
    if (process.env.OPAL_CENSUS_OUT) await writeFile(process.env.OPAL_CENSUS_OUT.replace(/\.json$/, '.typing.json'), JSON.stringify({ counts, failed: failures, pending: Object.fromEntries(pending) }, null, 2));
    expect(failures.slice(0, 50)).toEqual([]);
  }, 1_800_000);
});
