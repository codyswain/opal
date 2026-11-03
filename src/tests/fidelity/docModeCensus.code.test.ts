import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { MarkdownError, parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { fenceOf, type Fence } from '@/renderer/features/disk-explorer/components/editor/codeBlocks';
import { loadAllLanguages } from '@/renderer/features/disk-explorer/components/editor/codeLanguages';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { toggleMarker } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { openedLine, vaultFiles } from './censusHelpers';

/**
 * A read-only census of the vault's code, each file opened as a document:
 * typing at sampled places in every fence changes only those bytes and never
 * a fence line; the characters other features treat as syntax (`\`, `\.`,
 * `*`, `_`, a backtick, `1984. `, `<!--`, `---`) go into fences and inline
 * code as typed; a three-line paste into a quoted or listed fence leaves its
 * container parsing the same (PR 2's prefixing, counted as pending until it
 * lands); and select all plus Bold leaves every fence's bytes alone.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault npx vitest run src/tests/fidelity/docModeCensus.code.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;

const LITERALS = ['\\', '\\.', '*', '_', '`', '1984. ', '<!--', '---'];
const FENCES_PER_FILE = 4;
const PASTE = 'one\ntwo\nthree';

/** Types `text` one character at a time at the caret, as a user does. */
function typeAt(state: EditorState, at: number, text: string): EditorState {
  let next = state.update({ selection: { anchor: at } }).state;
  for (const character of text) {
    const caret = next.selection.main.head;
    next = next.update({ changes: { from: caret, insert: character }, selection: { anchor: caret + 1 }, userEvent: 'input.type' }).state;
  }
  return next;
}

function fencesOf(state: EditorState): Fence[] {
  const fences: Fence[] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'FencedCode') return undefined;
      fences.push(fenceOf(state, ref.node));
      return false;
    },
  });
  return fences;
}

const fenceLines = (state: EditorState) => fencesOf(state).map((fence) => `${fence.open.text}\u0000${fence.close?.text ?? ''}`);

function within(node: SyntaxNode, name: string): boolean {
  for (let at = node.parent; at; at = at.parent) if (at.name === name) return true;
  return false;
}

beforeAll(async () => {
  await loadAllLanguages();
});

describe.skipIf(!ROOT)('code census', () => {
  it('types, pastes and formats around the vault\'s code without touching fences', async () => {
    const vault = await vaultFiles(ROOT as string);
    const failures: string[] = [];
    const pendingPaste: string[] = [];
    let opened = 0;
    let fenced = 0;
    let fences = 0;
    let typing = 0;
    let literals = 0;
    let inline = 0;
    let pastes = 0;
    let bolded = 0;
    for (const file of vault.found) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch (error) {
        if (error instanceof MarkdownError) continue;
        throw error;
      }
      opened += 1;
      if (!body.includes('```') && !body.includes('~~~') && !body.includes('`')) continue;
      const state = EditorState.create({ doc: body, extensions: markdownEditorExtensions(file.replace(/\.md$/i, '.mdo')) });
      ensureSyntaxTree(state, state.doc.length, 10_000);
      const ready = state.update({}).state;
      const relative = path.relative(ROOT as string, file);
      const all = fencesOf(ready);
      const before = fenceLines(ready);
      if (all.length > 0) fenced += 1;
      fences += all.length;

      for (const fence of all.slice(0, FENCES_PER_FILE)) {
        if (fence.lines.length === 0) continue;
        const first = fence.lines[0];
        const last = fence.lines[fence.lines.length - 1];
        const middle = fence.lines[Math.floor(fence.lines.length / 2)];
        const spots = [first.from + Math.floor((first.line.to - first.from) / 2), last.line.to, middle.from];
        // A blank code line that lost its list item's indent gets it back with the first typed character.
        const indentFor = (at: number) => {
          const line = ready.doc.lineAt(at);
          const have = body.slice(line.from, at);
          return at === line.to && /^[\s>]*$/.test(line.text) && have.length < fence.prefix.length && fence.prefix.startsWith(have) ? fence.prefix.slice(have.length) : '';
        };
        for (const at of spots) {
          typing += 1;
          const after = typeAt(ready, at, 'x');
          const expected = body.slice(0, at) + indentFor(at) + 'x' + body.slice(at);
          if (after.doc.toString() !== expected) failures.push(`${relative}@${at} typing in a fence changed other bytes`);
          else if (fenceLines(after).join('\n') !== before.join('\n')) failures.push(`${relative}@${at} typing in a fence changed a fence line`);
        }
        for (const literal of LITERALS) {
          literals += 1;
          const after = typeAt(ready, middle.from, literal);
          if (after.doc.toString() !== body.slice(0, middle.from) + indentFor(middle.from) + literal + body.slice(middle.from)) failures.push(`${relative}@${middle.from} typing ${JSON.stringify(literal)} in a fence wrote other bytes`);
        }
        const quoted = within(fence.node, 'Blockquote') || within(fence.node, 'ListItem');
        if (quoted) {
          pastes += 1;
          const at = middle.line.to;
          const pasted = ready.update({ changes: { from: at, insert: PASTE }, selection: { anchor: at + PASTE.length }, userEvent: 'input.paste' }).state;
          ensureSyntaxTree(pasted, pasted.doc.length, 10_000);
          // The block still ends at its own closing fence, inside its quote or item.
          const node = syntaxTree(pasted).resolveInner(fence.node.from + 1, 1);
          let block: SyntaxNode | null = node;
          while (block && block.name !== 'FencedCode') block = block.parent;
          const closeTo = (fence.close ?? last.line).to;
          if (!block || block.to < closeTo + PASTE.length || !(within(block, 'Blockquote') || within(block, 'ListItem'))) pendingPaste.push(`${relative}@${at}`);
        }
      }

      let codeSpans = 0;
      syntaxTree(ready).iterate({
        enter: (ref) => {
          // Cells of a drawn table take the caret only through the table's source (PR 1).
          if (ref.name === 'Table') return false;
          if (ref.name !== 'InlineCode' || codeSpans >= 2) return undefined;
          const marks = ref.node.getChildren('CodeMark');
          if (marks.length < 2 || marks[1].from - marks[0].to < 2) return false;
          codeSpans += 1;
          const at = marks[0].to + 1;
          for (const literal of LITERALS) {
            inline += 1;
            const after = typeAt(ready, at, literal);
            if (after.doc.toString() !== body.slice(0, at) + literal + body.slice(at)) failures.push(`${relative}@${at} typing ${JSON.stringify(literal)} in inline code wrote other bytes`);
          }
          return false;
        },
      });

      if (all.length > 0) {
        bolded += 1;
        let result = ready;
        toggleMarker('**')({ state: ready.update({ selection: EditorSelection.range(0, ready.doc.length) }).state, dispatch: (tr) => { result = tr.state; } });
        const kept = fencesOf(result).map((fence) => result.sliceDoc(fence.open.from, (fence.close ?? fence.open).to));
        const original = all.map((fence) => ready.sliceDoc(fence.open.from, (fence.close ?? fence.open).to));
        if (kept.join('\u0000') !== original.join('\u0000')) failures.push(`${relative} select all and Bold changed a code block`);
      }
    }
    console.info(openedLine('code census', opened, vault));
    console.info(`[code census] ${fences} fences in ${fenced} files; ${typing} typed characters in fences, ${literals} literal runs in fences, ${inline} in inline code, ${bolded} pages bolded whole: ${failures.length} failed`);
    console.info(`[code census] pending, PR 2: ${pendingPaste.length} of ${pastes} three-line pastes into quoted or listed fences change the container's shape`);
    const kinds = new Map<string, number>();
    for (const failure of failures) {
      const kind = failure.replace(/^\S+ /, '');
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    for (const [kind, count] of kinds) console.info(`[code census] failed ${count}: ${kind}, first at ${failures.find((failure) => failure.endsWith(kind))?.split(' ')[0]}`);
    expect(failures.slice(0, 40)).toEqual([]);
  }, 1_200_000);
});
