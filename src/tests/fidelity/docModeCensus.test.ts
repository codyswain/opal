import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MarkdownError, parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import {
  clearFormatting,
  indentList,
  inlineSpans,
  linkAt,
  setHeading,
  toggleList,
  toggleMarker,
  writeLink,
} from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { blockSeparators, expectTyped, openedLine, pendingOwner, vaultFiles } from './censusHelpers';

/**
 * A read-only census of a real vault in doc mode: every Markdown file opens
 * in a document's editor view, as if it were a .mdo, and at a few sampled
 * places each toolbar command and one typed character run on it. A run
 * fails when a byte outside the span it is meant to change changes, when a
 * typed character does not show where it was typed or lands inside hidden
 * text (`expectTyped`), or when it throws. A typing failure that a later PR
 * fixes is counted as pending under that PR (`pendingOwner`) instead. Nothing
 * is written to the vault.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault [OPAL_CENSUS_OUT=report.json] npx vitest run src/tests/fidelity/docModeCensus.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;

type Span = 'selection' | 'lines' | 'caret';

const COMMANDS: [string, StateCommand, Span][] = [
  ['bold', toggleMarker('**'), 'selection'],
  ['italic', toggleMarker('*'), 'selection'],
  ['strikethrough', toggleMarker('~~'), 'selection'],
  ['clear formatting', clearFormatting, 'selection'],
  ...[0, 1, 2, 3, 4, 5, 6].map((level): [string, StateCommand, Span] => [`heading ${level}`, setHeading(level), 'lines']),
  ['bulleted list', toggleList('bullet'), 'lines'],
  ['numbered list', toggleList('number'), 'lines'],
  ['checklist', toggleList('task'), 'lines'],
  ['indent', indentList(true), 'lines'],
  ['outdent', indentList(false), 'lines'],
  [
    'link',
    ({ state, dispatch }) => {
      const { main } = state.selection;
      dispatch(state.update(writeLink(state, main, state.sliceDoc(main.from, main.to), 'https://example.com', linkAt(state, main.from))));
      return true;
    },
    'selection',
  ],
];

/** The part of the text a command run on `state` may change: the selected lines, and for inline formatting the lines of the spans it touches. */
function expectedSpan(state: EditorState, span: Span): [number, number] {
  const { from, to } = state.selection.main;
  if (span === 'caret') return [from, to];
  let start = from;
  let end = to;
  if (span === 'selection') {
    for (const inline of inlineSpans(state, from, to)) {
      start = Math.min(start, inline.from);
      end = Math.max(end, inline.to);
    }
  } else {
    // A setext heading changing level takes its underline with it.
    syntaxTree(state).iterate({ from, to, enter: (ref) => { if (ref.name.startsWith('SetextHeading')) end = Math.max(end, ref.to); } });
  }
  return [state.doc.lineAt(start).from, state.doc.lineAt(end).to];
}

/** Whether `after` differs from `before` only between `from` and `to` of `before`. */
function onlyInside(before: string, after: string, [from, to]: [number, number]): boolean {
  const tail = before.length - to;
  return after.length - tail >= from && after.slice(0, from) === before.slice(0, from) && after.slice(after.length - tail) === before.slice(to);
}

describe.skipIf(!ROOT)('doc mode census', () => {
  it('changes only the expected span for each toolbar command and a typed character', async () => {
    const vault = await vaultFiles(ROOT as string);
    const files = vault.found;
    const failures: string[] = [];
    const pending = new Map<string, string[]>();
    let opened = 0;
    let runs = 0;
    for (const file of files) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch (error) {
        if (error instanceof MarkdownError) continue;
        throw error;
      }
      opened += 1;
      const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: body, extensions: markdownEditorExtensions(file.replace(/\.md$/i, '.mdo')) }) });
      ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
      const relative = path.relative(ROOT as string, file);
      try {
        for (const share of [0.25, 0.5, 0.75]) {
          const line = view.state.doc.lineAt(Math.floor(body.length * share));
          const placed = view.state.update({ selection: { anchor: line.from + Math.floor(line.length / 2) } }).state;
          const caret = placed.selection.main.head;
          const where = `${relative}@${caret}`;
          // One typed character goes in exactly at the caret, and never into hidden text.
          runs += 1;
          const typed = placed.update({ changes: { from: caret, insert: 'x' }, selection: { anchor: caret + 1 }, userEvent: 'input.type' }).state;
          const problems = expectTyped(placed, typed, 'x', caret, { separators: blockSeparators(placed, caret) });
          const owner = problems.length > 0 ? pendingOwner(placed, typed, 'x', caret) : null;
          if (owner) pending.set(owner, [...(pending.get(owner) ?? []), `${where}: ${problems.join('; ')}`]);
          else if (problems.length > 0) failures.push(`${where} typed character: ${problems.join('; ')}`);
          if (hiddenRanges(placed, caret, caret).some((range) => range.from < caret && caret < range.to)) failures.push(`${where} caret in hidden text`);
          const word = placed.wordAt(caret);
          const selected = placed.update({ selection: word ? { anchor: word.from, head: word.to } : { anchor: caret, head: Math.min(placed.doc.lineAt(caret).to, caret + 8) } }).state;
          for (const [name, command, span] of COMMANDS) {
            runs += 1;
            let result: Transaction | null = null;
            try {
              command({ state: selected, dispatch: (tr) => { result = tr; } });
            } catch (error) {
              failures.push(`${where} ${name} threw ${(error as Error).message}`);
              continue;
            }
            const after = (result as Transaction | null)?.newDoc.toString() ?? body;
            if (!onlyInside(body, after, expectedSpan(selected, span))) failures.push(`${where} ${name}`);
          }
        }
      } finally {
        view.destroy();
      }
    }
    const report = { root: ROOT, files: files.length, opened, runs, failed: failures, pending: Object.fromEntries(pending) };
    console.info(openedLine('doc-mode census', opened, vault));
    console.info(`[doc-mode census] ${opened} files opened as documents, ${runs} runs at 3 places each: ${runs - failures.length} changed only their span, ${failures.length} failed`);
    for (const [owner, cases] of pending) console.info(`[doc-mode census] pending, ${owner}: ${cases.length} typed characters`);
    if (process.env.OPAL_CENSUS_OUT) await writeFile(process.env.OPAL_CENSUS_OUT, JSON.stringify(report, null, 2));
    expect(failures).toEqual([]);
  }, 1_200_000);
});
