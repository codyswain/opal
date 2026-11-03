import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { syntaxTree } from '@codemirror/language';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { MarkdownError, parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { objectAt, objectKind, type ObjectAction } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { fileActions } from '@/renderer/features/disk-explorer/components/editor/fileActions';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { linksResolved, namesFile, parseWikiTarget } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { openPage, openedLine, vaultFiles } from './censusHelpers';

/**
 * A read-only census of file links and wiki links in a real vault, opened
 * as documents. Next to sampled embeds, file links and unaliased wiki links,
 * Backspace (pressed twice, for a block that frames first) and a typed
 * character change the whole object or nothing: never part of a path or a
 * target. The bar's Show as and Size change only their own link's line.
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

describe.skipIf(!ROOT)('doc mode census of files and wiki links', () => {
  it('never edits part of a path or target when Backspace or typing meets an object, and bar actions change only their own link', async () => {
    const vault = await vaultFiles(ROOT as string);
    const failures: string[] = [];
    let opened = 0;
    let objects = 0;
    let runs = 0;
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
        const found = nodes
          .map((node) => objectAt(view.state, node.from, 0))
          .filter((obj, index, all): obj is NonNullable<typeof obj> => obj !== null && all.findIndex((other) => other?.from === obj.from && other?.to === obj.to) === index);
        const step = Math.max(1, Math.floor(found.length / PER_FILE));
        for (let index = 0; index < found.length && index / step < PER_FILE; index += step) {
          const obj = found[index];
          objects += 1;
          const where = `${relative}@${obj.from} ${obj.kind}`;
          const node = nodes.find((candidate) => candidate.from >= obj.from && candidate.to <= obj.to) ?? obj;
          const start = view.state;
          const reset = () => view.setState(start);
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
          // Show as and Size change only the link's own line.
          if (!objectKind(view.state, obj.kind)?.block || !obj.kind.startsWith('file')) continue;
          const line = start.doc.lineAt(obj.from);
          const actions = fileActions(start, obj);
          const sub = (id: string) => actions.find((action) => action.id === id)?.items ?? [];
          const runnable: ObjectAction[] = [...sub('show-as'), ...sub('size').slice(0, 1)].filter((action) => !action.disabled && action.run);
          for (const action of runnable) {
            runs += 1;
            action.run?.(view, obj);
            await new Promise((resolve) => setTimeout(resolve, 0));
            const edit = changed(body, view.state.doc.toString());
            if (edit && (edit.from < line.from || edit.to > line.to)) failures.push(`${where} ${action.id} changed outside its line`);
            reset();
          }
        }
      } catch (error) {
        failures.push(`${relative} threw ${(error as Error).message}`);
      } finally {
        view.destroy();
      }
    }
    console.info(openedLine('files census', opened, vault));
    console.info(`[files census] ${objects} objects in ${opened} files with links, ${runs} runs: ${runs - failures.length} kept their objects whole, ${failures.length} failed`);
    if (process.env.OPAL_CENSUS_OUT) await writeFile(process.env.OPAL_CENSUS_OUT, JSON.stringify({ root: ROOT, opened, objects, runs, failed: failures }, null, 2));
    expect(failures.slice(0, 40)).toEqual([]);
  }, 1_800_000);
});
