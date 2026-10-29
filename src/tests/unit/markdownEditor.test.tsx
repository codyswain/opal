import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { openTabs, openedPath, tabPaths } from '@/tests/helpers/tabs';

const NOTE = '/Vault/Notes/brief.md';
const LOG = '/Vault/Inbox/Logs/2026-10-28.md';

let changed: ((payload: { directories: string[] }) => void) | null = null;

beforeEach(() => {
  changed = null;
  installDiskApi({
    onChanged: vi.fn((callback: (payload: { directories: string[] }) => void) => { changed = callback; return () => { changed = null; }; }),
  });
  useDiskStore.setState({ listings: {}, pendingAction: null });
  openTabs([NOTE]);
});

async function openEditor(path: string): Promise<EditorView> {
  render(<MarkdownEditor path={path} />);
  const content = await screen.findByTestId('markdown-editor');
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error('No editor view');
  return view;
}

// CodeMirror reads Mod as Cmd on macOS and Ctrl elsewhere, from the platform it sees.
const MOD: KeyboardEventInit = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

const press = (view: EditorView, key: string, init: KeyboardEventInit = {}) =>
  act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...init }), 'editor'); });

describe('MarkdownEditor', () => {
  it('opens a note at the top without focus, shows its text and word count, and reports unavailable files', async () => {
    installMarkdownApi({ [NOTE]: '# Brief\n\nHello there.\n' });
    const view = await openEditor(NOTE);
    expect(view.state.doc.toString()).toBe('# Brief\n\nHello there.\n');
    expect(view.state.selection.main.head).toBe(0);
    expect(view.hasFocus).toBe(false);
    expect(view.contentDOM).toHaveAttribute('spellcheck', 'false');
    expect(screen.getByTestId('editor-save-state')).toHaveAttribute('data-state', 'clean');
    expect(screen.getByText('3 words')).toBeInTheDocument();
    render(<MarkdownEditor path="/Vault/photo.jpg" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only Markdown/);
  });

  it('gives an empty note the caret', async () => {
    installMarkdownApi({ [NOTE]: '' });
    const view = await openEditor(NOTE);
    expect(view.hasFocus).toBe(true);
  });

  it('writes nothing for a page that was opened, focused, blurred and closed', async () => {
    const api = installMarkdownApi({ [NOTE]: '# Brief\r\n\r\nNo trailing newline  ' });
    const { unmount } = render(<MarkdownEditor path={NOTE} />);
    const view = EditorView.findFromDOM(await screen.findByTestId('markdown-editor')) as EditorView;
    act(() => { view.focus(); view.contentDOM.blur(); });
    unmount();
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(1));
    expect(api.write).not.toHaveBeenCalled();
  });

  it('saves a one-character edit as exactly that edit, on Cmd+S', async () => {
    const api = installMarkdownApi({ [NOTE]: '# Brief\n\nHello there.\n' });
    const view = await openEditor(NOTE);
    act(() => { view.dispatch({ changes: { from: 14, insert: '!' }, userEvent: 'input.type' }); });
    expect(screen.getByTestId('editor-save-state')).toHaveAttribute('data-state', 'dirty');
    press(view, 's', MOD);
    await waitFor(() => expect(api.write).toHaveBeenCalledWith(NOTE, '# Brief\n\nHello! there.\n', `rev-${NOTE}-1`));
    await waitFor(() => expect(screen.getByTestId('editor-save-state')).toHaveAttribute('data-state', 'saved'));
  });

  it('continues lists on Enter, indents with Tab, toggles bold and opens search with Cmd+F', async () => {
    installMarkdownApi({ [NOTE]: '- one' });
    const view = await openEditor(NOTE);
    act(() => { view.dispatch({ selection: { anchor: 5 } }); });
    press(view, 'Enter');
    expect(view.state.doc.toString()).toBe('- one\n- ');
    press(view, 'Tab');
    expect(view.state.doc.toString()).toBe('- one\n  - ');
    press(view, 'Tab', { shiftKey: true });
    expect(view.state.doc.toString()).toBe('- one\n- ');
    act(() => { view.dispatch({ changes: { from: 8, insert: 'two' }, selection: { anchor: 8, head: 11 } }); });
    press(view, 'b', MOD);
    expect(view.state.doc.toString()).toBe('- one\n- **two**');
    press(view, 'f', MOD);
    expect(view.dom.querySelector('.cm-search')).not.toBeNull();
  });

  it('leaves Cmd+[ and Cmd+] to the app menu, where they are Back and Forward', async () => {
    installMarkdownApi({ [NOTE]: '  - one' });
    const view = await openEditor(NOTE);
    for (const key of ['[', ']']) {
      expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...MOD }), 'editor')).toBe(false);
    }
    expect(view.state.doc.toString()).toBe('  - one');
  });

  it('keeps the Activity Log of a daily log read-only and muted, and still follows the hook appending to it', async () => {
    const api = installMarkdownApi({ [LOG]: '## Morning\nPlan\n\n---\n## Activity Log\n- 09:00 Did a thing\n' });
    const view = await openEditor(LOG);
    const heading = view.state.doc.toString().indexOf('## Activity Log');
    const tryEdit = (changes: { from: number; to?: number; insert?: string }) => act(() => { view.dispatch({ changes, userEvent: 'input.type' }); });
    tryEdit({ from: heading + 3, insert: 'x' });
    tryEdit({ from: heading });
    tryEdit({ from: heading - 1, to: heading });
    tryEdit({ from: view.state.doc.length, insert: 'tail' });
    expect(view.state.doc.toString()).toBe('## Morning\nPlan\n\n---\n## Activity Log\n- 09:00 Did a thing\n');
    tryEdit({ from: 15, insert: ' ahead' });
    expect(view.state.doc.toString()).toContain('Plan ahead\n');
    expect(view.dom.querySelector('.cm-activity-log')).not.toBeNull();
    // The hook appends while the page has an unsaved edit above; both survive.
    api.externalEdit(LOG, '## Morning\nPlan\n\n---\n## Activity Log\n- 09:00 Did a thing\n- 09:05 Did another\n');
    act(() => { changed?.({ directories: ['/Vault/Inbox/Logs'] }); });
    await waitFor(() => expect(view.state.doc.toString()).toContain('- 09:05 Did another\n'));
    expect(view.state.doc.toString()).toContain('Plan ahead\n');
    const muted = [...view.dom.querySelectorAll('.cm-activity-log')].map((element) => element.textContent).join('\n');
    expect(muted).toContain('09:05 Did another');
    await waitFor(() => expect(api.documents.get(LOG)?.body).toBe('## Morning\nPlan ahead\n\n---\n## Activity Log\n- 09:00 Did a thing\n- 09:05 Did another\n'));
  });

  it('follows an external change while clean, keeping the cursor and writing nothing', async () => {
    const api = installMarkdownApi({ [NOTE]: 'First line.\nSecond line.\n' });
    const view = await openEditor(NOTE);
    act(() => { view.dispatch({ selection: { anchor: 15 } }); });
    api.externalEdit(NOTE, 'Inserted above.\nFirst line.\nSecond line.\nAppended.\n');
    act(() => { changed?.({ directories: ['/Vault/Notes'] }); });
    await waitFor(() => expect(view.state.doc.toString()).toBe('Inserted above.\nFirst line.\nSecond line.\nAppended.\n'));
    expect(view.state.sliceDoc(view.state.selection.main.head, view.state.selection.main.head + 9)).toBe('ond line.');
    expect(screen.getByTestId('editor-save-state')).toHaveAttribute('data-state', 'clean');
    expect(api.write).not.toHaveBeenCalled();
  });

  it('opens a followed wiki link in the same tab', async () => {
    const OTHER = '/Vault/Notes/Other.md';
    installMarkdownApi({ [NOTE]: 'See [[Other]].\n', [OTHER]: '' });
    const view = await openEditor(NOTE);
    const link = await waitFor(() => view.contentDOM.querySelector('.cm-md-wikilink') as Element);
    act(() => { link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    await waitFor(() => expect(openedPath()).toBe(OTHER));
    expect(tabPaths()).toEqual([OTHER]);
  });

  it('shows both sides of a conflicting change and saves the one picked', async () => {
    const api = installMarkdownApi({ [NOTE]: 'Title\nShared line\nEnd\n' });
    const view = await openEditor(NOTE);
    act(() => { view.dispatch({ changes: { from: 6, to: 17, insert: 'My line' }, userEvent: 'input.type' }); });
    api.externalEdit(NOTE, 'Title\nTheir line\nEnd\nAppended by them\n');
    act(() => { changed?.({ directories: ['/Vault/Notes'] }); });
    await screen.findByTestId('editor-conflict');
    // The page keeps its side and the clean append; the disk's side is shown above it.
    expect(view.state.doc.toString()).toBe('Title\nMy line\nEnd\nAppended by them\n');
    expect(view.dom.querySelector('.cm-deletedChunk')).toHaveTextContent('Their line');
    act(() => { view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' }); });
    expect(api.write).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId('editor-conflict')).getByRole('button', { name: 'Keep disk version' }));
    await waitFor(() => expect(api.documents.get(NOTE)?.body).toBe('Title\nTheir line\nEnd\nAppended by them\n'));
    expect(view.state.doc.toString()).toBe('Title\nTheir line\nEnd\nAppended by them\n');
    expect(screen.queryByTestId('editor-conflict')).toBeNull();
  });
});
