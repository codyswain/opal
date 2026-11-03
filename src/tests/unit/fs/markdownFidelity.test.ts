import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { EditorState } from '@codemirror/state';
vi.mock('@/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { MarkdownDocumentService } from '@/main/fs/MarkdownDocumentService';
import { RootRegistry } from '@/main/fs/RootRegistry';
import { isLogPage } from '@/renderer/features/disk-explorer/components/editor/activityLog';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';

/**
 * Opal never rewrites text it did not change: a note read into the editor
 * and saved without edits keeps every byte, and a one-character edit changes
 * one character on disk. The fixtures cover the Markdown that the old
 * round-tripping editor damaged.
 */
const FIXTURES = path.resolve(__dirname, '../../fixtures/notes');

const BOM = '\uFEFF';

const VARIANTS: Record<string, (text: string) => Buffer> = {
  'as written': (text) => Buffer.from(text),
  CRLF: (text) => Buffer.from(text.replace(/\n/g, '\r\n')),
  'BOM and frontmatter': (text) => Buffer.from(`${BOM}---\ntitle: "Kept: exactly"\ntags: [a, b]   \n---\n${text}`),
  'no trailing newline, trailing whitespace': (text) => Buffer.from(`${text.trimEnd()}\n\t  \nlast  \t`),
  'mixed line endings and a lone CR': (text) => Buffer.from(text.replace(/\n/g, (_, offset: number) => (offset % 3 === 0 ? '\r\n' : '\n')) + 'old mac\rline\n'),
  'BOM inside the body': (text) => Buffer.from(`---\na: 1\n---\n${BOM}${text}`),
};

let tmp: string;
let root: string;
let service: MarkdownDocumentService;
const noteEdited = vi.fn(async () => undefined);

beforeEach(async () => {
  noteEdited.mockClear();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opal-fidelity-'));
  const registry = new RootRegistry({ storePath: path.join(tmp, 'roots.json') });
  await mkdir(path.join(tmp, 'Vault/Library/daily'), { recursive: true });
  await mkdir(path.join(tmp, 'Vault/Library/logs'), { recursive: true });
  root = await registry.add(path.join(tmp, 'Vault'));
  service = new MarkdownDocumentService({ registry, activity: { noteEdited } });
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

async function fixtureNames(): Promise<string[]> {
  return (await readdir(FIXTURES)).filter((name) => name.endsWith('.md')).sort();
}

/** Opens a file the way the page does: read through the service, then into the editor's state. */
async function open(bytes: Buffer, name: string) {
  const folder = { 'daily.md': 'Library/daily', 'log.md': 'Library/logs' }[name];
  const file = path.join(root, folder ? `${folder}/${name}` : name);
  await writeFile(file, bytes);
  const document = await service.read(file);
  const state = EditorState.create({ doc: document.body, extensions: markdownEditorExtensions(file) });
  return { file, document, state };
}

describe('Markdown fidelity', () => {
  it('has fixtures for callouts, links, tables, lists, code, logs and typography', async () => {
    expect(await fixtureNames()).toEqual(['callouts.md', 'code.md', 'daily.md', 'links.md', 'lists.md', 'log.md', 'tables.md', 'typography.md']);
  });

  for (const [variant, encode] of Object.entries(VARIANTS)) {
    it(`opens and saves every fixture byte for byte (${variant})`, async () => {
      for (const name of await fixtureNames()) {
        const bytes = encode(await readFile(path.join(FIXTURES, name), 'utf8'));
        const { file, document, state } = await open(bytes, name);
        expect(state.doc.toString(), name).toBe(document.body);
        const before = (await stat(file)).mtimeMs;
        const written = await service.write(file, state.doc.toString(), document.revision);
        expect((await readFile(file)).equals(bytes), name).toBe(true);
        expect(written.revision).toBe(document.revision);
        expect((await stat(file)).mtimeMs).toBe(before);
      }
      expect(noteEdited).not.toHaveBeenCalled();
    });

    it(`saves a one-character edit as one changed character (${variant})`, async () => {
      for (const name of await fixtureNames()) {
        const bytes = encode(await readFile(path.join(FIXTURES, name), 'utf8'));
        const { file, document, state } = await open(bytes, name);
        // Type one character at the start of a middle line, as the keyboard would.
        const at = state.doc.line(Math.ceil(state.doc.lines / 2)).from;
        const edited = state.update({ changes: { from: at, insert: 'x' }, userEvent: 'input.type' }).state;
        if (isLogPage(file)) {
          // A log page is read-only, so the typed character never reaches the text.
          expect(edited.doc.toString(), name).toBe(document.body);
          continue;
        }
        await service.write(file, edited.doc.toString(), document.revision);
        const after = await readFile(file);
        expect(after.length, name).toBe(bytes.length + 1);
        let first = 0;
        while (after[first] === bytes[first]) first += 1;
        expect(after[first], name).toBe('x'.charCodeAt(0));
        expect(Buffer.concat([after.subarray(0, first), after.subarray(first + 1)]).equals(bytes), name).toBe(true);
      }
    });
  }

  it('writes a new line break in the newline of the file and keeps the rest of a mixed file', async () => {
    const bytes = Buffer.from('a\r\nb\nc\r\n');
    const { file, document } = await open(bytes, 'mixed.md');
    expect(document.body).toBe('a\nb\nc\n');
    await service.write(file, 'a\nB\n\nc\n', document.revision);
    expect((await readFile(file)).toString()).toBe('a\r\nB\r\n\nc\r\n');
  });
});
