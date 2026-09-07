import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, useMarkdownDocument } from '@/renderer/features/disk-explorer/components/editor/useMarkdownDocument';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const NOTE = '/Vault/Notes/brief.md';

let changed: ((payload: { directories: string[] }) => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  changed = null;
  installDiskApi({
    onChanged: vi.fn((callback: (payload: { directories: string[] }) => void) => { changed = callback; return () => { changed = null; }; }),
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('useMarkdownDocument', () => {
  it('loads once and never writes a clean document', async () => {
    const api = installMarkdownApi({ [NOTE]: '# Brief\n' });
    const { result, unmount } = renderHook(() => useMarkdownDocument(NOTE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ body: '# Brief\n', saveState: 'clean', seed: 1 });
    await act(async () => { await result.current.flush(); });
    unmount();
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2); });
    expect(api.write).not.toHaveBeenCalled();
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it('debounces edits into one write against the loaded revision and reports saved', async () => {
    const api = installMarkdownApi({ [NOTE]: '# Brief\n' });
    const { result } = renderHook(() => useMarkdownDocument(NOTE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { result.current.onChange('# Brief\n\nOne'); });
    act(() => { result.current.onChange('# Brief\n\nOne two'); });
    expect(result.current.saveState).toBe('dirty');
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10); });
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(api.write).toHaveBeenCalledWith(NOTE, '# Brief\n\nOne two', `rev-${NOTE}-1`);
    // The next edit saves against the new revision.
    act(() => { result.current.onChange('# Brief\n\nOne two three'); });
    await act(async () => { await result.current.flush(); });
    expect(api.write).toHaveBeenLastCalledWith(NOTE, '# Brief\n\nOne two three', 'rev-2');
    expect(result.current.saveState).toBe('saved');
  });

  it('keeps typing that landed during a write and saves it next', async () => {
    let resolveWrite!: (value: unknown) => void;
    const api = installMarkdownApi({ [NOTE]: 'a' });
    const original = api.write;
    (api.write as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => { resolveWrite = resolve; }));
    const { result } = renderHook(() => useMarkdownDocument(NOTE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { result.current.onChange('ab'); });
    const pending = act(async () => { await result.current.flush(); });
    act(() => { result.current.onChange('abc'); });
    const current = api.documents.get(NOTE)?.revision;
    resolveWrite({ success: true, data: { revision: current } });
    await pending;
    expect(result.current.saveState).toBe('dirty');
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10); });
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    expect(original).toHaveBeenLastCalledWith(NOTE, 'abc', current);
  });

  it('turns an external edit into a conflict with both recoveries', async () => {
    const api = installMarkdownApi({ [NOTE]: '# Brief\n' });
    const { result } = renderHook(() => useMarkdownDocument(NOTE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    api.externalEdit(NOTE, '# Elsewhere\n');
    act(() => { result.current.onChange('# Mine\n'); });
    await act(async () => { await result.current.flush(); });
    expect(result.current.saveState).toBe('conflict');
    expect(api.documents.get(NOTE)?.body).toBe('# Elsewhere\n');
    // Reload takes the disk version and re-seeds the editor.
    await act(async () => { await result.current.reloadFromDisk(); });
    expect(result.current).toMatchObject({ body: '# Elsewhere\n', saveState: 'clean', seed: 2 });
    // Keep mine overwrites against the fresh revision.
    api.externalEdit(NOTE, '# Elsewhere again\n');
    act(() => { result.current.onChange('# Mine again\n'); });
    await act(async () => { await result.current.flush(); });
    expect(result.current.saveState).toBe('conflict');
    await act(async () => { await result.current.keepMine(); });
    expect(result.current.saveState).toBe('saved');
    expect(api.documents.get(NOTE)?.body).toBe('# Mine again\n');
  });

  it('follows an external change silently while clean and reports other write failures', async () => {
    const api = installMarkdownApi({ [NOTE]: '# Brief\n' });
    const { result } = renderHook(() => useMarkdownDocument(NOTE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    api.externalEdit(NOTE, '# From disk\n');
    act(() => { changed?.({ directories: ['/Vault/Notes'] }); });
    await waitFor(() => expect(result.current.body).toBe('# From disk\n'));
    expect(result.current.seed).toBe(2);
    (api.write as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, error: 'Disk full' });
    act(() => { result.current.onChange('# Changed\n'); });
    await act(async () => { await result.current.flush(); });
    expect(result.current).toMatchObject({ saveState: 'error', error: 'Disk full' });
    await act(async () => { await result.current.flush(); });
    expect(result.current.saveState).toBe('saved');
  });

  it('writes pending text when the file is left', async () => {
    const api = installMarkdownApi({ [NOTE]: 'a' });
    const { result, unmount } = renderHook(() => useMarkdownDocument(NOTE));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { result.current.onChange('ab'); });
    unmount();
    expect(api.write).toHaveBeenCalledWith(NOTE, 'ab', `rev-${NOTE}-1`);
  });

  it('reports a file that cannot be opened', async () => {
    installMarkdownApi({});
    const { result } = renderHook(() => useMarkdownDocument(NOTE));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.error).toMatch(/Only Markdown/);
  });
});
