import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { MarkdownError, parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { calloutMarker } from '@/renderer/features/disk-explorer/components/editor/blockGuards';
import { insertNewlineInList, markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { clearFormatting, indentList, setHeading, toggleList, toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { nestListItems } from '@/renderer/features/disk-explorer/components/editor/listKeys';
import { blockSeparators, expectTyped, openedLine, sampleSpots, vaultFiles } from './censusHelpers';

/**
 * A read-only census of blocks in documents, over every Markdown file in a
 * real vault opened as a .mdo:
 *
 * - Select all, then each toolbar command: no byte inside a table, fence,
 *   rule, HTML block or callout marker changes, and every one of them still
 *   parses as the same block.
 * - Typing at the spots just above and below every table and rule keeps
 *   every table's rows and columns (`expectTyped`).
 * - Backspace and Delete at the ends of the two lines above and below the
 *   first tables and rules frame a block or leave every block whole.
 * - Tab on sampled list items raises the item's depth or changes no bytes.
 * - Enter at the end of sampled numbered items changes only the caret's line
 *   and adds one line.
 * - Notes over 100,000 characters run Select all with Bold and a list once
 *   more without a full parse first, as a page opens.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault [OPAL_CENSUS_OUT=report.json] npx vitest run src/tests/fidelity/docModeCensus.blocks.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;

const COMMANDS: [string, StateCommand][] = [
  ['bold', toggleMarker('**')],
  ['italic', toggleMarker('*')],
  ['strikethrough', toggleMarker('~~')],
  ['clear formatting', clearFormatting],
  ...[0, 1, 2, 3].map((level): [string, StateCommand] => [`heading ${level}`, setHeading(level)]),
  ['bulleted list', toggleList('bullet')],
  ['numbered list', toggleList('number')],
  ['checklist', toggleList('task')],
  ['indent', indentList(true)],
  ['outdent', indentList(false)],
];

const GUARDED = new Set(['Table', 'FencedCode', 'HorizontalRule', 'HTMLBlock']);
const LONG = 100_000;

interface Block {
  name: string;
  from: number;
  to: number;
}

/** The guarded blocks and callout markers of a page, in order. */
function blocksOf(state: EditorState, tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state)): Block[] {
  const blocks: Block[] = [];
  tree.iterate({
    enter: (ref) => {
      if (GUARDED.has(ref.name)) {
        const end = ref.to > ref.from && state.doc.lineAt(ref.to).from === ref.to ? ref.to - 1 : ref.to;
        blocks.push({ name: ref.name, from: ref.from, to: end });
        return false;
      }
      if (ref.name === 'Blockquote') {
        const marker = calloutMarker(state, state.doc.lineAt(ref.from));
        if (marker && !blocks.some((block) => block.from === marker.from)) blocks.push({ name: 'callout', from: marker.from, to: marker.to });
      }
      return ref.name !== 'Paragraph';
    },
  });
  return blocks;
}

/** What went wrong with the blocks after `tr`: bytes changed inside one, or one no longer parses as itself. */
function blockProblems(before: EditorState, tr: { changes: ChangeSet; state: EditorState }, blocks: readonly Block[]): string[] {
  const problems: string[] = [];
  for (const block of blocks) {
    let inside = false;
    tr.changes.iterChanges((fromA, toA) => {
      if ((fromA < block.to && toA > block.from) || (fromA === toA && fromA > block.from && fromA < block.to)) inside = true;
    });
    if (inside) problems.push(`bytes changed in ${block.name} at ${block.from}`);
  }
  if (problems.length > 0) return problems;
  const after = blocksOf(tr.state).map((block) => `${block.name}:${tr.state.sliceDoc(block.from, block.to)}`);
  const expected = blocks.map((block) => `${block.name}:${before.sliceDoc(block.from, block.to)}`);
  const lost = expected.filter((shape) => !after.includes(shape));
  if (lost.length > 0) problems.push(`reshaped: ${lost.map((shape) => JSON.stringify(shape.slice(0, 50))).join(', ')}`);
  return problems;
}

function listDepth(state: EditorState, at: number): number {
  let depth = 0;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (node.name === 'BulletList' || node.name === 'OrderedList') depth += 1;
  }
  return depth;
}

/** The first lines of up to `limit` list items, numbered ones only when `ordered`. */
function itemLines(state: EditorState, limit: number, ordered = false): number[] {
  const found: number[] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (found.length >= limit) return false;
      if (ref.name === 'ListMark' && ref.node.parent?.name === 'ListItem' && (!ordered || ref.node.parent.parent?.name === 'OrderedList')) found.push(state.doc.lineAt(ref.from).number);
      return true;
    },
  });
  return found;
}

const run = (command: StateCommand, state: EditorState): Transaction | null => {
  let result: Transaction | null = null;
  command({ state, dispatch: (tr) => { result = tr; } });
  return result;
};

describe.skipIf(!ROOT)('doc mode blocks census', () => {
  it('keeps every block whole through toolbar commands, typing, Tab and Enter', async () => {
    const vault = await vaultFiles(ROOT as string);
    const failures: string[] = [];
    const counts = { opened: 0, commands: 0, typed: 0, deletes: 0, tabs: 0, enters: 0, long: 0 };
    for (const file of vault.found) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch (error) {
        if (error instanceof MarkdownError) continue;
        throw error;
      }
      counts.opened += 1;
      const where = path.relative(ROOT as string, file);
      const extensions = markdownEditorExtensions(file.replace(/\.md$/i, '.mdo'));
      const state = EditorState.create({ doc: body, extensions });
      const blocks = blocksOf(state);
      try {
        // Select all, then each command.
        const all = state.update({ selection: { anchor: 0, head: body.length } }).state;
        for (const [name, command] of COMMANDS) {
          counts.commands += 1;
          const tr = run(command, all);
          if (!tr) continue;
          const problems = blockProblems(all, tr, blocks);
          if (problems.length > 0) failures.push(`${where} select all, ${name}: ${problems.join('; ')}`);
        }
        // Typing beside tables and rules.
        for (const spot of sampleSpots(state, { shares: [], limit: 8 }).filter((sampled) => /Table|HorizontalRule/.test(sampled.why))) {
          counts.typed += 1;
          const placed = state.update({ selection: { anchor: spot.at } }).state;
          const caret = placed.selection.main.head;
          const typed = placed.update({ changes: { from: caret, insert: 'x' }, selection: { anchor: caret + 1 }, userEvent: 'input.type' }).state;
          const problems = expectTyped(placed, typed, 'x', caret, { separators: blockSeparators(placed, caret) });
          if (problems.length > 0) failures.push(`${where}@${caret} typed ${spot.why}: ${problems.join('; ')}`);
        }
        // Backspace and Delete at the ends of the two lines above and below tables and rules:
        // a first press frames a block or leaves every block's bytes and shape alone.
        const beside = blocks.filter((block) => block.name === 'Table' || block.name === 'HorizontalRule').slice(0, 2);
        if (beside.length > 0) {
          const pressed: Transaction[] = [];
          const view = new EditorView({
            parent: document.body,
            state,
            dispatchTransactions: (trs, target) => {
              pressed.push(...trs);
              target.update(trs);
            },
          });
          ensureSyntaxTree(view.state, body.length, 10_000);
          view.dispatch({});
          const base = view.state;
          const inBlock = (at: number) => blocks.some((block) => block.from <= at && at <= block.to);
          try {
            for (const block of beside) {
              const first = base.doc.lineAt(block.from).number;
              const last = base.doc.lineAt(block.to).number;
              for (const number of [first - 2, first - 1, last + 1, last + 2]) {
                if (number < 1 || number > base.doc.lines) continue;
                const line = base.doc.line(number);
                if (inBlock(line.from) || inBlock(line.to)) continue;
                for (const [key, at] of [['Backspace', line.from], ['Delete', line.to]] as const) {
                  counts.deletes += 1;
                  view.setState(base);
                  view.dispatch({ selection: { anchor: at } });
                  const placed = view.state;
                  pressed.length = 0;
                  runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor');
                  if (view.state.doc.eq(placed.doc)) continue;
                  const changes = pressed.reduce((all, tr) => all.compose(tr.changes), ChangeSet.empty(placed.doc.length));
                  // Backspace at the start of a callout's title takes off its "[!type]", as it should.
                  const titled = key === 'Backspace' && calloutMarker(placed, line) !== null;
                  const problems = blockProblems(placed, { changes, state: view.state }, blocks).filter((problem) => !(titled && problem.startsWith('bytes changed in callout')));
                  if (problems.length > 0) failures.push(`${where} ${key} on line ${number} beside ${block.name}: ${problems.join('; ')}`);
                }
              }
            }
          } finally {
            view.destroy();
          }
        }
        // Tab on list items.
        for (const number of itemLines(state, 4)) {
          counts.tabs += 1;
          const line = state.doc.line(number);
          const placed = state.update({ selection: { anchor: line.to } }).state;
          const tr = run(nestListItems(true), placed);
          if (!tr) continue;
          const depth = listDepth(placed, line.from + (/^[\s>]*/.exec(line.text)?.[0].length ?? 0));
          const moved = tr.state.doc.lineAt(tr.changes.mapPos(line.to));
          const after = listDepth(tr.state, moved.from + (/^[\s>]*/.exec(moved.text)?.[0].length ?? 0));
          const others = body.split('\n').filter((_, index) => index !== number - 1).join('\n');
          const othersAfter = tr.state.doc.toString().split('\n').filter((_, index) => index !== moved.number - 1).join('\n');
          if (after <= depth) failures.push(`${where} Tab on line ${number}: depth ${depth} became ${after}`);
          if (others !== othersAfter) failures.push(`${where} Tab on line ${number}: other lines changed`);
        }
        // Enter at the end of numbered items.
        for (const number of itemLines(state, 3, true)) {
          const line = state.doc.line(number);
          // An empty item ends its list on Enter, which is meant to change the lines around it.
          if (!/^[\s>]*\d+[.)](?:[ \t]+\[[ xX]\])?[ \t]+\S/.test(line.text)) continue;
          counts.enters += 1;
          const placed = state.update({ selection: { anchor: line.to } }).state;
          const tr = run(insertNewlineInList, placed);
          if (!tr) continue;
          // The caret's line may lose spaces at its end; the new item follows it, after a blank line in a loose list.
          const before = body.split('\n');
          const after = tr.state.doc.toString().split('\n');
          const added = after.length - before.length;
          const expected = [...before.slice(0, number - 1), ...before.slice(number)];
          const kept = [...after.slice(0, number - 1), ...after.slice(number + added)];
          const blankFirst = added === 2 && !/[^\s>]/.test(after[number]);
          if ((added !== 1 && !blankFirst) || kept.join('\n') !== expected.join('\n')) failures.push(`${where} Enter at the end of line ${number} changed other lines`);
        }
        // A long note, without the full parse a census does first.
        if (body.length > LONG) {
          counts.long += 1;
          const fresh = EditorState.create({ doc: body, extensions, selection: { anchor: 0, head: body.length } });
          for (const [name, command] of [['bold', toggleMarker('**')], ['bulleted list', toggleList('bullet')]] as const) {
            const tr = run(command, fresh);
            const problems = tr ? blockProblems(fresh, tr, blocks) : [];
            if (problems.length > 0) failures.push(`${where} long note, ${name}: ${problems.join('; ')}`);
          }
        }
      } catch (error) {
        failures.push(`${where} threw ${(error as Error).message}`);
      }
    }
    console.info(openedLine('blocks census', counts.opened, vault));
    console.info(`[blocks census] ${counts.commands} select-all commands, ${counts.typed} typed characters beside tables and rules, ${counts.deletes} Backspaces and Deletes beside them, ${counts.tabs} Tabs, ${counts.enters} Enters, ${counts.long} long notes without a full parse: ${failures.length} failed`);
    if (process.env.OPAL_CENSUS_OUT) await writeFile(process.env.OPAL_CENSUS_OUT, JSON.stringify({ root: ROOT, counts, failures }, null, 2));
    expect(failures).toEqual([]);
  }, 1_800_000);
});
