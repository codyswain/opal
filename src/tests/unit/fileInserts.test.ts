import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { undo } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { dropAfter, placeEmbed } from '@/renderer/features/disk-explorer/components/editor/imageInsert';
import { embedWidth, imageSize } from '@/renderer/features/disk-explorer/components/editor/imageSize';
import { setActiveDragSourcePath, clearActiveDragSourcePath } from '@/renderer/features/disk-explorer/components/dragMoveState';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installFilesApi, storedFile } from '@/tests/helpers/filesApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import type { FilesResult, ImportedFile } from '@/types/files';

const toastError = vi.hoisted(() => vi.fn());
const toastPlain = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: Object.assign(toastPlain, { error: toastError }) }));

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';

const u16 = (value: number) => [value >> 8, value & 255];
const u32 = (value: number) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const codes = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** A PNG header: IHDR, a pHYs chunk at `ppm` pixels per meter when given, and empty image data. */
function png(width: number, height: number, ppm?: number): Uint8Array {
  const chunk = (type: string, data: number[]) => [...u32(data.length), ...codes(type), ...data, 0, 0, 0, 0];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...(ppm ? chunk('pHYs', [...u32(ppm), ...u32(ppm), 1]) : []),
    ...chunk('IDAT', []),
  ]);
}

/** A JPEG header: an EXIF block with `orientation` when given, then the frame header. */
function jpeg(width: number, height: number, orientation?: number): Uint8Array {
  const exif = orientation
    ? [0xff, 0xe1, ...u16(34), ...codes('Exif\0\0'), ...codes('MM'), 0, 42, ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)]
    : [];
  return new Uint8Array([0xff, 0xd8, ...exif, 0xff, 0xc0, ...u16(17), 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
}

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '' });
  // Reads every stored picture's size as 1600 by 1000 at 144 dpi, as files:info does from its first bytes.
  installFilesApi();
  toastError.mockClear();
  toastPlain.mockClear();
  // The page never fetches file bytes; this catches it if it does.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch is not allowed'); }));
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  clearActiveDragSourcePath();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(doc: string, page = DOC) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page) }) });
  // Real focus would let happy-dom fire selectionchange inside CodeMirror's own updates.
  view.focus = vi.fn();
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

const state = (doc: string) => EditorState.create({ doc, extensions: markdownEditorExtensions(DOC) });

function paste(view: EditorView, files: File[], plain = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: (type: string) => (type === 'text/plain' ? plain : '') } });
  act(() => { view.contentDOM.dispatchEvent(event); });
  return event;
}

function drag(view: EditorView, type: 'dragover' | 'drop' | 'dragleave', files: File[], init: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: files.length ? ['Files'] : ['text/plain'], getData: () => '', dropEffect: 'none' },
  });
  act(() => { view.contentDOM.dispatchEvent(event); });
  return event;
}

/** Puts the pointer over the block from `from` to `to`, drawn 40px tall from the document's top. */
function pointAt(view: EditorView, from: number, to: number) {
  vi.spyOn(view, 'lineBlockAtHeight').mockReturnValue({ from, to, top: 0, bottom: 40 } as ReturnType<EditorView['lineBlockAtHeight']>);
}

const shot = (name = 'Screen Shot.png', size = 1000) => new File([new Uint8Array(size)], name, { type: 'image/png' });

describe('reading a picture\'s size', () => {
  it('reads a PNG, and knows a Retina screenshot by its 144 dpi', () => {
    expect(imageSize(png(1094, 898, 5669))).toEqual({ width: 1094, height: 898, retina: true });
    expect(imageSize(png(2000, 1111, 2835))).toEqual({ width: 2000, height: 1111, retina: false });
    expect(imageSize(png(1024, 1024))).toEqual({ width: 1024, height: 1024, retina: false });
  });

  it('reads a JPEG as it shows, turned by its EXIF orientation, and a GIF', () => {
    expect(imageSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024, retina: false });
    expect(imageSize(jpeg(4032, 3024, 6))).toEqual({ width: 3024, height: 4032, retina: false });
    expect(imageSize(jpeg(4032, 3024, 3))).toEqual({ width: 4032, height: 3024, retina: false });
    expect(imageSize(new Uint8Array([...codes('GIF89a'), 0x40, 0x01, 0xf0, 0x00]))).toEqual({ width: 320, height: 240, retina: false });
  });

  it('reads nothing from other files or a header cut short', () => {
    expect(imageSize(new TextEncoder().encode('version https://git-lfs.github.com/spec/v1\n'))).toBeNull();
    expect(imageSize(png(10, 10).slice(0, 18))).toBeNull();
    expect(imageSize(jpeg(10, 10, 6).slice(0, 30))).toBeNull();
  });

  it('gives an embed a width within the column and one screen height, Retina pixels at half', () => {
    const room = { width: 700, height: 800 };
    expect(embedWidth({ width: 1094, height: 898, retina: true }, room)).toBe(547);
    expect(embedWidth({ width: 400, height: 300, retina: false }, room)).toBe(400);
    expect(embedWidth({ width: 4032, height: 3024, retina: false }, room)).toBe(700);
    // A portrait photo is held to the screen's height.
    expect(embedWidth({ width: 3024, height: 4032, retina: false }, room)).toBe(600);
    expect(embedWidth({ width: 3024, height: 4032, retina: false }, { width: 0, height: 0 })).toBe(3024);
  });
});

describe('where a file goes', () => {
  const place = (doc: string, at: number) => {
    const { from, insert } = placeEmbed(state(doc), at, '![[f.png]]');
    return doc.slice(0, from) + insert + doc.slice(from);
  };
  const rows = (doc: string) => {
    const parsed = state(doc);
    ensureSyntaxTree(parsed, parsed.doc.length, 5000);
    let count = 0;
    syntaxTree(parsed).iterate({ enter: (node) => { if (node.name === 'TableRow') count += 1; } });
    return count;
  };

  it('goes on a line of its own after the line, or takes an empty line', () => {
    expect(place('One line\nNext\n', 3)).toBe('One line\n![[f.png]]\nNext\n');
    expect(place('Above\n\nBelow\n', 6)).toBe('Above\n![[f.png]]\nBelow\n');
    // An empty line in a quote keeps a space after its mark.
    expect(place('> Quoted\n>\n> More\n', 9)).toBe('> Quoted\n> ![[f.png]]\n> More\n');
  });

  it('lines up under a list item\'s text and keeps a quote\'s or callout\'s marks', () => {
    expect(place('- item\n  - nested\n', 3)).toBe('- item\n  ![[f.png]]\n  - nested\n');
    expect(place('- [ ] task\n', 6)).toBe('- [ ] task\n  ![[f.png]]\n');
    expect(place('1. first\n', 4)).toBe('1. first\n   ![[f.png]]\n');
    expect(place('> [!note] Title\n> Body\n', 18)).toBe('> [!note] Title\n> Body\n> ![[f.png]]\n');
  });

  it('goes after a table, with a blank line, or after a code block', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter\n';
    expect(place(table, 2)).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n\n![[f.png]]\n\nAfter\n');
    // On the blank line under the table, the blank line stays, so the file and the text below are no rows.
    expect(place(table, table.indexOf('\n\n') + 1)).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n\n![[f.png]]\nAfter\n');
    expect(place('> | a |\n> | - |\n> | 1 |\n>\n', 24)).toBe('> | a |\n> | - |\n> | 1 |\n>\n> ![[f.png]]\n');
    expect(rows(place(table, table.indexOf('\n\n') + 1))).toBe(1);
    expect(place('> | a |\n> | - |\n> | 1 |\n', 2)).toBe('> | a |\n> | - |\n> | 1 |\n>\n> ![[f.png]]\n');
    expect(place('```\ncode\n```\nAfter\n', 5)).toBe('```\ncode\n```\n![[f.png]]\nAfter\n');
    // An indented code block's indent is not the embed's: it lines up with the list item holding the block, or the left edge.
    expect(place('Text\n\n    code line\n    more code\n\nAfter\n', 10)).toBe('Text\n\n    code line\n    more code\n![[f.png]]\n\nAfter\n');
    expect(place('- item\n\n      code\n      more\n', 15)).toBe('- item\n\n      code\n      more\n  ![[f.png]]\n');
    expect(place('> text\n>\n>     code\n', 13)).toBe('> text\n>\n>     code\n> ![[f.png]]\n');
  });

  it('drops after the nearer edge of the block under the pointer, past blank lines', () => {
    const doc = state('First\n\nSecond\n| a |\n| - |\n| 1 |\n');
    // Lower half of "Second": after it.
    expect(dropAfter(doc, { from: 7, to: 13, top: 0, bottom: 20 }, 15)).toBe(13);
    // Upper half of "Second": after "First", past the blank line.
    expect(dropAfter(doc, { from: 7, to: 13, top: 0, bottom: 20 }, 5)).toBe(5);
    // Upper half of the first line: after it, since nothing is above.
    expect(dropAfter(doc, { from: 0, to: 5, top: 0, bottom: 20 }, 5)).toBe(5);
    // A drawn table is one block.
    expect(dropAfter(doc, { from: 14, to: 31, top: 0, bottom: 60 }, 50)).toBe(31);
  });
});

describe('pasting files', () => {
  it('stores a pasted screenshot and puts it after the caret\'s line at half its pixel width, drawn at once', async () => {
    const view = mount('Notes here\nMore\n');
    act(() => { view.dispatch({ selection: { anchor: 3 } }); });
    const file = shot();
    const event = paste(view, [file]);
    expect(event.defaultPrevented).toBe(true);
    const embed = '![[Library/files/2026-11/screen-shot.a3f9c2e1.png|800]]';
    await waitFor(() => expect(text(view)).toBe(`Notes here\n${embed}\nMore\n`));
    expect(window.filesAPI.import).toHaveBeenCalledWith(DOC, file);
    expect(window.filesAPI.info).toHaveBeenCalledWith(storedFile('Screen Shot.png').path);
    expect(fetch).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(11 + embed.length);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-md-image img')).toHaveAttribute('src', toOpalFileUrl(storedFile('Screen Shot.png').path)));
    expect(window.markdownAPI.resolveLinks).not.toHaveBeenCalledWith(DOC, ['Library/files/2026-11/screen-shot.a3f9c2e1.png']);
  });

  it('holds a pasted picture\'s place at the size it will land at while it is stored', async () => {
    let finish: (value: FilesResult<ImportedFile>) => void = () => undefined;
    installFilesApi({ import: vi.fn(() => new Promise<FilesResult<ImportedFile>>((resolve) => { finish = resolve; })) });
    const view = mount('Notes here\n');
    act(() => { view.dispatch({ selection: { anchor: 3 } }); });
    // A Retina screenshot, 1094 by 898 pixels at 144 dpi: 547 points wide.
    paste(view, [new File([png(1094, 898, 5669)], 'Screen Shot.png', { type: 'image/png' })]);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-pending-box')).not.toBeNull());
    const box = view.contentDOM.querySelector('.cm-file-pending-box') as HTMLElement;
    expect([box.style.width, box.style.height]).toEqual(['547px', '449px']);
    expect(box).toHaveTextContent('Adding Screen Shot.png…');
    await act(async () => { finish({ success: true, data: storedFile('Screen Shot.png') }); });
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-pending-box')).toBeNull());
  });

  it('is its own undo step, apart from the words typed before it', async () => {
    const view = mount('', NOTE);
    act(() => { view.dispatch({ changes: { from: 0, insert: 'typed' }, selection: { anchor: 5 }, userEvent: 'input.type' }); });
    paste(view, [shot()]);
    await waitFor(() => expect(text(view)).toContain('![['));
    act(() => { undo(view); });
    expect(text(view)).toBe('typed');
  });

  it('pastes text as text when the clipboard also holds a picture of it', () => {
    const view = mount('Start\n');
    const event = paste(view, [shot('image.png')], 'Copied words');
    expect(window.filesAPI.import).not.toHaveBeenCalled();
    expect(text(view)).toContain('Copied words');
    expect(event.defaultPrevented).toBe(true);
  });

  it('stores a file copied in Finder, not its name, and puts a file that is no image in as a chip at a caret in text', async () => {
    installFilesApi({ hasPath: vi.fn(() => true) });
    const view = mount('Start\n', NOTE);
    const report = new File(['%PDF'], 'Q3 report.pdf', { type: 'application/pdf' });
    paste(view, [report], 'Q3 report.pdf');
    await waitFor(() => expect(text(view)).toBe('[[Library/files/2026-11/q3-report.a3f9c2e1.pdf|Q3 report.pdf]] Start\n'));
  });

  it('leaves a paste without files to CodeMirror', () => {
    const view = mount('Start\n');
    paste(view, [], 'plain');
    expect(text(view)).toContain('plain');
    expect(window.filesAPI.import).not.toHaveBeenCalled();
  });
});

describe('dropping files', () => {
  it('shows a line where the drop goes, and takes it away when the drag leaves', () => {
    const view = mount('First\nSecond\n');
    pointAt(view, 0, 5);
    const over = drag(view, 'dragover', [shot()], { clientY: 30 });
    expect(over.defaultPrevented).toBe(true);
    expect(view.contentDOM.querySelectorAll('.cm-md-drop-line')).toHaveLength(1);
    drag(view, 'dragleave', [shot()], { relatedTarget: document.body });
    expect(view.contentDOM.querySelector('.cm-md-drop-line')).toBeNull();
  });

  it('stores several files in the order dropped, skipping one that is too large with its reason', async () => {
    installFilesApi({
      import: vi.fn(async (_page: string, file: File) => (file.name === 'huge.mov'
        ? { success: false as const, error: '"huge.mov" is larger than 100 MB, so it was not added.' }
        : { success: true as const, data: storedFile(file.name) })),
    });
    const view = mount('First\nSecond\n');
    pointAt(view, 0, 5);
    const files = [shot('a.png'), new File(['x'], 'huge.mov'), new File(['x'], 'notes.txt')];
    const event = drag(view, 'drop', files, { clientY: 30 });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(text(view)).toBe('First\n![[Library/files/2026-11/a.a3f9c2e1.png|800]]\n[[Library/files/2026-11/notes.a3f9c2e1.txt|notes.txt]]\nSecond\n'));
    expect(toastError).toHaveBeenCalledWith('"huge.mov" is larger than 100 MB, so it was not added.');
    expect(view.contentDOM.querySelector('.cm-md-drop-line')).toBeNull();
  });

  it('keeps its place through edits made while the file is stored, and skips the insert once the page is gone', async () => {
    let finish: () => void = () => undefined;
    installFilesApi({
      import: vi.fn((_page: string, file: File) => new Promise<FilesResult<ImportedFile>>((resolve) => {
        finish = () => resolve({ success: true as const, data: storedFile(file.name) });
      })),
    });
    const view = mount('First\nSecond\n');
    pointAt(view, 7, 13);
    drag(view, 'drop', [shot('a.png')], { clientY: 30 });
    act(() => { view.dispatch({ changes: { from: 0, insert: 'Added above\n' } }); });
    await act(async () => { finish(); });
    await waitFor(() => expect(text(view)).toBe('Added above\nFirst\nSecond\n![[Library/files/2026-11/a.a3f9c2e1.png|800]]\n'));

    const closed = mount('First\n');
    pointAt(closed, 0, 5);
    drag(closed, 'drop', [shot('b.png')], { clientY: 30 });
    closed.destroy();
    await act(async () => { finish(); });
    expect(text(closed)).toBe('First\n');
  });

  it('goes after the line it was put on while typing carries on below it, and leaves the caret where the typing is', async () => {
    let finish: () => void = () => undefined;
    installFilesApi({
      import: vi.fn((_page: string, file: File) => new Promise<FilesResult<ImportedFile>>((resolve) => {
        finish = () => resolve({ success: true as const, data: storedFile(file.name) });
      })),
    });
    const view = mount('Intro line\n');
    act(() => { view.dispatch({ selection: { anchor: 10 } }); });
    paste(view, [shot('image.png')]);
    act(() => { view.dispatch({ changes: { from: 10, insert: '\n' }, selection: { anchor: 11 }, userEvent: 'input' }); });
    act(() => { view.dispatch({ changes: { from: 11, insert: 'Next thought' }, selection: { anchor: 23 }, userEvent: 'input.type' }); });
    await act(async () => { finish(); });
    await waitFor(() => expect(text(view)).toBe('Intro line\n![[Library/files/2026-11/image.a3f9c2e1.png|800]]\nNext thought\n'));
    expect(view.state.selection.main.head).toBe(text(view).length - 1);
  });

  it('links a dropped .webloc to its address, and says when a file linked in place is too large for GitHub', async () => {
    installFilesApi({
      import: vi.fn(async (_page: string, file: File) => (file.name.endsWith('.webloc')
        ? { success: true as const, data: { path: '', vaultPath: '', name: 'Opal [PR] *13*', url: 'https://github.com/codyswain/opal/pull/13' } }
        : { success: true as const, data: { path: '/Vault/Library/clip.mov', vaultPath: 'Library/clip.mov', name: 'clip.mov', warning: '"clip.mov" is larger than 100 MB and is not in Git LFS, so GitHub will refuse it.' } })),
    });
    const view = mount('Notes\n');
    pointAt(view, 0, 5);
    drag(view, 'drop', [new File(['x'], 'Opal PR.webloc'), new File(['x'], 'clip.mov')], { clientY: 30 });
    await waitFor(() => expect(text(view)).toBe('Notes\n[Opal \\[PR\\] \\*13\\*](https://github.com/codyswain/opal/pull/13)\n![[Library/clip.mov]]\n'));
    expect(toastPlain).toHaveBeenCalledWith('"clip.mov" is larger than 100 MB and is not in Git LFS, so GitHub will refuse it.');
  });

  it('links a row dragged from the tree by its path from the vault\'s top, and copies nothing', () => {
    useDiskStore.setState({
      roots: ['/Vault'],
      listings: { '/Vault/Library/people': [{ path: '/Vault/Library/people/Alec Chen.md', name: 'Alec Chen.md', isDirectory: false }] },
    } as unknown as Partial<ReturnType<typeof useDiskStore.getState>>);
    setActiveDragSourcePath('/Vault/Library/people/Alec Chen.md');
    const view = mount('- Met with\n');
    pointAt(view, 0, 10);
    drag(view, 'drop', [], { clientY: 30 });
    expect(text(view)).toBe('- Met with\n  [[Library/people/Alec Chen|Alec Chen]]\n');
    expect(window.filesAPI.import).not.toHaveBeenCalled();
  });

  it('leaves text dragged within the page to CodeMirror', () => {
    const view = mount('First\n');
    const event = drag(view, 'dragover', [], { clientY: 30 });
    expect(event.defaultPrevented).toBe(false);
    expect(view.contentDOM.querySelector('.cm-md-drop-line')).toBeNull();
  });
});
