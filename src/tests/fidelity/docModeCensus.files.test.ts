import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { MarkdownError, parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { objectAt, objectKind, type ObjectAction, type PageObject } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { fileActions, refAt, setAskText } from '@/renderer/features/disk-explorer/components/editor/fileActions';
import { inCode, inTableAt, readAddress } from '@/renderer/features/disk-explorer/components/editor/fileEmbeds';
import { caretInText, chipAt, insertedText, placeEmbed } from '@/renderer/features/disk-explorer/components/editor/imageInsert';
import { pickedText } from '@/renderer/features/disk-explorer/components/editor/linkPicker';
import { linkTarget } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { linksResolved, namesFile, parseWikiTarget } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { openPage, openedLine, vaultFiles } from './censusHelpers';

/**
 * A read-only census of file links and wiki links in a real vault, opened
 * as documents. Next to sampled embeds, file links and unaliased wiki links,
 * Backspace (pressed twice, for a block that frames first) and a typed
 * character change the whole object or nothing: never part of a path or a
 * target. Every bar action that writes (Show as, Size, Caption…, Rename…),
 * on objects alone on their line, in text and in table cells, changes only
 * its own link's line, keeps every table row's cells and every code block's
 * text, and leaves a link to the same file. Links put in by the [[ picker
 * and by paste or Insert > File… at sampled places in table cells, code and
 * quotes keep the same shapes and read back as the file or note picked.
 * Nothing is written to the vault.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault [OPAL_CENSUS_OUT=report.json] npx vitest run src/tests/fidelity/docModeCensus.files.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;
const PER_FILE = 6;
const LINK = /\[\[|\]\(/;
const NODES = new Set(['Embed', 'WikiLink', 'Image', 'Link']);

/** The span `before` lost or changed to become `after`, by their common ends. */
function changed(before: string, after: string): { from: number; to: number } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  return { from: start, to: before.length - end };
}

/**
 * Whether `after` kept the object at `from` to `to` in `before` whole: it
 * changed nothing inside it, or took all of it, leaving at most quote marks
 * and line breaks in its place. Two links that start alike would make the
 * plain diff start inside the object, so the ends are tried at its edges too.
 */
function whole(before: string, after: string, from: number, to: number): boolean {
  const edit = changed(before, after);
  if (!edit || edit.to <= from || edit.from >= to) return true;
  if (edit.from <= from && edit.to >= to) return true;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length && suffix < after.length && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  // Kept: before up to `head` and from `tail` on; between them `after` may hold only a separator.
  const tail = Math.max(before.length - suffix, to);
  const kept = before.length - tail;
  const head = Math.min(prefix, from, after.length - kept);
  return head >= 0 && /^[\s>]*$/.test(after.slice(head, after.length - kept));
}

const press = (view: EditorView, key: string) => runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor');

/** What a page's structure is: each table row's cell count and each code block's text. */
function shape(state: EditorState): string {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state);
  const parts: string[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === 'TableRow' || node.name === 'TableHeader') parts.push(`row ${node.node.getChildren('TableCell').length}`);
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') parts.push(`code ${state.sliceDoc(node.from, node.to)}`);
    },
  });
  return parts.join('\n');
}

/**
 * Places a caret could be when a link goes in: after a space in a table
 * cell's or a quote's text, outside any link or formatting there, and the
 * middle of a code line. At most one of each.
 */
function insertSpots(state: EditorState): { at: number; why: string }[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state);
  const spots = new Map<string, number>();
  tree.iterate({
    enter: (node) => {
      const why = node.name === 'TableCell' ? 'table cell' : node.name === 'CodeText' ? 'code' : node.name === 'Paragraph' && node.node.parent?.name === 'Blockquote' ? 'quote' : null;
      if (!why || spots.has(why) || node.to - node.from < 2) return;
      if (why === 'code') {
        spots.set(why, node.from + Math.floor((node.to - node.from) / 2));
        return;
      }
      for (let at = node.from + 1; at < node.to; at += 1) {
        if (state.sliceDoc(at - 1, at) !== ' ' || state.doc.lineAt(at).number !== state.doc.lineAt(node.from).number) continue;
        if (tree.resolveInner(at, -1).name !== node.name || tree.resolveInner(at, 1).name !== node.name) continue;
        spots.set(why, at);
        break;
      }
    },
  });
  return [...spots].map(([why, at]) => ({ at, why }));
}

/** The file or note the link inserted from `from` to `to` points at, read back from the page. */
function readBack(state: EditorState, from: number, to: number, page: string): string | null {
  const ref = refAt(state, { from, to });
  if (ref) return ref.path ?? ref.target;
  let found: string | null = null;
  ensureSyntaxTree(state, to, 10_000)?.iterate({
    from,
    to,
    enter: (node) => {
      if (found !== null) return false;
      if (node.name === 'WikiLink') {
        found = parseWikiTarget(state.sliceDoc(node.from + 2, node.to - 2).replace(/\\\|/g, '|')).target;
        return false;
      }
      if (node.name === 'Link') {
        const written = linkTarget(state, node.node);
        if (written) found = readAddress(written, page).path;
        return false;
      }
      return undefined;
    },
  });
  return found;
}

/** What the census puts in: a stored PDF, a deck whose name holds a pipe, and a note whose name holds "#". */
const ENTRIES = ROOT ? [
  { path: path.join(ROOT, 'Library/files/2026-11/q3-report.a3f9c2e1.pdf'), name: 'q3-report.a3f9c2e1.pdf' },
  { path: path.join(ROOT, 'Docs/Plan | v2.pptx'), name: 'Plan | v2.pptx' },
  { path: path.join(ROOT, 'Projects/PR #12 notes.md'), name: 'PR #12 notes.md' },
] : [];

describe.skipIf(!ROOT)('doc mode census of files and wiki links', () => {
  it('never edits part of a path or target when Backspace or typing meets an object, and bar actions change only their own link', async () => {
    useDiskStore.setState({ roots: [ROOT as string] });
    setAskText(async (_view, _at, label) => (label === 'Caption' ? 'Chart | Q3 *draft*' : 'Plan | v2 *final*'));
    const vault = await vaultFiles(ROOT as string);
    const failures: string[] = [];
    let opened = 0;
    let objects = 0;
    let runs = 0;
    let barRuns = 0;
    let cellObjects = 0;
    let insertRuns = 0;
    for (const file of vault.found) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch (error) {
        if (error instanceof MarkdownError) continue;
        throw error;
      }
      if (!LINK.test(body)) continue;
      opened += 1;
      const relative = path.relative(ROOT as string, file);
      const view = openPage(file, body, { asDocument: true });
      try {
        // Every wiki target counts as found, so previews draw as they would in the app.
        const targets: Record<string, string> = {};
        const nodes: { from: number; to: number }[] = [];
        syntaxTree(view.state).iterate({
          enter: (ref) => {
            if (!NODES.has(ref.name)) return;
            if (ref.name === 'WikiLink' || ref.name === 'Embed') {
              const inner = view.state.sliceDoc(ref.from, ref.to).replace(/^!?\[\[|\]\]$/g, '');
              const { target } = parseWikiTarget(inner);
              // Notes stay unresolved: their real paths end in .md, which a guess would not.
              if (target && namesFile(target)) targets[target] = path.join(ROOT as string, target);
            }
            nodes.push({ from: ref.from, to: ref.to });
            return false;
          },
        });
        view.dispatch({ effects: linksResolved.of(targets) });
        const page = file.replace(/\.md$/i, '.mdo');
        const startShape = shape(view.state);
        const found = nodes
          .map((node) => objectAt(view.state, node.from, 0))
          .filter((obj, index, all): obj is NonNullable<typeof obj> => obj !== null && all.findIndex((other) => other?.from === obj.from && other?.to === obj.to) === index);
        const step = Math.max(1, Math.floor(found.length / PER_FILE));
        const sampled = found.filter((_obj, index) => index % step === 0 && index / step < PER_FILE);
        // File links in table cells too, where a written "|" would end the cell. A document draws the table as one
        // object, so their bars are reached through the table's source; only the bar's writes are tried there.
        const inCells: PageObject[] = nodes
          .filter((node) => inTableAt(view.state, node.from + 1) && refAt(view.state, node) !== null)
          .slice(0, PER_FILE / 2)
          .map((node) => ({ kind: 'file-inline', from: node.from, to: node.to, node: 'Link' }));
        for (const obj of [...sampled, ...inCells]) {
          const barOnly = inCells.includes(obj);
          if (barOnly) cellObjects += 1;
          objects += 1;
          const where = `${relative}@${obj.from} ${obj.kind}`;
          const node = nodes.find((candidate) => candidate.from >= obj.from && candidate.to <= obj.to) ?? obj;
          const start = view.state;
          const reset = () => view.setState(start);
          if (!barOnly) {
            // Backspace right after it, twice for a block, which frames first.
            runs += 1;
            view.dispatch({ selection: { anchor: Math.min(obj.to, start.doc.length) } });
            press(view, 'Backspace');
            if (view.state.field(objectFrame, false)) press(view, 'Backspace');
            if (!whole(body, view.state.doc.toString(), node.from, node.to)) failures.push(`${where} Backspace after it`);
            reset();
            // Delete right before it.
            runs += 1;
            view.dispatch({ selection: { anchor: obj.from } });
            press(view, 'Delete');
            if (view.state.field(objectFrame, false)) press(view, 'Delete');
            if (!whole(body, view.state.doc.toString(), node.from, node.to)) failures.push(`${where} Delete before it`);
            reset();
            // A typed character on either side lands outside it.
            for (const at of [node.from, node.to]) {
              runs += 1;
              view.dispatch({ selection: { anchor: at } });
              const caret = view.state.selection.main.head;
              view.dispatch({ changes: { from: caret, insert: 'x' }, selection: { anchor: caret + 1 }, userEvent: 'input.type' });
              const edit = changed(body, view.state.doc.toString());
              if (edit && edit.from > node.from && edit.from < node.to) failures.push(`${where} typed inside at ${caret}`);
              reset();
            }
          }
          // Every bar action that writes changes only the link's own line, keeps the page's shapes, and leaves a link to the same file.
          if (!obj.kind.startsWith('file')) continue;
          const line = start.doc.lineAt(obj.from);
          const pointsAt = (state: EditorState) => {
            const ref = refAt(state, objectKind(state, obj.kind)?.block ? { from: line.from, to: state.doc.lineAt(line.from).to } : { from: obj.from, to: obj.from });
            return ref ? ref.path ?? ref.url ?? ref.target : null;
          };
          const before = pointsAt(start);
          const actions = fileActions(start, obj);
          const sub = (id: string) => actions.find((action) => action.id === id)?.items ?? [];
          const top = (id: string) => actions.filter((action) => action.id === id);
          const runnable: ObjectAction[] = [...sub('show-as'), ...sub('size'), ...top('caption'), ...sub('more').filter((action) => action.id === 'rename')]
            .filter((action) => !action.disabled && action.run);
          for (const action of runnable) {
            runs += 1;
            barRuns += 1;
            action.run?.(view, obj);
            await new Promise((resolve) => setTimeout(resolve, 0));
            const after = view.state.doc.toString();
            const edit = changed(body, after);
            if (edit && (edit.from < line.from || edit.to > line.to)) failures.push(`${where} ${action.id} changed outside its line`);
            else if (shape(view.state) !== startShape) failures.push(`${where} ${action.id} changed a table row or code block`);
            else if (edit && pointsAt(view.state) !== before) failures.push(`${where} ${action.id} now points at ${pointsAt(view.state)}, not ${before}`);
            reset();
          }
        }
        // Links put in at places in table cells, code and quotes, by the picker and by paste or Insert > File….
        const start = view.state;
        for (const spot of insertSpots(start)) {
          const inTable = inTableAt(start, spot.at);
          const where = `${relative}@${spot.at} ${spot.why}`;
          if (spot.why === 'code' && !inCode(start, spot.at)) failures.push(`${where} the picker would open in code`);
          const tries: { how: string; from: number; insert: string; wanted: string[] }[] = [];
          for (const entry of ENTRIES) {
            const wanted = [entry.path, path.relative(ROOT as string, entry.path), path.relative(ROOT as string, entry.path).replace(/\.md$/, '')];
            if (spot.why !== 'code') {
              const picked = pickedText(entry, page, false, false, inTable);
              tries.push({ how: `picker ${entry.name}`, from: spot.at, insert: picked.text, wanted });
            }
            if (entry.path.endsWith('.md')) continue;
            const file = { path: entry.path, vaultPath: path.relative(ROOT as string, entry.path), name: entry.name };
            const inline = caretInText(start, spot.at);
            const put = inline !== null
              ? chipAt(start, inline, insertedText(file, page, 'chip', null, inTableAt(start, inline)))
              : placeEmbed(start, start.doc.lineAt(spot.at).to, insertedText(file, page, 'default', null));
            tries.push({ how: `paste ${entry.name}`, from: put.from, insert: put.insert, wanted });
          }
          for (const attempt of tries) {
            runs += 1;
            insertRuns += 1;
            const next = start.update({ changes: { from: attempt.from, insert: attempt.insert } }).state;
            if (shape(next) !== startShape) failures.push(`${where} ${attempt.how} changed a table row or code block`);
            const back = readBack(next, attempt.from, attempt.from + attempt.insert.length, page);
            if (!back || !attempt.wanted.includes(back)) failures.push(`${where} ${attempt.how} reads back as ${back}`);
          }
        }
      } catch (error) {
        failures.push(`${relative} threw ${(error as Error).message}`);
      } finally {
        view.destroy();
      }
    }
    console.info(openedLine('files census', opened, vault));
    console.info(`[files census] ${objects} objects in ${opened} files with links (${cellObjects} in table cells), ${runs} runs (${barRuns} bar actions, ${insertRuns} inserts): ${runs - failures.length} kept their objects whole, ${failures.length} failed`);
    if (process.env.OPAL_CENSUS_OUT) await writeFile(process.env.OPAL_CENSUS_OUT, JSON.stringify({ root: ROOT, opened, objects, runs, failed: failures }, null, 2));
    setAskText(null);
    expect(failures.slice(0, 40)).toEqual([]);
  }, 1_800_000);
});
