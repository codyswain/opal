import { describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { MarkdownError, parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { replaceVisible } from '@/renderer/features/disk-explorer/components/editor/docMode';
import { clearFormatting, setHeading, toggleList, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { VisibleQuery, replaceEdits } from '@/renderer/features/disk-explorer/components/editor/visibleSearch';
import { visibleLines, visibleOffset, visibleSlice } from '@/renderer/features/disk-explorer/components/editor/visibleText';
import { wordStep } from '@/renderer/features/disk-explorer/components/editor/wordMotion';
import { blockSeparators, expectTyped, openedLine, pendingOwner, sampleSpots, vaultFiles } from './censusHelpers';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

/**
 * A read-only census of typing in documents, over every note of a real
 * vault opened as a .mdo:
 *
 * - Option+Right from every line's start reaches the line's end, one
 *   visible word at a time.
 * - Replace All of a word sampled from the page's visible text changes no
 *   byte inside hidden text (marks, link addresses, targets) or bare URLs.
 * - Replace All writes the word inside stars, brackets and an underscore,
 *   and the changed lines show exactly that, with the escapes hidden.
 * - Bold, italic, strikethrough and Clear on a sampled word leave the page
 *   showing the same words and no new marker character. A command that
 *   refuses is counted by name. Headings and lists may add a drawn box or
 *   blank lines; where they show a mark, the run is counted as pending for
 *   PR 1, which owns those commands.
 * - Typing `*`, `_`, `\`, `1984. ` and `<!--` at sampled places shows
 *   exactly what was typed (`expectTyped`), with escapes as the only extra
 *   bytes.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault [OPAL_CENSUS_OUT=report.json] npx vitest run src/tests/fidelity/docModeCensus.typing.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;
// OPAL_CENSUS_ONLY=<regular expression> limits the run to matching paths, to look at failures again.
const ONLY = process.env.OPAL_CENSUS_ONLY ? new RegExp(process.env.OPAL_CENSUS_ONLY) : null;

const TYPED = ['*', '_', '\\', '1984. ', '<!--'];
const FORMATS: [string, StateCommand][] = [
  ['bold', toggleMarker('**')],
  ['italic', toggleMarker('*')],
  ['strikethrough', toggleMarker('~~')],
  ['clear formatting', clearFormatting],
  ['heading 2', setHeading(2)],
  ['normal text', setHeading(0)],
  ['bulleted list', toggleList('bullet')],
  ['numbered list', toggleList('number')],
  ['checklist', toggleList('task')],
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
  // The page shows the parse of the whole text; a long note's reparse may stop short of it on a busy machine.
  ensureSyntaxTree(after, after.doc.length, 10_000);
  return { before, after: after.update({}).state, caret };
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

const LINE_COMMANDS = new Set(['heading 2', 'normal text', 'bulleted list', 'numbered list', 'checklist']);
const BLOCK_OWNER = 'PR 1: headings and lists over tables, code, HTML, numbered headings and empty lines';
const ITEM_OWNER = 'PR 1: a heading in a task or list item, a list on a heading or an indented line';
const BLOCKS = new Set(['Table', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock']);

/**
 * Whether the selection's lines touch a table, code or HTML block, a
 * heading that starts with a number, or an empty line: PR 1's guards keep
 * line commands off blocks and turn "## 5. x" into text, not a list, and its
 * list markers draw an empty item's bullet.
 */
function touchesBlock(state: EditorState): boolean {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  let found = /^#{1,6}[ \t]+\d+[.)]/.test(first.text) || !/\S/.test(first.text);
  syntaxTree(state).iterate({
    from: first.from,
    to: last.to,
    enter: (ref) => {
      if (BLOCKS.has(ref.name)) found = true;
      return !found;
    },
  });
  return found;
}

/** The visible text of the lines a command changed, before and after. */
function shownAround(tr: Transaction): [string, string] {
  let from = tr.startState.doc.length;
  let to = 0;
  tr.changes.iterChangedRanges((fromA, toA) => { from = Math.min(from, fromA); to = Math.max(to, toA); });
  const start = tr.startState.doc.lineAt(from).from;
  const end = tr.startState.doc.lineAt(to).to;
  return [visibleSlice(tr.startState, start, end), visibleSlice(tr.state, tr.changes.mapPos(start, -1), tr.changes.mapPos(end, 1))];
}

/**
 * Whether a line command left the same words showing: a list or heading may
 * add a drawn box and blank lines, but no mark of its own may show.
 */
function sameWords(tr: Transaction): boolean {
  const words = (text: string) => text.split('\n').map((line) => line.replace(/\ufffc/g, '').trim()).filter(Boolean).join('\n');
  const [before, after] = shownAround(tr);
  return words(before) === words(after);
}

/** Marker characters in visible text: a command that adds one shows a mark. */
const markers = (text: string) => text.match(/[*_~`#[\]]/g)?.length ?? 0;

// Replace All writes the word inside punctuation that would read as Markdown, so the escapes are exercised.
const REPLACEMENT = (search: string) => `*${search}* [Zq]_`;

/**
 * What Replace All showed wrong on the lines it changed, or null: each line
 * must show its old visible text with every match's shown text replaced by
 * the replacement as written.
 */
function shownReplaced(state: EditorState, matches: readonly { from: number; to: number }[], insert: string, changes: ChangeSet): string | null {
  if (matches.length === 0 || changes.empty) return null;
  const next = state.update({ changes, filter: false }).state;
  ensureSyntaxTree(next, next.doc.length, 10_000);
  const settled = next.update({}).state;
  const byLine = new Map<number, { from: number; to: number }[]>();
  for (const match of matches) {
    const number = state.doc.lineAt(match.from).number;
    byLine.set(number, [...(byLine.get(number) ?? []), match]);
  }
  for (const [number, found] of byLine) {
    const line = state.doc.line(number);
    const [visible] = visibleLines(state, line.from, line.from);
    let expected = '';
    let at = 0;
    for (const match of found) {
      expected += visible.text.slice(at, visibleOffset(visible, match.from)) + insert;
      at = visibleOffset(visible, match.to);
    }
    expected += visible.text.slice(at);
    const from = changes.mapPos(line.from, -1);
    const got = visibleSlice(settled, from, changes.mapPos(line.to, 1));
    if (got !== expected) {
      let at = 0;
      while (at < got.length && got[at] === expected[at]) at += 1;
      const around = (text: string) => JSON.stringify(text.slice(Math.max(0, at - 40), at + 60));
      return `line ${number} shows ${around(got)}, not ${around(expected)}`;
    }
  }
  return null;
}

const shownChange = (tr: Transaction) => shownAround(tr).map((text) => JSON.stringify(text.slice(0, 80))).join(' became ');

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
    const refused = new Map<string, number>();
    let opened = 0;
    for (const file of vault.found) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch (error) {
        if (error instanceof MarkdownError) continue;
        throw error;
      }
      const relative = path.relative(ROOT as string, file);
      if (ONLY && !ONLY.test(relative)) continue;
      opened += 1;
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
          const replaced = matches.filter((match) => match.precise);
          const changes: ChangeSet = replaceEdits(state, replaced.map((match) => ({ from: match.from, to: match.to, insert: REPLACEMENT(search) })), replaceVisible);
          const kept = keptRanges(state);
          changes.iterChangedRanges((from, to) => {
            const inside = kept.find((range) => (from > range.from && from < range.to) || (to > range.from && to < range.to) || (from <= range.from && to >= range.to && to > from));
            if (inside) failures.push(`${where} Replace All "${search}" changed ${JSON.stringify(state.sliceDoc(inside.from, inside.to))}`);
          });
          // The page shows the replacement as written where Replace changed a match, with nothing else on those lines changed.
          const shownAfter = shownReplaced(state, replaced.filter((match) => changes.touchesRange(match.from, match.to)), REPLACEMENT(search), changes);
          if (shownAfter) failures.push(`${where} Replace All "${search}": ${shownAfter}`);
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
          if (!result) {
            refused.set(name, (refused.get(name) ?? 0) + 1);
            continue;
          }
          if (sameWords(result) && markers(shownAround(result)[1]) <= markers(shownAround(result)[0])) continue;
          // Headings and lists are PR 1's commands: what they show over blocks and inside items is counted for it.
          if (LINE_COMMANDS.has(name)) {
            const owner = touchesBlock(selected) ? BLOCK_OWNER : ITEM_OWNER;
            pending.set(owner, [...(pending.get(owner) ?? []), `${where} ${name}: ${shownChange(result)}`]);
          } else failures.push(`${where} ${name} showed a mark: ${shownChange(result)}`);
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
            // Typed text beside a table or rule starts a paragraph of its own (PR 1), so its line break counts as a separator.
            let problems = expectTyped(before, after, typed, caret, { escapes: '\\', separators: blockSeparators(before, caret) });
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
    console.info(`[typing census] refused with a status message: ${[...refused].map(([name, count]) => `${name} ${count}`).join(', ') || 'none'}`);
    for (const [owner, cases] of pending) console.info(`[typing census] pending, ${owner}: ${cases.length} runs`);
    if (process.env.OPAL_CENSUS_OUT) await writeFile(process.env.OPAL_CENSUS_OUT.replace(/\.json$/, '.typing.json'), JSON.stringify({ counts, failed: failures, pending: Object.fromEntries(pending) }, null, 2));
    expect(failures.slice(0, 50)).toEqual([]);
  }, 1_800_000);
});
