import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_MAX_WAIT_MS,
  GIT_HOLD_NOTICE_MS,
  GIT_HOLD_RETRY_MS,
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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
    expect(await act(() => flushPendingSaves())).toEqual([]);
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

  it('keeps the text in an unsaved copy when the last save fails as the page closes', async () => {
    const error = vi.spyOn(toast, 'error');
    const { api, editor, unmount } = await openDocument('# Brief\n');
    (api.write as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Permission denied' });
    editor.type('# Brief\n\nTyped before leaving.\n');
    unmount();
    expect(await act(() => flushPendingSaves())).toEqual([{ name: 'brief', copy: '/Vault/Notes/brief (unsaved copy).md' }]);
    expect(api.documents.get('/Vault/Notes/brief (unsaved copy).md')?.body).toBe('# Brief\n\nTyped before leaving.\n');
    expect(api.documents.get(NOTE)?.body).toBe('# Brief\n');
    expect(error).toHaveBeenCalledWith('Could not save brief. Your changes are in brief (unsaved copy).');
  });

  it('names a document without .mdo and keeps its unsaved copy a document', async () => {
    const error = vi.spyOn(toast, 'error');
    const plan = '/Vault/Notes/plan.mdo';
    const api = installMarkdownApi({ [plan]: '# Plan\n' });
    const { result, unmount } = renderHook(() => useMarkdownDocument(plan));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const editor = fakeEditor(result);
    (api.write as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Permission denied' });
    editor.type('# Plan\n\nTyped.\n');
    unmount();
    expect(await act(() => flushPendingSaves())).toEqual([{ name: 'plan', copy: '/Vault/Notes/plan (unsaved copy).mdo' }]);
    expect(error).toHaveBeenCalledWith('Could not save plan. Your changes are in plan (unsaved copy).');
  });

  it('reports an open page whose text reached no file to a quit, which asks before dropping it', async () => {
    const error = vi.spyOn(toast, 'error');
    const { api, result, editor } = await openDocument('# Brief\n');
    (api.write as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Permission denied' });
    (api.saveCopy as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Permission denied' });
    editor.type('# Brief, edited\n');
    expect(await act(() => flushPendingSaves())).toEqual([{ name: 'brief', copy: null }]);
    // The page is still open and says so itself; only a closed page toasts.
    expect(result.current).toMatchObject({ saveState: 'error', error: 'Permission denied' });
    expect(error).not.toHaveBeenCalled();
  });

  it('says so when a closed page with a conflict could not keep its side anywhere', async () => {
    const error = vi.spyOn(toast, 'error');
    const { api, result, editor, unmount } = await openDocument('Title\nShared\n');
    (api.saveCopy as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Permission denied' });
    editor.type('Title\nMine\n');
    api.externalEdit(NOTE, 'Title\nTheirs\n');
    diskChanged();
    await waitFor(() => expect(result.current.saveState).toBe('conflict'));
    unmount();
    expect(await act(() => flushPendingSaves())).toEqual([{ name: 'brief', copy: null }]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Could not save your version of brief or a copy of it. Your last changes are lost.');
  });

  it('flushes the open page when the window asks before closing or quitting', async () => {
    const { api, editor } = await openDocument('a');
    editor.type('a quick edit');
    // Quit lands inside the autosave delay.
    await act(async () => { await flushPendingSaves(); });
    expect(api.documents.get(NOTE)?.body).toBe('a quick edit');
  });

  describe('while git rewrites the repo', () => {
    // vault-pull.sh's `git merge --autostash`: git stashes the saved but
    // uncommitted line A, resets the file to HEAD, merges, then puts A back
    // with the same bytes, so the same revision.
    const SAVED = 'Top\n\nMiddle\n\nA\n';
    const HEAD = 'Top\n\nMiddle\n\n';
    const TYPED = 'Top\nB\n\nMiddle\n\nA\n';

    it('holds the save, keeps the page unsaved and checks every 250 ms, then saves over the lines git put back', async () => {
      const { api, result, editor } = await openDocument(SAVED);
      editor.type(TYPED);
      api.setGitBusy(true);
      api.externalEdit(NOTE, HEAD);
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10); });
      expect(api.write).toHaveBeenCalledTimes(1);
      expect(result.current.saveState).toBe('dirty');
      const reads = (api.read as ReturnType<typeof vi.fn>).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS * 4); });
      expect((api.read as ReturnType<typeof vi.fn>).mock.calls.length - reads).toBe(4);
      // Nothing merged or saved: the page still has A, and only git changed the file.
      expect(editor.text).toBe(TYPED);
      expect(result.current.saveState).toBe('dirty');
      expect(api.write).toHaveBeenCalledTimes(1);
      expect(api.documents.get(NOTE)?.body).toBe(HEAD);
      api.externalEdit(NOTE, SAVED, `rev-${NOTE}-1`);
      api.setGitBusy(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      await waitFor(() => expect(result.current.saveState).toBe('saved'));
      expect(api.write).toHaveBeenLastCalledWith(NOTE, TYPED, `rev-${NOTE}-1`);
      expect(api.documents.get(NOTE)?.body).toBe(TYPED);
    });

    it('leaves a clean page as it is until git is done, then follows the disk once', async () => {
      const { api, result, editor } = await openDocument(SAVED);
      api.setGitBusy(true);
      api.externalEdit(NOTE, HEAD);
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS * 3); });
      expect(editor.text).toBe(SAVED);
      api.externalEdit(NOTE, `${SAVED}Upstream\n`);
      api.setGitBusy(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      await waitFor(() => expect(editor.text).toBe(`${SAVED}Upstream\n`));
      expect(result.current.saveState).toBe('clean');
      expect(api.write).not.toHaveBeenCalled();
    });

    it('follows the disk once git is done when the page opened while git was busy', async () => {
      const api = installMarkdownApi({ [NOTE]: HEAD });
      api.setGitBusy(true);
      const { result } = renderHook(() => useMarkdownDocument(NOTE));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      const editor = fakeEditor(result);
      api.externalEdit(NOTE, SAVED);
      api.setGitBusy(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      await waitFor(() => expect(editor.text).toBe(SAVED));
      expect(api.write).not.toHaveBeenCalled();
    });

    it('waits for git before the last save of a closed page', async () => {
      const { api, editor, unmount } = await openDocument('a');
      api.setGitBusy(true);
      editor.type('ab');
      unmount();
      let settled = false;
      const flushing = flushPendingSaves().then((unsaved) => { settled = true; return unsaved; });
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS * 2); });
      expect(settled).toBe(false);
      api.setGitBusy(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      expect(await act(() => flushing)).toEqual([]);
      expect(api.documents.get(NOTE)?.body).toBe('ab');
      expect(api.saveCopy).not.toHaveBeenCalled();
    });

    it('keeps the text in an unsaved copy when git still holds a closing page after 1.5 s', async () => {
      const { api, editor, unmount } = await openDocument('a');
      api.setGitBusy(true);
      editor.type('ab');
      unmount();
      const flushing = flushPendingSaves();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(await act(() => flushing)).toEqual([{ name: 'brief', copy: '/Vault/Notes/brief (unsaved copy).md' }]);
      expect(api.documents.get(NOTE)?.body).toBe('a');
    });

    it('says the page is not saved once git has held it for 2 s, and saves when git is done', async () => {
      const { api, result, editor } = await openDocument(SAVED);
      api.setGitBusy(true);
      editor.type(TYPED);
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + GIT_HOLD_RETRY_MS * 4); });
      expect(result.current.saveState).toBe('dirty');
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_NOTICE_MS); });
      expect(result.current).toMatchObject({ saveState: 'error', error: 'Git is changing files in this folder. The page saves when git is done.' });
      api.setGitBusy(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      await waitFor(() => expect(result.current.saveState).toBe('saved'));
      expect(result.current.error).toBeNull();
      expect(api.documents.get(NOTE)?.body).toBe(TYPED);
    });

    // Git reads the files for its stash before it leaves MERGE_AUTOSTASH. A
    // write that lands in between is not in the stash: the reset takes its
    // line out, and the stash puts back the text from before it.
    const WRITTEN = 'Top\n\nMiddle\n\nA\ntok\n';

    it('keeps a line it wrote just before git started, when git takes it out and merges another change', async () => {
      const { api, result, editor } = await openDocument(SAVED);
      editor.type(WRITTEN);
      await act(async () => { await result.current.flush(); });
      expect(api.documents.get(NOTE)?.body).toBe(WRITTEN);
      api.setGitBusy(true);
      api.externalEdit(NOTE, HEAD);
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      expect(editor.text).toBe(WRITTEN);
      api.externalEdit(NOTE, 'Top!\n\nMiddle\n\nA\n');
      api.setGitBusy(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      await waitFor(() => expect(result.current.saveState).toBe('saved'));
      expect(api.documents.get(NOTE)?.body).toBe('Top!\n\nMiddle\n\nA\ntok\n');
      expect(editor.text).toBe('Top!\n\nMiddle\n\nA\ntok\n');
    });

    it('puts back a line it wrote just before git started, when git leaves the text from before it, with no conflict', async () => {
      const { api, result, editor } = await openDocument(SAVED);
      editor.type(WRITTEN);
      await act(async () => { await result.current.flush(); });
      api.setGitBusy(true);
      api.externalEdit(NOTE, HEAD);
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      api.externalEdit(NOTE, SAVED, `rev-${NOTE}-1`);
      api.setGitBusy(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS * 2); });
      await waitFor(() => expect(result.current.saveState).toBe('saved'));
      expect(result.current.conflict).toBeNull();
      expect(api.documents.get(NOTE)?.body).toBe(WRITTEN);
    });

    it('merges cleanly when the line it wrote just before git did survive', async () => {
      const { api, result, editor } = await openDocument(SAVED);
      editor.type(WRITTEN);
      await act(async () => { await result.current.flush(); });
      const writes = (api.write as ReturnType<typeof vi.fn>).mock.calls.length;
      api.setGitBusy(true);
      api.externalEdit(NOTE, HEAD);
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      api.externalEdit(NOTE, `Top!\n\nMiddle\n\nA\ntok\n`);
      api.setGitBusy(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      await waitFor(() => expect(editor.text).toBe('Top!\n\nMiddle\n\nA\ntok\n'));
      expect(result.current.saveState).toBe('clean');
      expect(result.current.conflict).toBeNull();
      expect((api.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(writes);
    });
  });

  describe('when a version the page had earlier comes back', () => {
    const OLD = 'Top\n\nMiddle\n\n';
    const SAVED = 'Top\n\nMiddle\n\nA\n';
    const TYPED = 'Top\nB\n\nMiddle\n\nA\n';

    /** Opens OLD, saves A, then types B: a merge of OLD with the page would drop A. */
    async function savedThenTyped() {
      const opened = await openDocument(OLD);
      opened.editor.type(SAVED);
      await act(async () => { await opened.result.current.flush(); });
      opened.editor.type(TYPED);
      return opened;
    }

    it('does not merge it, reads again in 250 ms, and shows it as a conflict when it stays', async () => {
      const { api, result, editor } = await savedThenTyped();
      api.externalEdit(NOTE, OLD, `rev-${NOTE}-1`);
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });
      expect(editor.text).toBe(TYPED);
      expect(result.current.saveState).toBe('conflict');
      expect(result.current.conflict).toEqual({ disk: OLD });
      expect(api.write).toHaveBeenCalledTimes(1);
      expect(api.documents.get(NOTE)?.body).toBe(OLD);
      // Keep mine puts the page's text back over the old version.
      act(() => { result.current.resolveConflict(); });
      await waitFor(() => expect(result.current.saveState).toBe('saved'));
      expect(api.documents.get(NOTE)?.body).toBe(TYPED);
    });

    it('carries on as usual when it is gone again by the second read', async () => {
      const { api, result } = await savedThenTyped();
      api.externalEdit(NOTE, OLD, `rev-${NOTE}-1`);
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS / 2); });
      api.externalEdit(NOTE, SAVED, 'rev-2');
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HOLD_RETRY_MS); });
      await waitFor(() => expect(result.current.saveState).toBe('saved'));
      expect(result.current.conflict).toBeNull();
      expect(api.documents.get(NOTE)?.body).toBe(TYPED);
    });

    it('shows it as a conflict on a clean page too, when it takes out lines the page saved', async () => {
      // The page's last write may be one git took out: its text is then only in the page.
      const { api, result, editor } = await savedThenTyped();
      editor.type(SAVED);
      expect(result.current.saveState).toBe('clean');
      api.externalEdit(NOTE, OLD, `rev-${NOTE}-1`);
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });
      expect(result.current.saveState).toBe('conflict');
      expect(result.current.conflict).toEqual({ disk: OLD });
    });

    it('follows it on a clean page when it only takes back a change the page followed', async () => {
      // The day sidebar ticks a digest item, then unticks it: the file goes back to the bytes it had.
      const UNTICKED = '# Digest\n\n- [ ] **Book flights**\n';
      const TICKED = '# Digest\n\n- [x] **Book flights**\n';
      const { api, result, editor } = await openDocument(UNTICKED);
      api.externalEdit(NOTE, TICKED);
      diskChanged();
      await waitFor(() => expect(editor.text).toBe(TICKED));
      api.externalEdit(NOTE, UNTICKED, `rev-${NOTE}-1`);
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });
      expect(editor.text).toBe(UNTICKED);
      expect(result.current).toMatchObject({ saveState: 'clean', conflict: null });
      expect(api.write).not.toHaveBeenCalled();
    });

    it('follows it after a save of its own, when the change it takes back came after that save', async () => {
      const { api, result, editor } = await openDocument(OLD);
      editor.type(SAVED);
      await act(async () => { await result.current.flush(); });
      api.externalEdit(NOTE, `${SAVED}- [x] ticked\n`);
      diskChanged();
      await waitFor(() => expect(editor.text).toBe(`${SAVED}- [x] ticked\n`));
      // Back to the bytes the page saved, under the revision its write returned.
      api.externalEdit(NOTE, SAVED, 'rev-2');
      diskChanged();
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });
      expect(editor.text).toBe(SAVED);
      expect(result.current).toMatchObject({ saveState: 'clean', conflict: null });
    });

    it('adopts it without a conflict when the page holds the same text', async () => {
      const { api, result, editor } = await savedThenTyped();
      editor.type(OLD);
      api.externalEdit(NOTE, OLD, `rev-${NOTE}-1`);
      diskChanged();
      await waitFor(() => expect(result.current.saveState).toBe('clean'));
      expect(result.current.conflict).toBeNull();
    });
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
