import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import type { ObjectAction } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import {
  cardText,
  encodeAddress,
  escapeLinkText,
  fileActions,
  linkFor,
  previewText,
  refAt,
  setAskText,
  sizeText,
} from '@/renderer/features/disk-explorer/components/editor/fileActions';
import { clearFileInfo, readAddress } from '@/renderer/features/disk-explorer/components/editor/fileEmbeds';
import { linksResolved } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installFilesApi } from '@/tests/helpers/filesApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const DOC = '/Vault/Notes/Plan.mdo';
const PNG = 'Library/files/2026-11/shot.a3f9c2e1.png';
const PDF = 'Library/files/2026-11/report.a3f9c2e1.pdf';
const MP4 = 'Library/files/2026-11/clip.a3f9c2e1.mp4';
const M4A = 'Library/files/2026-11/memo.a3f9c2e1.m4a';
const PPTX = 'Library/files/2026-11/deck.a3f9c2e1.pptx';
const FILES = [PNG, PDF, MP4, M4A, PPTX];
const resolved = Object.fromEntries(FILES.map((target) => [target, `/Vault/${target}`]));

let views: EditorView[] = [];

beforeEach(() => {
  clearFileInfo();
  useDiskStore.setState({ roots: ['/Vault'] });
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '' }, {
    resolveLinks: vi.fn(async (_from: string, targets: string[]) => ({
      success: true as const,
      data: Object.fromEntries(targets.map((target) => [target, resolved[target] ?? null])),
    })),
  });
  // Pictures are 1600 by 1000 at 144 dpi, so 800 points wide; the video is 1280 by 720.
  installFilesApi({
    info: vi.fn(async (target: string) => {
      const name = target.slice(target.lastIndexOf('/') + 1);
      const size = name.endsWith('.png') ? { width: 1600, height: 1000, retina: true } : name.endsWith('.mp4') ? { width: 1280, height: 720 } : {};
      return { success: true as const, data: { path: target, name, size: 2_400_000, mtimeMs: 0, kind: 'other' as const, status: 'local' as const, ...size } };
    }),
    appName: vi.fn(async () => ({ success: true as const, data: 'Keynote' })),
  });
  toast.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  setAskText(null);
  vi.restoreAllMocks();
});

function mount(doc: string) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(DOC) }) });
  view.focus = vi.fn();
  views.push(view);
  act(() => { view.dispatch({ effects: linksResolved.of(resolved) }); });
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

/** The bar's action `path` ("show-as/card") for the file on the first line holding `needle`. */
function action(view: EditorView, needle: string, path: string): ObjectAction {
  const at = text(view).indexOf(needle);
  const line = view.state.doc.lineAt(at);
  const ref = refAt(view.state, { from: at, to: at });
  if (!ref) throw new Error(`no file at ${needle}`);
  const obj = { kind: ref.alone ? 'file' : 'file-inline', from: ref.alone ? line.from : ref.from, to: ref.alone ? line.to : ref.to, node: '' };
  let actions: readonly ObjectAction[] = fileActions(view.state, obj);
  let found: ObjectAction | undefined;
  for (const id of path.split('/')) {
    found = actions.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no action ${path}; have ${actions.map((candidate) => candidate.id).join(', ')}`);
    actions = found.items ?? [];
  }
  return found as ObjectAction;
}

async function run(view: EditorView, needle: string, path: string) {
  const found = action(view, needle, path);
  await act(async () => { found.run?.(view, { kind: 'file', from: 0, to: 0, node: '' }); });
  await flush();
}

/** Runs one bar action on a one-line page and gives the page after it, and after one undo. */
async function bytes(doc: string, path: string, needle = doc.trim().slice(0, 4)): Promise<[string, string]> {
  const view = mount(doc);
  await run(view, needle, path);
  const after = text(view);
  act(() => { undo(view); });
  return [after, text(view)];
}

describe('the bar', () => {
  it('leads with the main action for the type, then Show as, Size and More', () => {
    const view = mount(`![[${PDF}|Q3 report.pdf]]\n\n[[${PPTX}|Gob deck.pptx]]\n\n![[${PNG}|300]]\n`);
    const ids = (needle: string) => {
      const at = text(view).indexOf(needle);
      const line = view.state.doc.lineAt(at);
      return fileActions(view.state, { kind: 'file', from: line.from, to: line.to, node: '' }).map((item) => item.label);
    };
    // Until main names the app, a plain Open and no placeholder.
    expect(ids(PDF)).toEqual(['Open', 'Show as', 'Size', 'More']);
    // A deck draws as a card either way, so Show as is left out.
    expect(ids(PPTX)).toEqual(['Open', 'Edit link', 'More']);
    expect(ids(PNG)).toEqual(['Open', 'Show as', 'Size', 'More']);
    const more = action(view, PNG, 'more').items?.map((item) => item.label);
    expect(more).toEqual(['Quick Look', 'Reveal in Finder', 'Copy image', 'Copy file', 'Copy as Markdown', 'Copy path', 'Save a copy…', 'Replace…', 'Remove']);
    expect(action(view, PPTX, 'more').items?.map((item) => item.label)).toContain('Rename…');
  });

  it('names the app once main has said it, and never shows a placeholder for it', async () => {
    const view = mount(`![[${PDF}|Q3 report.pdf]]\n\n[[${PPTX}|Gob deck.pptx]]\n`);
    await flush();
    const labels = (needle: string) => {
      const line = view.state.doc.lineAt(text(view).indexOf(needle));
      return fileActions(view.state, { kind: 'file', from: line.from, to: line.to, node: '' }).map((item) => item.label);
    };
    expect(labels(PDF)).toEqual(['Open', 'Open in Keynote', 'Show as', 'Size', 'More']);
    expect(labels(PPTX)).toEqual(['Open in Keynote', 'Edit link', 'More']);
    expect(labels(PDF).join(' ')).not.toContain('Open in App');
  });

  it('opens a file outside the vault in its app after asking, never in a tab', async () => {
    const open = vi.fn(async () => ({ success: true as const, data: { action: 'confirm' as const, app: 'Preview' } }));
    installFilesApi({ open, info: vi.fn(async () => ({ success: false as const, error: 'outside' })), appName: vi.fn(async () => ({ success: true as const, data: 'Preview' })) });
    const doc = 'See [Outside report](file:///Users/alex/Downloads/outside%20report.pdf) for detail.\n';
    const view = mount(doc);
    const ref = refAt(view.state, { from: doc.indexOf('Outside'), to: doc.indexOf('Outside') });
    expect(ref).toMatchObject({ path: '/Users/alex/Downloads/outside report.pdf', kind: 'pdf', form: 'link' });
    fileActions(view.state, { kind: 'file-inline', from: ref?.from ?? 0, to: ref?.to ?? 0, node: '' });
    await flush();
    const actions = fileActions(view.state, { kind: 'file-inline', from: ref?.from ?? 0, to: ref?.to ?? 0, node: '' });
    expect(actions.map((item) => item.id)).not.toContain('open');
    expect(actions[0].label).toBe('Open in Preview');
    await act(async () => { actions[0].run?.(view, { kind: 'file-inline', from: 0, to: 0, node: '' }); });
    await flush();
    expect(open).toHaveBeenCalledWith('/Users/alex/Downloads/outside report.pdf', { confirmed: undefined });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('is outside the vault. Open it in Preview?'), expect.anything());
  });

  it('writes each Show as both ways in one undo step, never leaving a size as a name or an empty link', async () => {
    expect(await bytes(`![[${PNG}|300]]\n`, 'show-as/card')).toEqual([`[[${PNG}|shot.png]]\n`, `![[${PNG}|300]]\n`]);
    expect(await bytes(`[[${PNG}|shot.png]]\n`, 'show-as/preview')).toEqual([`![[${PNG}|700]]\n`, `[[${PNG}|shot.png]]\n`]);
    expect(await bytes(`![[${PDF}|Q3 report.pdf]]\n`, 'show-as/card')).toEqual([`[[${PDF}|Q3 report.pdf]]\n`, `![[${PDF}|Q3 report.pdf]]\n`]);
    expect(await bytes(`[[${PDF}|Q3 report.pdf]]\n`, 'show-as/preview')).toEqual([`![[${PDF}|Q3 report.pdf]]\n`, `[[${PDF}|Q3 report.pdf]]\n`]);
    expect(await bytes(`![[${MP4}|640]]\n`, 'show-as/card')).toEqual([`[[${MP4}|clip.mp4]]\n`, `![[${MP4}|640]]\n`]);
    expect(await bytes(`[[${MP4}|clip.mp4]]\n`, 'show-as/preview')).toEqual([`![[${MP4}|700]]\n`, `[[${MP4}|clip.mp4]]\n`]);
    expect(await bytes(`![[${M4A}]]\n`, 'show-as/card')).toEqual([`[[${M4A}|memo.m4a]]\n`, `![[${M4A}]]\n`]);
    expect(await bytes(`[[${M4A}|Memo]]\n`, 'show-as/preview')).toEqual([`![[${M4A}|Memo]]\n`, `[[${M4A}|Memo]]\n`]);
  });

  it('offers Show as only where Card and Preview look different', () => {
    const view = mount(`[[${PPTX}|Gob deck.pptx]]\n\n![[${PPTX}]]\n\nhttps://www.youtube.com/watch?v=abc\n\n![](https://www.youtube.com/watch?v=abc)\n`);
    for (const needle of [`[[${PPTX}`, `![[${PPTX}`, 'https://www.youtube.com/watch?v=abc\n', '![](https']) {
      const at = text(view).indexOf(needle);
      const line = view.state.doc.lineAt(at);
      expect(fileActions(view.state, { kind: 'file', from: line.from, to: line.to, node: '' }).map((item) => item.id)).not.toContain('show-as');
    }
  });

  it('drops a name that reads as a size when a link becomes a preview, and says so', async () => {
    expect(await bytes(`[[${PDF}|2026]]\n`, 'show-as/preview')).toEqual([`![[${PDF}]]\n`, `[[${PDF}|2026]]\n`]);
    expect(toast).toHaveBeenCalledWith('Dropped the name "2026", since an embed reads it as a size.');
  });

  it('turns an empty-alt video page embed into a link with its name', () => {
    const url = 'https://www.youtube.com/watch?v=abc';
    const view = mount(`![](${url})\n`);
    const ref = refAt(view.state, { from: 0, to: 0 });
    expect(ref && cardText(view.state, ref)).toBe(`[YouTube video](${url})`);
  });

  it('sizes pictures and video by width, and PDFs by #height', async () => {
    expect(await bytes(`![[${PNG}|300]]\n`, 'size/medium')).toEqual([`![[${PNG}|400]]\n`, `![[${PNG}|300]]\n`]);
    expect(await bytes(`![[${MP4}]]\n`, 'size/small')).toEqual([`![[${MP4}|240]]\n`, `![[${MP4}]]\n`]);
    expect(await bytes(`![[${PNG}|300]]\n`, 'size/full')).toEqual([`![[${PNG}|700]]\n`, `![[${PNG}|300]]\n`]);
    expect(await bytes(`![[${PDF}|Q3.pdf]]\n`, 'size/tall')).toEqual([`![[${PDF}#height=600|Q3.pdf]]\n`, `![[${PDF}|Q3.pdf]]\n`]);
    expect(await bytes(`![[${PDF}#page=3&height=240]]\n`, 'size/medium')).toEqual([`![[${PDF}#page=3&height=360]]\n`, `![[${PDF}#page=3&height=240]]\n`]);
    expect(await bytes('![Q3](report.pdf#page=2)\n', 'size/short')).toEqual(['![Q3](report.pdf#page=2&height=240)\n', '![Q3](report.pdf#page=2)\n']);
  });

  it('edits a caption, renames a shown name, and removes, each in one undo step', async () => {
    setAskText(async () => 'Night shift | rig 2');
    expect(await bytes('![Old|300](assets/a.png)\n', 'caption')).toEqual(['![Night shift | rig 2|300](assets/a.png)\n', '![Old|300](assets/a.png)\n']);
    setAskText(async () => 'Gob deck [final]');
    expect(await bytes(`[[${PPTX}|Gob deck.pptx]]\n`, 'more/rename')).toEqual([`[[${PPTX}|Gob deck final]]\n`, `[[${PPTX}|Gob deck.pptx]]\n`]);
    setAskText(async () => 'Notes * v2');
    expect(await bytes('[Old](assets/x.pptx)\n', 'more/rename')).toEqual(['[Notes \\* v2](assets/x.pptx)\n', '[Old](assets/x.pptx)\n']);
    expect(await bytes(`Intro\n\n[[${PPTX}]]\n\nAfter\n`, 'more/remove', '[[')).toEqual(['Intro\n\nAfter\n', `Intro\n\n[[${PPTX}]]\n\nAfter\n`]);
  });

  it('replaces the file, keeping its size or name', async () => {
    installFilesApi({
      pickAndImport: vi.fn(async () => ({ success: true as const, data: { files: [{ path: '/Vault/Library/files/2026-11/new.b1b2b3b4.png', vaultPath: 'Library/files/2026-11/new.b1b2b3b4.png', name: 'new.png' }], skipped: [] } })),
    });
    expect(await bytes(`![[${PNG}|300]]\n`, 'more/replace')).toEqual(['![[Library/files/2026-11/new.b1b2b3b4.png|300]]\n', `![[${PNG}|300]]\n`]);
  });

  it('opens Rename… once the More menu has closed and given focus back, and applies what is typed there', async () => {
    setAskText(null);
    const view = mount(`[[${PPTX}|Gob deck.pptx]]\n`);
    // The menu is open, with focus in it, when its item runs.
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.append(item);
    document.body.append(menu);
    item.focus();
    await act(async () => { action(view, PPTX, 'more/rename').run?.(view, { kind: 'file', from: 0, to: 0, node: '' }); });
    expect(document.querySelector('.opal-file-ask')).toBeNull();
    // Closing, the menu puts focus back in the text.
    menu.remove();
    view.contentDOM.focus();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.opal-file-ask input')));
    const input = document.activeElement as HTMLInputElement;
    input.value = 'Gob deck v2';
    await act(async () => { input.form?.requestSubmit(); });
    expect(text(view)).toBe(`[[${PPTX}|Gob deck v2]]\n`);
    expect(document.querySelector('.opal-file-ask')).toBeNull();
  });

  it('closes the Rename… field when the page scrolls, writing nothing', async () => {
    setAskText(null);
    const view = mount(`[[${PPTX}|Gob deck.pptx]]\n`);
    await act(async () => { action(view, PPTX, 'more/rename').run?.(view, { kind: 'file', from: 0, to: 0, node: '' }); });
    await waitFor(() => expect(document.querySelector('.opal-file-ask')).not.toBeNull());
    expect(document.body.hasAttribute('data-file-ask')).toBe(true);
    act(() => { view.scrollDOM.dispatchEvent(new Event('scroll')); });
    await waitFor(() => expect(document.querySelector('.opal-file-ask')).toBeNull());
    expect(document.body.hasAttribute('data-file-ask')).toBe(false);
    expect(text(view)).toBe(`[[${PPTX}|Gob deck.pptx]]\n`);
  });

  it('copies the Markdown, the path, the file and the image', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const view = mount(`![[${PNG}|300]]\n`);
    await run(view, '![[', 'more/copy-markdown');
    await run(view, '![[', 'more/copy-path');
    await run(view, '![[', 'more/copy-file');
    await run(view, '![[', 'more/copy-image');
    expect(writeText.mock.calls).toEqual([[`![[${PNG}|300]]`], [PNG]]);
    expect(window.filesAPI.copyFile).toHaveBeenCalledWith(`/Vault/${PNG}`);
    expect(window.filesAPI.copyImage).toHaveBeenCalledWith(`/Vault/${PNG}`);
    expect(text(view)).toBe(`![[${PNG}|300]]\n`);
  });
});

describe('writing links', () => {
  it('writes a wiki link for plain paths and a Markdown link for paths a wiki link can\'t hold', () => {
    expect(linkFor({ vaultPath: PDF, path: `/Vault/${PDF}`, page: DOC, embed: true, slot: 'Q3 report.pdf' })).toBe(`![[${PDF}|Q3 report.pdf]]`);
    expect(linkFor({ vaultPath: 'Docs/a#b|c.pdf', path: '/Vault/Docs/a#b|c.pdf', page: DOC, embed: false, slot: 'a#b|c.pdf' }))
      .toBe('[a#b|c.pdf](<../Docs/a%23b%7Cc.pdf>)');
    expect(linkFor({ vaultPath: 'Docs/[x]^1.pdf', path: '/Vault/Docs/[x]^1.pdf', page: DOC, embed: false, slot: '[x]^1.pdf', inTable: true }))
      .toBe('[\\[x\\]^1.pdf](<../Docs/[x]^1.pdf>)');
  });

  it('round-trips names with %, #, < and > through the address and back', () => {
    for (const name of ['50% off.pdf', 'a#b.pdf', 'x<y>.pdf', 'a|b.pdf', '%23 literal.pdf', '%7C literal.pdf', 'Rapport été.pdf']) {
      const written = encodeAddress(`Docs/${name}`);
      expect(readAddress(written, '/Vault/page.md').path).toBe(`/Vault/Docs/${name}`);
    }
  });

  it('reads a path with < or > back from what it writes, through the Markdown parser too', () => {
    const written = linkFor({ vaultPath: 'Docs/A #1 > B.pdf', path: '/Vault/Docs/A #1 > B.pdf', page: '/Vault/Notes/Plan.md', embed: false, slot: 'A #1 > B.pdf' });
    const state = EditorState.create({ doc: `${written}\n`, extensions: markdownEditorExtensions('/Vault/Notes/Plan.md') });
    expect(refAt(state, { from: 0, to: 0 })?.path).toBe('/Vault/Docs/A #1 > B.pdf');
  });

  it('reads a sized Markdown picture in a table cell without the backslash, and sizes it without splitting the row', () => {
    const doc = '| Shot | Note |\n| --- | --- |\n| ![a chart\\|300](shot.png) | x |\n';
    const state = EditorState.create({ doc, extensions: markdownEditorExtensions('/Vault/Notes/Plan.md') });
    const ref = refAt(state, { from: doc.indexOf('!['), to: doc.indexOf(') |') + 1 });
    expect(ref?.text).toBe('a chart');
    expect(ref && sizeText(state, ref, { width: 400 })).toBe('![a chart\\|400](shot.png)');
  });

  it('reads no file from a link to a heading on the page or to a folder, in a folder whose name has a dot', () => {
    const doc = 'See [Goals](#goals) and [v1](../v1.2/) below.\n';
    const state = EditorState.create({ doc, extensions: markdownEditorExtensions('/Vault/Library/bit-0.2/Plan.md') });
    expect(refAt(state, { from: 4, to: 19 })).toBeNull();
    expect(refAt(state, { from: doc.indexOf('[v1'), to: doc.indexOf(' below') })).toBeNull();
  });

  it('reads a link\'s address after its text, so a mail link whose text is an address is no file', () => {
    const doc = '[henry@parametric.company](mailto:henry@parametric.company) and [Q3](<../Docs/q3 report.pdf>)\n';
    const state = EditorState.create({ doc, extensions: markdownEditorExtensions('/Vault/Notes/Plan.md') });
    expect(refAt(state, { from: 0, to: 0 })).toBeNull();
    const at = doc.indexOf('[Q3');
    expect(refAt(state, { from: at, to: at })?.path).toBe('/Vault/Docs/q3 report.pdf');
  });

  it('escapes link text, with a pipe escaped only in a table', () => {
    expect(escapeLinkText('a*b_[c]|d')).toBe('a\\*b\\_\\[c\\]|d');
    expect(escapeLinkText('a|b', true)).toBe('a\\|b');
  });

  it('keeps a table cell\'s escaped pipe when writing Show as and Size', () => {
    const state = EditorState.create({ doc: `| a |\n|---|\n| ![[${PNG}\\|300]] |\n`, extensions: markdownEditorExtensions(DOC) }).update({ effects: linksResolved.of(resolved) }).state;
    const at = state.doc.toString().indexOf('![[');
    const ref = refAt(state, { from: at, to: at });
    expect(ref?.inTable).toBe(true);
    expect(ref && sizeText(state, ref, { width: 400 })).toBe(`![[${PNG}\\|400]]`);
    expect(ref && cardText(state, ref)).toBe(`[[${PNG}\\|shot.png]]`);
    expect(ref && previewText(state, ref, 400)?.text).toBe(`![[${PNG}\\|300]]`);
  });
});
