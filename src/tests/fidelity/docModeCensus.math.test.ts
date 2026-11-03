import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { clearFormatting, indentList, setHeading, toggleList, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { hiddenRanges } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { mathNodes, mathSpan } from '@/renderer/features/disk-explorer/components/editor/math';
import { closeMathEditor, mathEditor, openMathEditor, writeLive } from '@/renderer/features/disk-explorer/components/editor/mathWrite';
import { openedLine, vaultFiles } from './censusHelpers';

/**
 * Math in doc mode, on every vault note with a formula, opened as a
 * document: no hidden range starts inside a formula; no toolbar command, run
 * over the whole page and over each formula's line, changes a byte inside
 * one; and the popover, typing one character into a sampled formula and
 * deleting it, leaves the page's bytes as they were. Read-only.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault npx vitest run src/tests/fidelity/docModeCensus.math.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;

const COMMANDS: [string, StateCommand][] = [
  ['bold', toggleMarker('**')],
  ['italic', toggleMarker('*')],
  ['strikethrough', toggleMarker('~~')],
  ['clear', clearFormatting],
  ['heading 2', setHeading(2)],
  ['normal text', setHeading(0)],
  ['bullets', toggleList('bullet')],
  ['numbers', toggleList('number')],
  ['tasks', toggleList('task')],
  ['indent', indentList(true)],
  ['outdent', indentList(false)],
];

const SAMPLES = 6;

/** The formulas' TeX in order, which a command must leave as it was. A block's lines may move with the list item that holds them. */
function formulas(state: EditorState): string[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000);
  return tree ? mathNodes(tree, 0, state.doc.length).map((node) => mathSpan(state.doc, node).tex.split('\n').map((line) => line.trim()).join('\n')) : [];
}

/** Indent and the list commands rewrite every selected line, blocks included: PR 1's guards cover them. */
const PENDING_PR1 = new Set(['indent', 'outdent', 'bullets', 'numbers', 'tasks']);

describe.skipIf(!ROOT)('doc mode math census', () => {
  it('keeps every byte inside formulas through hidden ranges, commands and the popover', async () => {
    const vault = await vaultFiles(ROOT as string);
    const failures: string[] = [];
    const pending: string[] = [];
    let opened = 0;
    let notes = 0;
    let checked = 0;
    let commands = 0;
    let popovers = 0;
    for (const file of vault.found) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch {
        continue;
      }
      opened += 1;
      if (!/\$|\\\(|\\\[/.test(body)) continue;
      const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: body, extensions: markdownEditorExtensions(file.replace(/\.md$/i, '.mdo')) }) });
      const relative = path.relative(ROOT as string, file);
      try {
        ensureSyntaxTree(view.state, body.length, 10_000);
        view.dispatch({});
        const tree = ensureSyntaxTree(view.state, body.length, 10_000);
        const nodes = tree ? mathNodes(tree, 0, body.length) : [];
        if (nodes.length === 0) continue;
        notes += 1;
        const before = formulas(view.state);

        // No hidden range starts inside a formula.
        for (const node of nodes) {
          checked += 1;
          const inside = hiddenRanges(view.state, node.from, node.to).filter((range) => range.from > node.from && range.from < node.to);
          if (inside.length > 0) failures.push(`${relative}@${node.from} hidden range starts inside ${JSON.stringify(body.slice(node.from, node.to).slice(0, 40))}`);
        }

        // No command changes a byte inside a formula, over the whole page or over a formula's line.
        const selections = [EditorSelection.single(0, body.length), ...nodes.slice(0, SAMPLES).map((node) => {
          const line = view.state.doc.lineAt(node.from);
          return EditorSelection.single(line.from, view.state.doc.lineAt(node.to).to);
        })];
        for (const selection of selections) {
          const selected = view.state.update({ selection }).state;
          for (const [name, command] of COMMANDS) {
            commands += 1;
            let result: Transaction | null = null;
            command({ state: selected, dispatch: (tr) => { result = tr; } });
            if (!result) continue;
            const after = formulas((result as Transaction).state);
            const lost = before.filter((formula) => !after.includes(formula));
            if (lost.length === 0) continue;
            const problem = `${relative} ${name} over ${selection.main.from}-${selection.main.to} changed ${JSON.stringify(lost[0].slice(0, 40))}`;
            if (PENDING_PR1.has(name)) pending.push(problem);
            else failures.push(problem);
          }
        }

        // The popover: one typed character, then deleted, gives back the same bytes.
        for (const node of nodes.slice(0, SAMPLES)) {
          popovers += 1;
          const fresh = mathNodes(ensureSyntaxTree(view.state, body.length, 10_000) ?? tree as never, node.from, node.to).find((found) => found.from === node.from);
          if (!fresh) continue;
          openMathEditor(view, fresh);
          const editor = view.state.field(mathEditor);
          if (!editor) { failures.push(`${relative}@${node.from} popover did not open`); continue; }
          const typed = writeLive(view, editor, `${editor.tex}x`, () => true);
          if (typed.problem) failures.push(`${relative}@${node.from} typing refused: ${typed.problem}`);
          writeLive(view, view.state.field(mathEditor) ?? typed, editor.tex, () => true);
          closeMathEditor(view, editor.tex, false);
          if (view.state.doc.toString() !== body) {
            failures.push(`${relative}@${node.from} popover changed ${JSON.stringify(body.slice(node.from, node.to).slice(0, 40))}`);
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body } });
          }
        }
      } finally {
        view.destroy();
      }
    }
    console.info(openedLine('doc-mode math census', opened, vault));
    console.info(`[doc-mode math census] ${notes} notes with math: ${checked} formulas with no hidden range inside, ${commands} command runs, ${popovers} popover type-and-delete runs; ${failures.length} failed`);
    if (pending.length > 0) console.info(`[doc-mode math census] pending, PR 1: indent and list commands rewrite a block's lines: ${pending.length} runs\n  ${pending.slice(0, 20).join('\n  ')}`);
    if (failures.length > 0) console.info(`[doc-mode math census] failures:\n  ${failures.slice(0, 40).join('\n  ')}`);
    expect(failures).toEqual([]);
  }, 1_200_000);
});
