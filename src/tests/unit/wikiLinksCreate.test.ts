import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { resolveLinkTarget } from '@/main/fs/LinkIndex';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
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
