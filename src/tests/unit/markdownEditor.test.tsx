import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { usePagePropertiesStore } from '@/renderer/features/disk-explorer/store/pagePropertiesStore';
import { formatFileSize, formatFileTime } from '@/renderer/features/disk-explorer/components/editor/pageProperties';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { openTabs, openedPath, tabPaths } from '@/tests/helpers/tabs';

const NOTE = '/Vault/Notes/brief.md';
const LOG_PAGE = '/Vault/Library/logs/2026-10-28 log.md';
const DAILY = '/Vault/Library/daily/2026-10-28.md';
/** A daily log from before the Library move; its Activity Log section stays read-only until the cleanup commit. */
const LEGACY_LOG = '/Vault/Inbox/Logs/2026-10-28.md';

let changed: ((payload: { directories: string[] }) => void) | null = null;

beforeEach(() => {
  changed = null;
  installDiskApi({
    onChanged: vi.fn((callback: (payload: { directories: string[] }) => void) => { changed = callback; return () => { changed = null; }; }),
  });
  useDiskStore.setState({ listings: {}, pendingAction: null });
  usePagePropertiesStore.setState({ open: false });
  openTabs([NOTE]);
});

const renderEditor = (path: string) => render(<MarkdownEditor path={path} />, { wrapper: TooltipProvider });

async function openEditor(path: string): Promise<EditorView> {
  renderEditor(path);
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
    renderEditor('/Vault/photo.jpg');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only Markdown/);
  });

  it('gives an empty note the caret', async () => {
    installMarkdownApi({ [NOTE]: '' });
    const view = await openEditor(NOTE);
    expect(view.hasFocus).toBe(true);
  });

  it('writes nothing for a page that was opened, focused, blurred and closed', async () => {
    const api = installMarkdownApi({ [NOTE]: '# Brief\r\n\r\nNo trailing newline  ' });
    const { unmount } = renderEditor(NOTE);
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

  it('bolds the text of whole selected lines and keeps their bullets, boxes, quotes and headings outside the marks', async () => {
    const text = '- first item\n- second item\n- [ ] a task\n\n> quoted\n## Head\n';
    installMarkdownApi({ [NOTE]: text });
    const view = await openEditor(NOTE);
    const bold = (anchor: number, head: number) => {
      act(() => { view.dispatch({ selection: { anchor, head } }); });
      press(view, 'b', MOD);
      return view.state.doc.toString();
    };
    const reset = () => act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); });
    // Shift+Cmd+Left from the end of the line selects back over the hidden "- ".
    expect(bold(12, 0)).toBe(text.replace('first item', '**first item**'));
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('first item');
    expect(view.state.selection.main.head).toBe(view.state.selection.main.from);
    // A second press with the line still selected takes the bold off.
    expect(bold(0, view.state.doc.line(1).to)).toBe(text);
    // A triple-click selects the line break too.
    expect(bold(0, 13)).toBe(text.replace('first item', '**first item**'));
    reset();
    expect(bold(0, view.state.doc.length)).toBe('- **first item**\n- **second item**\n- [ ] **a task**\n\n> **quoted**\n## **Head**\n');
    expect(bold(0, view.state.doc.length)).toBe(text);
    // With some lines bold already, the rest are bolded and none is unwrapped.
    bold(2, 12);
    expect(bold(0, view.state.doc.line(2).to)).toBe(text.replace('first item', '**first item**').replace('second item', '**second item**'));
    reset();
    act(() => { view.dispatch({ selection: { anchor: 0, head: 16 } }); });
    press(view, 'i', MOD);
    press(view, 'i', MOD);
    expect(view.state.doc.toString()).toBe(text);
    act(() => { view.dispatch({ changes: { from: 0, to: 12, insert: '- **bold**' }, selection: { anchor: 0, head: 10 } }); });
    press(view, 'i', MOD);
    expect(view.state.doc.line(1).text).toBe('- ***bold***');
  });

  it('leaves Cmd+[, Cmd+], Cmd+Shift+\\ and Cmd+Shift+I to the app menu: Back, Forward, the right sidebar and properties', async () => {
    installMarkdownApi({ [NOTE]: '  - one' });
    const view = await openEditor(NOTE);
    for (const key of ['[', ']']) {
      expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...MOD }), 'editor')).toBe(false);
    }
    expect(view.state.doc.toString()).toBe('  - one');
    // CodeMirror would jump to the matching bracket here.
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '(one)' }, selection: { anchor: 0 } }); });
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: '\\', shiftKey: true, ...MOD }), 'editor')).toBe(false);
    expect(view.state.selection.main.head).toBe(0);
    // Cmd+I is italic; with Shift it is View > Show Properties.
    act(() => { view.dispatch({ selection: { anchor: 1, head: 4 } }); });
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'I', shiftKey: true, ...MOD }), 'editor')).toBe(false);
    expect(view.state.doc.toString()).toBe('(one)');
  });

  it('leaves Cmd+Option+Down alone on a page, where it is not a key of the editor', async () => {
    installMarkdownApi({ [NOTE]: 'one\ntwo\n' });
    const view = await openEditor(NOTE);
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, ...MOD }), 'editor')).toBe(false);
    expect(view.state.selection.main.head).toBe(0);
  });

  it('keeps a whole log page read-only, and still follows the lines the scripts append', async () => {
    const text = '- 09:00 Ran the digest. · [[Library/digests/2026-10-28 digest|Digest]] · routine run\n';
    const api = installMarkdownApi({ [LOG_PAGE]: text });
    const view = await openEditor(LOG_PAGE);
    expect(view.state.readOnly).toBe(true);
    const tryEdit = (changes: { from: number; to?: number; insert?: string }) => act(() => { view.dispatch({ changes, userEvent: 'input.type' }); });
    tryEdit({ from: 0, insert: 'x' });
    tryEdit({ from: 5, to: 9 });
    tryEdit({ from: view.state.doc.length, insert: 'tail' });
    expect(view.state.doc.toString()).toBe(text);
    api.externalEdit(LOG_PAGE, `${text}- 09:05 Filed SW-640. · agent turn\n`);
    act(() => { changed?.({ directories: ['/Vault/Library/logs'] }); });
    await waitFor(() => expect(view.state.doc.toString()).toContain('- 09:05 Filed SW-640. · agent turn\n'));
    tryEdit({ from: 0, insert: 'x' });
    expect(view.state.doc.toString()).toBe(`${text}- 09:05 Filed SW-640. · agent turn\n`);
    expect(api.write).not.toHaveBeenCalled();
  });

  it('lets a daily page be edited everywhere, even below an Activity Log heading', async () => {
    const text = '## Morning\nPlan\n\n---\n## Activity Log\n- 09:00 Did a thing\n';
    const api = installMarkdownApi({ [DAILY]: text });
    const view = await openEditor(DAILY);
    expect(view.state.readOnly).toBe(false);
    act(() => { view.dispatch({ changes: { from: text.length, insert: 'More.\n' }, userEvent: 'input.type' }); });
    act(() => { view.dispatch({ changes: { from: text.indexOf('Did'), insert: 'Really ' }, userEvent: 'input.type' }); });
    expect(view.state.doc.toString()).toBe('## Morning\nPlan\n\n---\n## Activity Log\n- 09:00 Really Did a thing\nMore.\n');
    expect(view.dom.querySelector('.cm-activity-log')).toBeNull();
    await waitFor(() => expect(api.documents.get(DAILY)?.body).toBe('## Morning\nPlan\n\n---\n## Activity Log\n- 09:00 Really Did a thing\nMore.\n'));
  });

  it('keeps the Activity Log of an old Inbox/Logs page read-only and muted, and still follows the hook appending to it', async () => {
    const api = installMarkdownApi({ [LEGACY_LOG]: '## Morning\nPlan\n\n---\n## Activity Log\n- 09:00 Did a thing\n' });
    const view = await openEditor(LEGACY_LOG);
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
    api.externalEdit(LEGACY_LOG, '## Morning\nPlan\n\n---\n## Activity Log\n- 09:00 Did a thing\n- 09:05 Did another\n');
    act(() => { changed?.({ directories: ['/Vault/Inbox/Logs'] }); });
    await waitFor(() => expect(view.state.doc.toString()).toContain('- 09:05 Did another\n'));
    expect(view.state.doc.toString()).toContain('Plan ahead\n');
    const muted = [...view.dom.querySelectorAll('.cm-activity-log')].map((element) => element.textContent).join('\n');
    expect(muted).toContain('09:05 Did another');
    await waitFor(() => expect(api.documents.get(LEGACY_LOG)?.body).toBe('## Morning\nPlan ahead\n\n---\n## Activity Log\n- 09:00 Did a thing\n- 09:05 Did another\n'));
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

describe('the properties block', () => {
  const DAILY_TEXT = '';
  const FACTS = {
    properties: [
      { key: 'date', values: ['2026-10-28'] },
      { key: 'tags', values: ['daily', 'kigali'] },
      { key: 'thread', values: ['[[Library/chats/opal-status|Opal status]]'] },
      { key: 'summary', values: [] },
    ],
  };

  function installDaily(extra: Record<string, string> = {}) {
    const api = installMarkdownApi({ [DAILY]: DAILY_TEXT, ...extra });
    const properties = api.properties;
    api.properties = vi.fn(async (target: string) => {
      const response = await properties(target);
      return response.success && target === DAILY ? { ...response, data: { ...response.data, ...FACTS, size: 41 } } : response;
    });
    return api;
  }

  /** The block's rows as "term: detail", in order. */
  const rows = (block: Element) => [...block.querySelectorAll('dt')].map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`);
  const findBlock = () => waitFor(() => {
    const block = document.querySelector('[data-page-properties]');
    if (!block) throw new Error('No properties block');
    return block as HTMLElement;
  });
  const toggle = () => screen.getByRole('button', { name: /\d+ words?$/ });

  it('opens from the footer under the title, lists the frontmatter and then the file facts, and closes on a second click', async () => {
    const api = installDaily();
    const view = await openEditor(DAILY);
    expect(view.dom.querySelector('.cm-md-properties')).toBeNull();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle());
    const block = await findBlock();
    expect(api.properties).toHaveBeenCalledWith(DAILY);
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(block).toHaveAccessibleName('Properties of 2026-10-28.md');
    // Under the title and above the text, which it is not part of.
    const title = view.dom.querySelector('.cm-md-inline-title') as Element;
    expect(title.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.state.doc.toString()).toBe('');
    expect(rows(block)).toEqual([
      'date: 2026-10-28',
      'tags: daily, kigali',
      'thread: Opal status',
      'summary: Empty',
      'Path: Library/daily/2026-10-28.md',
      'Created: Oct 28, 2026 at 06:38',
      'Modified: Oct 28, 2026 at 06:38',
      'Size: 41 bytes',
    ]);
    expect(block.querySelectorAll('dl')).toHaveLength(2);
    fireEvent.click(toggle());
    await waitFor(() => expect(view.dom.querySelector('.cm-md-properties')).toBeNull());
    expect(usePagePropertiesStore.getState().open).toBe(false);
  });

  it('opens when the menu command runs, and stays open on the next page until it is closed', async () => {
    installDaily({ [NOTE]: '# Brief\n' });
    const first = renderEditor(DAILY);
    await screen.findByTestId('markdown-editor');
    act(() => usePagePropertiesStore.getState().setOpen(true));
    await findBlock();
    first.unmount();
    renderEditor(NOTE);
    const block = await findBlock();
    expect(rows(block)).toEqual(['Path: Notes/brief.md', 'Created: Oct 28, 2026 at 06:38', 'Modified: Oct 28, 2026 at 06:38', 'Size: 8 bytes']);
    expect(block.querySelectorAll('dl')).toHaveLength(1);
  });

  it('closes on Escape only while focus is in the block or on its toggle', async () => {
    installDaily();
    const view = await openEditor(DAILY);
    act(() => usePagePropertiesStore.getState().setOpen(true));
    let block = await findBlock();
    // In the text, Escape is the editor's.
    act(() => view.focus());
    fireEvent.keyDown(view.contentDOM, { key: 'Escape' });
    expect(usePagePropertiesStore.getState().open).toBe(true);
    act(() => block.focus());
    expect(document.activeElement).toBe(block);
    fireEvent.keyDown(block, { key: 'Escape' });
    expect(usePagePropertiesStore.getState().open).toBe(false);
    await waitFor(() => expect(view.dom.querySelector('.cm-md-properties')).toBeNull());
    expect(view.hasFocus).toBe(true);
    // On the toggle, Escape closes it and focus stays there.
    act(() => usePagePropertiesStore.getState().setOpen(true));
    block = await findBlock();
    act(() => toggle().focus());
    fireEvent.keyDown(toggle(), { key: 'Escape' });
    expect(usePagePropertiesStore.getState().open).toBe(false);
    expect(document.activeElement).toBe(toggle());
  });

  it('follows a wiki link value, and reads the file facts again after a save', async () => {
    const CARD = '/Vault/Library/chats/opal-status.md';
    const api = installDaily({ [CARD]: '' });
    const view = await openEditor(DAILY);
    act(() => usePagePropertiesStore.getState().setOpen(true));
    const block = await findBlock();
    expect(api.properties).toHaveBeenCalledTimes(1);
    act(() => { view.dispatch({ changes: { from: 0, insert: 'A line.' }, userEvent: 'input.type' }); });
    await waitFor(() => expect(api.write).toHaveBeenCalled(), { timeout: 2000 });
    await waitFor(() => expect(api.properties).toHaveBeenCalledTimes(2));
    fireEvent.click(within(block).getByRole('button', { name: 'Opal status' }));
    await waitFor(() => expect(openedPath()).toBe(CARD));
  });

  it('writes times as "Oct 28, 2026 at 06:38" and sizes in bytes, KB or MB', () => {
    expect(formatFileTime(new Date(2026, 9, 28, 6, 38).getTime())).toBe('Oct 28, 2026 at 06:38');
    expect(formatFileTime(new Date(2026, 0, 2, 23, 5).getTime())).toBe('Jan 2, 2026 at 23:05');
    expect(formatFileTime(new Date(2026, 9, 28).getTime(), true)).toBe('Oct 28, 2026');
    expect(formatFileSize(1)).toBe('1 byte');
    expect(formatFileSize(41)).toBe('41 bytes');
    expect(formatFileSize(1023)).toBe('1,023 bytes');
    expect(formatFileSize(12_700)).toBe('12.4 KB');
    expect(formatFileSize(3_250_000)).toBe('3.1 MB');
  });
});
