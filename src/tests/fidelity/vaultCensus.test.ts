import { describe, expect, it } from 'vitest';
import { lstat, readFile, readdir, writeFile } from 'fs/promises';
import path from 'path';
import { EditorState } from '@codemirror/state';
import { MarkdownError, joinMarkdown, parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';

/**
 * A read-only census of a real vault, in memory: every Markdown file is split
 * the way the service reads it, loaded into the editor's state, and joined
 * back, and must come out byte for byte; with one typed character it must
 * come out one byte longer and otherwise the same. Nothing is written to the
 * vault.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault [OPAL_CENSUS_OUT=report.json] npx vitest run src/tests/fidelity
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;

async function markdownFiles(dir: string, found: string[] = [], links: string[] = []): Promise<{ found: string[]; links: string[] }> {
  for (const name of await readdir(dir)) {
    if (name === '.git') continue;
    const full = path.join(dir, name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) { if (name.toLowerCase().endsWith('.md')) links.push(full); continue; }
    if (info.isDirectory()) await markdownFiles(full, found, links);
    else if (info.isFile() && name.toLowerCase().endsWith('.md')) found.push(full);
  }
  return { found, links };
}

/** Where an LF body offset falls in the source text, which may use CRLF. */
function sourceIndex(source: string, offset: number): number {
  let index = 0;
  for (let seen = 0; seen < offset; seen += 1) index += source.startsWith('\r\n', index) ? 2 : 1;
  return index;
}

describe.skipIf(!ROOT)('vault census', () => {
  it('reproduces every Markdown file byte for byte', async () => {
    const { found, links } = await markdownFiles(ROOT as string);
    const failures: string[] = [];
    const editFailures: string[] = [];
    const notText: string[] = [];
    let withFrontmatter = 0;
    let crlf = 0;
    for (const file of found) {
      const bytes = await readFile(file);
      let parsed;
      try {
        parsed = parseMarkdown(bytes);
      } catch (error) {
        if (error instanceof MarkdownError) { notText.push(file); continue; }
        throw error;
      }
      if (parsed.hasFrontmatter) withFrontmatter += 1;
      if (parsed.source.includes('\r\n')) crlf += 1;
      const state = EditorState.create({ doc: parsed.body, extensions: markdownEditorExtensions(file) });
      const doc = state.doc.toString();
      if (doc !== parsed.body || !joinMarkdown(parsed, doc).equals(bytes)) { failures.push(file); continue; }
      // One typed character lands as one more byte, everything else unchanged.
      // Log pages are read-only, and the middle line of an old daily log is often in its
      // Activity Log, so this skips the guard.
      const at = state.doc.line(Math.ceil(state.doc.lines / 2)).from;
      const edited = joinMarkdown(parsed, state.update({ changes: { from: at, insert: 'x' }, filter: false }).state.doc.toString());
      const offset = parsed.prefix.length + Buffer.byteLength(parsed.source.slice(0, sourceIndex(parsed.source, at)));
      if (!edited.equals(Buffer.concat([bytes.subarray(0, offset), Buffer.from('x'), bytes.subarray(offset)]))) editFailures.push(file);
    }
    const report = {
      root: ROOT,
      files: found.length,
      passed: found.length - notText.length - failures.length,
      failed: failures,
      oneCharacterEditFailed: editFailures,
      notUtf8: notText,
      symlinksSkipped: links.length,
      withFrontmatter,
      crlf,
    };
    console.info(`[census] ${report.passed}/${found.length - notText.length} editable files reproduce exactly, ${editFailures.length} miss on a one-character edit; ${notText.length} are not UTF-8; ${links.length} symlinks skipped`);
    if (process.env.OPAL_CENSUS_OUT) await writeFile(process.env.OPAL_CENSUS_OUT, JSON.stringify(report, null, 2));
    expect(failures).toEqual([]);
    expect(editFailures).toEqual([]);
  }, 600_000);
});
