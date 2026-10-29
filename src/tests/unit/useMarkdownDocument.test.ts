import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_MAX_WAIT_MS,
  useMarkdownDocument,
  type MarkdownEditorHandle,
} from '@/renderer/features/disk-explorer/components/editor/useMarkdownDocument';
import { flushPendingSaves } from '@/renderer/features/disk-explorer/components/editor/pendingSaves';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const NOTE = '/Vault/Notes/brief.md';

let changed: ((payload: { directories: string[] }) => void) | null = null;
const diskChanged = () => act(() => { changed?.({ directories: ['/Vault/Notes'] }); });

/** Stands in for the CodeMirror view: holds text and reports typing through onChange. */
function fakeEditor(result: { current: ReturnType<typeof useMarkdownDocument> }) {
  let text = result.current.body ?? '';
  const handle: MarkdownEditorHandle = { getText: () => text, setText: vi.fn((next: string) => { text = next; }) };
  act(() => { result.current.attach(handle); });
  return {
    handle,
    get text() { return text; },
    type: (next: string) => act(() => { text = next; result.current.onChange(next); }),
  };
}

async function openDocument(body: string) {
  const api = installMarkdownApi({ [NOTE]: body });
  const hook = renderHook(() => useMarkdownDocument(NOTE));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return { api, ...hook, editor: fakeEditor(hook.result) };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  changed = null;
  installDiskApi({
    onChanged: vi.fn((callback: (payload: { directories: string[] }) => void) => { changed = callback; return () => { changed = null; }; }),
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('useMarkdownDocument', () => {
  it('loads once and never writes a clean document, even after an edit that was undone', async () => {
    const { api, result, unmount, editor } = await openDocument('# Brief\n');
    expect(result.current).toMatchObject({ body: '# Brief\n', saveState: 'clean', conflict: null });
    editor.type('# Brief!\n');
    editor.type('# Brief\n');
    expect(result.current.saveState).toBe('clean');
    await act(async () => { await result.current.flush(); });
    unmount();
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2); await flushPendingSaves(); });
    expect(api.write).not.toHaveBeenCalled();
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it('debounces edits into one write against the loaded revision and reports saved', async () => {
    const { api, result, editor } = await openDocument('# Brief\n');
    editor.type('# Brief\n\nOne');
    editor.type('# Brief\n\nOne two');
    expect(result.current.saveState).toBe('dirty');
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10); });
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(api.write).toHaveBeenCalledWith(NOTE, '# Brief\n\nOne two', `rev-${NOTE}-1`);
    // The next edit saves against the new revision.
    editor.type('# Brief\n\nOne two three');
    await act(async () => { await result.current.flush(); });
    expect(api.write).toHaveBeenLastCalledWith(NOTE, '# Brief\n\nOne two three', 'rev-2');
    expect(result.current.saveState).toBe('saved');
  });

  it('saves at least every five seconds while typing goes on', async () => {
    const { api, editor } = await openDocument('');
    let text = '';
    for (let elapsed = 0; elapsed < AUTOSAVE_MAX_WAIT_MS + 500; elapsed += 500) {
      text += 'a';
      editor.type(text);
      await act(async () => { vi.advanceTimersByTime(500); });
    }
    expect(api.write).toHaveBeenCalledTimes(1);
    expect((api.write as ReturnType<typeof vi.fn>).mock.calls[0][1].length).toBeGreaterThanOrEqual(10);
  });

  it('keeps typing that landed during a write and saves it next', async () => {
    let resolveWrite!: (value: unknown) => void;
    const { api, result, editor } = await openDocument('a');
    const original = api.write;
    (api.write as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => { resolveWrite = resolve; }));
    editor.type('ab');
    let flushing!: Promise<void>;
    act(() => { flushing = result.current.flush(); });
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1));
    editor.type('abc');
    api.documents.set(NOTE, { body: 'ab', revision: 'rev-written' });
    resolveWrite({ success: true, data: { revision: 'rev-written' } });
    await act(async () => { await flushing; });
    await waitFor(() => expect(original).toHaveBeenLastCalledWith(NOTE, 'abc', 'rev-written'));
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
  });

  it('applies an external change to a clean page through the editor and writes nothing', async () => {
    const { api, result, editor } = await openDocument('# Brief\n');
    api.externalEdit(NOTE, '# Brief\n\nAppended by an agent.\n');
    diskChanged();
    await waitFor(() => expect(editor.text).toBe('# Brief\n\nAppended by an agent.\n'));
    expect(result.current.saveState).toBe('clean');
    // The disk text is the new base: typing then saves against the disk revision.
    editor.type('# Brief!\n\nAppended by an agent.\n');
    await act(async () => { await result.current.flush(); });
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(api.write).toHaveBeenCalledWith(NOTE, '# Brief!\n\nAppended by an agent.\n', 'rev-external-2');
  });

  it('merges an external append into unsaved edits and saves both', async () => {
    const { api, result, editor } = await openDocument('# Brief\n\nFirst.\n');
    editor.type('# Brief\n\nFirst, edited.\n');
    api.externalEdit(NOTE, '# Brief\n\nFirst.\n\nAppended.\n');
    diskChanged();
    await waitFor(() => expect(api.documents.get(NOTE)?.body).toBe('# Brief\n\nFirst, edited.\n\nAppended.\n'));
    expect(editor.text).toBe('# Brief\n\nFirst, edited.\n\nAppended.\n');
    expect(api.write).toHaveBeenCalledWith(NOTE, '# Brief\n\nFirst, edited.\n\nAppended.\n', 'rev-external-2');
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
  });

  it('merges when a save finds the file changed without a disk event', async () => {
    const { api, result, editor } = await openDocument('one\ntwo\n');
    editor.type('one!\ntwo\n');
    api.externalEdit(NOTE, 'one\ntwo\nthree\n');
    await act(async () => { await result.current.flush(); });
    expect(api.documents.get(NOTE)?.body).toBe('one!\ntwo\nthree\n');
    expect(editor.text).toBe('one!\ntwo\nthree\n');
    expect(result.current.saveState).toBe('saved');
  });

  it('holds a real conflict with both sides until a pick, then saves over the disk version', async () => {
    const { api, result, editor } = await openDocument('Title\nShared\n');
    editor.type('Title\nMine\n');
    api.externalEdit(NOTE, 'Title\nTheirs\n');
    diskChanged();
    await waitFor(() => expect(result.current.saveState).toBe('conflict'));
    expect(result.current.conflict).toEqual({ disk: 'Title\nTheirs\n' });
    expect(editor.text).toBe('Title\nMine\n');
    // Nothing saves while the conflict is open, not even on flush.
    editor.type('Title\nMine, still typing\n');
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MAX_WAIT_MS); await result.current.flush(); });
    expect(api.write).not.toHaveBeenCalled();
    expect(api.documents.get(NOTE)?.body).toBe('Title\nTheirs\n');
    act(() => { result.current.resolveConflict(); });
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    expect(result.current.conflict).toBeNull();
    expect(api.write).toHaveBeenCalledWith(NOTE, 'Title\nMine, still typing\n', 'rev-external-2');
  });

  it('keeps both sides when the page closes with a conflict open', async () => {
    const { api, result, editor, unmount } = await openDocument('Title\nShared\n');
    editor.type('Title\nMine\n');
    api.externalEdit(NOTE, 'Title\nTheirs\n');
    diskChanged();
    await waitFor(() => expect(result.current.saveState).toBe('conflict'));
    unmount();
    await act(async () => { await flushPendingSaves(); });
    expect(api.documents.get(NOTE)?.body).toBe('Title\nTheirs\n');
    expect(api.documents.get('/Vault/Notes/brief (conflicted copy).md')?.body).toBe('Title\nMine\n');
  });

  it('writes pending text when the page is left, and a quit waits for it', async () => {
    const { api, editor, unmount } = await openDocument('a');
    editor.type('ab');
    unmount();
    await act(async () => { await flushPendingSaves(); });
    expect(api.write).toHaveBeenCalledWith(NOTE, 'ab', `rev-${NOTE}-1`);
    expect(api.documents.get(NOTE)?.body).toBe('ab');
  });

  it('flushes the open page when the window asks before closing or quitting', async () => {
    const { api, editor } = await openDocument('a');
    editor.type('a quick edit');
    // Quit lands inside the autosave delay.
    await act(async () => { await flushPendingSaves(); });
    expect(api.documents.get(NOTE)?.body).toBe('a quick edit');
  });

  it('reports a failed write, retries on flush, and reports a file that cannot be opened', async () => {
    const { api, result, editor } = await openDocument('# Brief\n');
    (api.write as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, error: 'Disk full' });
    editor.type('# Changed\n');
    await act(async () => { await result.current.flush(); });
    expect(result.current).toMatchObject({ saveState: 'error', error: 'Disk full' });
    await act(async () => { await result.current.flush(); });
    expect(result.current.saveState).toBe('saved');
    installMarkdownApi({});
    const missing = renderHook(() => useMarkdownDocument('/Vault/Notes/missing.md'));
    await waitFor(() => expect(missing.result.current.status).toBe('unavailable'));
    expect(missing.result.current.error).toMatch(/Only Markdown/);
  });
});
