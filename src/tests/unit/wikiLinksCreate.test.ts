import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { resolveLinkTarget } from '@/main/fs/LinkIndex';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { objectAt, objectKinds } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { noteToCreate, openWikiLink, parseWikiTarget, wikiDisplay } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installFilesApi } from '@/tests/helpers/filesApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));

const DOC = '/Vault/Notes/Page.mdo';
let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installFilesApi();
  toastError.mockClear();
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string, page = DOC, openNote = vi.fn()) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page, openNote) }) });
  view.focus = vi.fn();
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const key = (view: EditorView, name: string) => act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: name }), 'editor'); });

describe('following a link to nothing', () => {
  it('offers a note for names with dots, a document for .mdo, and nothing for a file type', () => {
    expect(noteToCreate('v0.2')).toEqual({ name: 'v0.2', extension: 'md' });
    expect(noteToCreate('Meeting 10.30')).toEqual({ name: 'Meeting 10.30', extension: 'md' });
    expect(noteToCreate('Plan.mdo')).toEqual({ name: 'Plan', extension: 'mdo' });
    for (const target of ['deck.pptx', 'Library/files/model.stl', 'a.zip', 'x.excalidraw', 'board.canvas', 'shot.png', 'report.pdf']) {
      expect(noteToCreate(target)).toBeNull();
    }
  });

  it('creates v0.2.md and Plan.mdo, and says it could not find deck.pptx without creating anything', async () => {
    const api = installMarkdownApi({ [DOC]: '' });
    const openNote = vi.fn();
    const view = mount('', DOC, openNote);
    await openWikiLink(view, 'v0.2');
    expect(api.create).toHaveBeenLastCalledWith('/Vault', 'v0.2', 'md');
    await openWikiLink(view, 'Plan.mdo');
    expect(api.create).toHaveBeenLastCalledWith('/Vault', 'Plan', 'mdo');
    vi.mocked(api.create).mockClear();
    await openWikiLink(view, 'Library/files/2026-11/deck.pptx');
    expect(api.create).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Could not find Library/files/2026-11/deck.pptx.');
  });

  it('makes a missing day page through Daily, as a document from the template, and never a second file for a date', async () => {
    const LOG = '/Vault/Library/logs/2026-11-05 log.md';
    const api = installMarkdownApi({ [LOG]: '', '/Vault/Library/daily/2026-11-04.mdo': '' });
    const createDay = vi.fn(async (_root: string, date: string) => ({ success: true as const, data: { path: `/Vault/Library/daily/${date}.mdo` } }));
    (window as unknown as { vaultAPI: unknown }).vaultAPI = { createDay };
    const openNote = vi.fn();
    const view = mount('', LOG, openNote);
    // A log's `daily: "[[Library/daily/<date>]]"`, written before the day's page exists.
    await openWikiLink(view, 'Library/daily/2026-11-05');
    expect(createDay).toHaveBeenLastCalledWith('/Vault', '2026-11-05');
    expect(openNote).toHaveBeenLastCalledWith('/Vault/Library/daily/2026-11-05.mdo', false);
    await openWikiLink(view, 'Library/daily/2026-11-06.md');
    expect(createDay).toHaveBeenLastCalledWith('/Vault', '2026-11-06');
    await openWikiLink(view, 'Library/daily/2026-11-07.mdo');
    expect(createDay).toHaveBeenLastCalledWith('/Vault', '2026-11-07');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('resolves NFD and NFC spellings of a target to the same file', () => {
    const files = ['/Vault/People/Renée.md'];
    const nfd = 'Renée';
    expect(resolveLinkTarget(nfd, '/Vault/Notes/a.md', files)).toBe(files[0]);
    expect(resolveLinkTarget(nfd.normalize('NFC'), '/Vault/Notes/a.md', files)).toBe(files[0]);
    expect(resolveLinkTarget('Renée', '/Vault/Notes/a.md', ['/Vault/People/Renée.md'])).toBe('/Vault/People/Renée.md');
  });
});

describe('wiki links to notes', () => {
  it('read as the note\'s name, with a heading after ›, and a heading on this page alone', () => {
    expect(wikiDisplay(parseWikiTarget('Library/x/Plan.mdo'))).toBe('Plan');
    expect(wikiDisplay(parseWikiTarget('Plan#Goals'))).toBe('Plan › Goals');
    expect(wikiDisplay(parseWikiTarget('#Goals'))).toBe('Goals');
  });

  it('draw by name in a document, without the path or extension', async () => {
    installMarkdownApi({ [DOC]: '' });
    const view = mount('See [[Library/x/Plan.mdo]] and [[Plan#Goals]].\n');
    await waitFor(() => expect(view.contentDOM.querySelectorAll('[data-wiki-name]')).toHaveLength(2));
    expect(view.contentDOM.querySelector('.cm-line')?.textContent).toBe('See Plan and Plan › Goals.');
  });

  it('scroll to a heading on this page when followed', async () => {
    installMarkdownApi({ [DOC]: '' });
    const view = mount('See [[#Next steps]].\n\n## Goals\n\n## Next  Steps\n');
    await openWikiLink(view, '#Next steps');
    // A document's caret rests after the hidden "## ".
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('## Next  Steps');
    expect(view.contentDOM.querySelector('[data-wiki-name]')).toHaveAttribute('data-wiki-target', '#Next steps');
  });

  it('open another page at the heading a link names', async () => {
    installMarkdownApi({ [DOC]: '', '/Vault/Plan.md': '' }, {
      resolveLinks: vi.fn(async (_from: string, targets: string[]) => ({ success: true as const, data: Object.fromEntries(targets.map((target) => [target, target === 'Plan' ? '/Vault/Plan.md' : null])) })),
    });
    const openNote = vi.fn();
    const view = mount('See [[Plan#Goals]].\n', DOC, openNote);
    expect(view.contentDOM.querySelector('[data-wiki-name]')).toHaveAttribute('data-wiki-target', 'Plan#Goals');
    await openWikiLink(view, 'Plan#Goals', true);
    expect(openNote).toHaveBeenCalledWith('/Vault/Plan.md', true);
    const plan = mount('# Plan\n\nIntro\n\n## Goals\n\nShip it.\n', '/Vault/Plan.md');
    await waitFor(() => expect(plan.state.doc.lineAt(plan.state.selection.main.head).text).toBe('## Goals'));
  });

  it('keep the heading when opened from the bar', async () => {
    installMarkdownApi({ [DOC]: '', '/Vault/Plan.md': '' }, {
      resolveLinks: vi.fn(async (_from: string, targets: string[]) => ({ success: true as const, data: Object.fromEntries(targets.map((target) => [target, target === 'Plan' ? '/Vault/Plan.md' : null])) })),
    });
    const openNote = vi.fn();
    const doc = 'See [[#Goals]] and [[Plan#Goals]] below.\n\nFiller\n\n## Goals\n\nText\n';
    const view = mount(doc, DOC, openNote);
    const open = (at: number) => {
      const obj = objectAt(view.state, at, 1);
      const kind = view.state.facet(objectKinds).find((candidate) => candidate.kind === 'wikilink');
      if (obj) kind?.actions(view.state, obj).find((item) => item.id === 'open')?.run?.(view, obj);
    };
    await act(async () => { open(doc.indexOf('[[#Goals')); });
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('## Goals');
    await act(async () => { open(doc.indexOf('[[Plan')); });
    await waitFor(() => expect(openNote).toHaveBeenCalledWith('/Vault/Plan.md', true));
    const plan = mount('# Plan\n\nIntro\n\n## Goals\n\nShip it.\n', '/Vault/Plan.md');
    await waitFor(() => expect(plan.state.doc.lineAt(plan.state.selection.main.head).text).toBe('## Goals'));
  });

  it('go whole on one Backspace in a document, keep typing outside the brackets, and leave an alias editable', async () => {
    installMarkdownApi({ [DOC]: '' });
    const view = mount('See [[Plan]] now\n');
    act(() => { view.dispatch({ selection: { anchor: 12 } }); });
    key(view, 'Backspace');
    expect(text(view)).toBe('See  now\n');
    act(() => { undo(view); });
    expect(text(view)).toBe('See [[Plan]] now\n');
    act(() => { view.dispatch({ selection: { anchor: 12 } }); });
    act(() => { view.dispatch(view.state.replaceSelection('s')); });
    expect(text(view)).toBe('See [[Plan]]s now\n');

    const aliased = mount('See [[Plan|the plan]] now\n');
    act(() => { aliased.dispatch({ selection: { anchor: 19 } }); });
    key(aliased, 'Backspace');
    expect(text(aliased)).toBe('See [[Plan|the pla]] now\n');
  });
});
