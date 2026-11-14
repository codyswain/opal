import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { toast } from 'sonner';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { commentBox, commentMarks, groupStatus, markGroups, openCommentBox, openMark, selectedLines, setOpenMark } from '@/renderer/features/comment/commentEditor';
import { listenToRuns, runTouches, RUN_TOUCH_MS, useCommentStore } from '@/renderer/features/comment/commentStore';
import { SIGNED_OUT_MESSAGE } from '@/common/commentText';
import { TooltipProvider } from '@/renderer/shared/ui';
import type { AgentAPI, AgentReadiness, CommentRun } from '@/types/agent';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { openTabs } from '@/tests/helpers/tabs';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const NOTE = '/Vault/Projects/Plan.md';
const DOC = '/Vault/Projects/Plan.mdo';
const TEXT = '# Plan\n\nWe ship on Friday.\nThen we rest.\nNotes follow.\n';

let changed: ((payload: { directories: string[] }) => void) | null = null;
let readiness: AgentReadiness[];
let runChanged: ((run: CommentRun) => void) | null;
let calls: string[];
let agent: AgentAPI & { [key: string]: ReturnType<typeof vi.fn> };
let stopListening: () => void = () => undefined;

afterEach(() => stopListening());

beforeEach(() => {
  changed = null;
  const listeners = new Set<(payload: { directories: string[] }) => void>();
  installDiskApi({
    onChanged: vi.fn((callback: (payload: { directories: string[] }) => void) => {
      listeners.add(callback);
      changed = (payload) => { for (const listener of [...listeners]) listener(payload); };
      return () => { listeners.delete(callback); };
    }),
  });
  openTabs([NOTE]);
  useCommentStore.setState({ marks: {}, ended: {} });
  vi.mocked(toast).mockClear();
  readiness = [];
  runChanged = null;
  calls = [];
  let count = 0;
  agent = {
    readiness: vi.fn(async () => ({ success: true as const, data: readiness.shift() ?? { state: 'ready' as const } })),
    allowFolder: vi.fn(async () => { calls.push('allow'); return { success: true as const, data: undefined }; }),
    start: vi.fn(async (request) => {
      calls.push('start');
      count += 1;
      return { success: true as const, data: { id: `run-${count}`, path: request.path, status: 'running' as const, reply: '', sessionId: null } };
    }),
    stop: vi.fn(async () => ({ success: true as const, data: undefined })),
    onRunChanged: vi.fn((callback: (run: CommentRun) => void) => { runChanged = callback; return () => { runChanged = null; }; }),
  } as never;
  (window as unknown as { agentAPI: AgentAPI }).agentAPI = agent;
  // As the window does at startup.
  stopListening = listenToRuns();
});

async function openEditor(path: string, text = TEXT) {
  const api = installMarkdownApi({ [path]: text });
  const write = api.write;
  api.write = vi.fn(async (...args: Parameters<typeof write>) => { calls.push('write'); return write(...args); });
  const rendered = render(<MarkdownEditor path={path} />, { wrapper: TooltipProvider });
  const view = EditorView.findFromDOM(await screen.findByTestId('markdown-editor')) as EditorView;
  // Real focus would let happy-dom fire selectionchange inside CodeMirror's own updates, which browsers never do.
  view.focus = vi.fn();
  return { api, view, rendered };
}

const select = (view: EditorView, anchor: number, head: number) => act(() => { view.dispatch({ selection: { anchor, head } }); });
const box = () => screen.findByTestId('comment-box');
const field = () => within(screen.getByTestId('comment-box')).getByRole('textbox', { name: 'Comment' });
const typeComment = (text: string) => fireEvent.change(field(), { target: { value: text } });
const enter = (init: KeyboardEventInit = {}) => fireEvent.keyDown(field(), { key: 'Enter', ...init });
const run = (id: string, status: CommentRun['status'], reply = ''): CommentRun => ({ id, path: NOTE, status, reply, sessionId: 's1' });
const marksIn = (view: EditorView) => [...view.state.field(commentMarks)];

describe('Comment', () => {
  it('opens on Cmd+Shift+M with the selection marked, saves the page, then starts the run with its lines and marks the first one', async () => {
    const { api, view } = await openEditor(NOTE);
    // Unsaved typing first, so the save has something to write.
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: 'More.\n' }, userEvent: 'input.type' }); });
    const from = TEXT.indexOf('ship');
    const to = TEXT.indexOf('rest') + 4;
    select(view, from, to);
    const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'M', keyCode: 77, shiftKey: true, ...mod }), 'editor'); });
    await box();
    expect(view.state.field(commentBox)).toMatchObject({ from, to });
    expect(view.contentDOM.querySelector('.cm-comment-target')?.textContent).toBe('ship on Friday.');
    expect(field()).toHaveFocus();
    // Shift+Enter is a new line, not a send.
    typeComment('Make these one line');
    enter({ shiftKey: true });
    expect(agent.start).not.toHaveBeenCalled();
    enter();
    await waitFor(() => expect(agent.start).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['write', 'start']);
    expect(api.documents.get(NOTE)?.body).toBe(`${TEXT}More.\n`);
    expect(agent.start).toHaveBeenCalledWith({ path: NOTE, comment: 'Make these one line', selection: { from: 3, to: 4, text: 'ship on Friday.\nThen we rest' } });
    await waitFor(() => expect(screen.queryByTestId('comment-box')).toBeNull());
    // The mark is where the selection starts, not at its line's start.
    expect(marksIn(view)).toEqual([['run-1', expect.objectContaining({ pos: from, status: 'running' })]]);
    expect(view.focus).toHaveBeenCalled();
  });

  it('sends a comment about the whole page with no selection, and Escape keeps nothing', async () => {
    const { view } = await openEditor(NOTE);
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Throw this away');
    fireEvent.keyDown(field(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('comment-box')).toBeNull());
    act(() => { openCommentBox(view); });
    await box();
    expect(field()).toHaveValue('');
    typeComment('Add a summary');
    enter();
    await waitFor(() => expect(agent.start).toHaveBeenCalledWith({ path: NOTE, comment: 'Add a summary', selection: null }));
    expect(marksIn(view)[0][1].pos).toBe(0);
  });

  it('counts a selection that ends at the start of a line as ending on the line before', async () => {
    const { view } = await openEditor(NOTE);
    const start = TEXT.indexOf('We ship');
    const next = TEXT.indexOf('Then');
    expect(selectedLines(view.state, start, next)).toEqual({ from: 3, to: 3, text: 'We ship on Friday.\n' });
    expect(selectedLines(view.state, start, start)).toBeNull();
  });

  it('brings the run\'s edit on disk into the open page while typing goes on, through the merge, and the mark keeps its line', async () => {
    const { api, view } = await openEditor(NOTE);
    select(view, TEXT.indexOf('Then'), TEXT.indexOf('rest.') + 5);
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Make this a question');
    enter();
    await waitFor(() => expect(marksIn(view)).toHaveLength(1));
    // The user keeps typing at the end while the run edits the file on disk: a line above, and its own line changed.
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: 'Typed while it ran.' }, userEvent: 'input.type' }); });
    api.externalEdit(NOTE, '# Plan\n\nA line the run added.\nWe ship on Friday.\nDo we rest then?\nNotes follow.\n');
    act(() => { changed?.({ directories: ['/Vault/Projects'] }); });
    await waitFor(() => expect(view.state.doc.toString()).toBe('# Plan\n\nA line the run added.\nWe ship on Friday.\nDo we rest then?\nNotes follow.\nTyped while it ran.'));
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '!' }, userEvent: 'input.type' }); });
    expect(view.state.doc.toString().endsWith('Typed while it ran.!')).toBe(true);
    // The comment's place keeps to the start of the text that replaced the selection.
    const line = view.state.doc.toString().indexOf('Do we rest then?');
    expect(marksIn(view)[0][1].pos).toBe(line);
    // The merged text is saved, typing and all.
    await waitFor(() => expect(api.documents.get(NOTE)?.body).toContain('Do we rest then?\nNotes follow.\nTyped while it ran.!'));
  });

  it('shows done with the reply, and a done mark goes once its popover closes; a page off screen gets a notice', async () => {
    const { view } = await openEditor(NOTE);
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Tighten');
    enter();
    await waitFor(() => expect(marksIn(view)).toHaveLength(1));
    act(() => { runChanged?.(run('run-1', 'done', 'Shortened the first paragraph.')); });
    await waitFor(() => expect(marksIn(view)[0][1].status).toBe('done'));
    // Happy DOM lays nothing out, so the page counts as off screen.
    expect(toast).toHaveBeenCalledWith('Comment on Plan is done.', expect.objectContaining({ action: expect.objectContaining({ label: 'Open' }) }));
    act(() => { view.dispatch({ effects: setOpenMark.of(['run-1']) }); });
    const popover = await screen.findByTestId('comment-popover');
    expect(popover).toHaveTextContent('Tighten');
    expect(popover).toHaveTextContent('Shortened the first paragraph.');
    expect(within(popover).queryByRole('button')).toBeNull();
    act(() => { view.dispatch({ effects: setOpenMark.of(null) }); });
    await waitFor(() => expect(marksIn(view)).toEqual([]));
    expect(useCommentStore.getState().marks).toEqual({});
  });

  it('keeps a failed mark until dismissed, and stops a running one', async () => {
    const { view } = await openEditor(NOTE);
    for (const comment of ['First', 'Second']) {
      act(() => { openCommentBox(view); });
      await box();
      typeComment(comment);
      enter();
      await waitFor(() => expect(screen.queryByTestId('comment-box')).toBeNull());
    }
    expect(marksIn(view)).toHaveLength(2);
    act(() => { runChanged?.(run('run-1', 'failed', SIGNED_OUT_MESSAGE)); });
    act(() => { view.dispatch({ effects: setOpenMark.of(['run-1']) }); });
    let popover = await screen.findByTestId('comment-popover');
    // Both are about the whole page, so they share the mark at its first row.
    expect(within(popover).getAllByTestId('comment-entry')).toHaveLength(2);
    expect(popover).toHaveTextContent(SIGNED_OUT_MESSAGE.replace(/`/g, ''));
    act(() => { view.dispatch({ effects: setOpenMark.of(null) }); });
    await waitFor(() => expect(screen.queryByTestId('comment-popover')).toBeNull());
    expect(view.state.field(commentMarks).get('run-1')?.status).toBe('failed');
    act(() => { view.dispatch({ effects: setOpenMark.of(['run-1']) }); });
    fireEvent.click(within(await screen.findByTestId('comment-popover')).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(view.state.field(commentMarks).has('run-1')).toBe(false));

    act(() => { view.dispatch({ effects: setOpenMark.of(['run-2']) }); });
    popover = await screen.findByTestId('comment-popover');
    fireEvent.click(within(popover).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(agent.stop).toHaveBeenCalledWith('run-2'));
    expect(view.state.field(commentMarks).get('run-2')?.status).toBe('stopping');
    act(() => { runChanged?.(run('run-2', 'stopped')); });
    await waitFor(() => expect(marksIn(view)).toEqual([]));
  });

  it('says not installed or not signed in as the box opens, and keeps the comment', async () => {
    readiness = [{ state: 'missing' }, { state: 'missing' }];
    const { view } = await openEditor(NOTE);
    act(() => { openCommentBox(view); });
    await box();
    const line = await screen.findByTestId('comment-line');
    expect(line).toHaveTextContent('Claude Code is not installed. How to install');
    expect(within(line).getByRole('link', { name: 'How to install' })).toHaveAttribute('target', '_blank');
    typeComment('Tighten');
    enter();
    await waitFor(() => expect(agent.readiness).toHaveBeenCalledTimes(2));
    expect(agent.start).not.toHaveBeenCalled();
    expect(field()).toHaveValue('Tighten');

    fireEvent.keyDown(field(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('comment-box')).toBeNull());
    readiness = [{ state: 'signed-out' }];
    act(() => { openCommentBox(view); });
    await box();
    expect(await screen.findByTestId('comment-line')).toHaveTextContent('Claude Code is not signed in. Run claude auth login in a terminal.');
  });

  it('asks the first-use question on Enter, and runs once the folder says yes', async () => {
    readiness = [{ state: 'ask', folder: 'Vault' }, { state: 'ask', folder: 'Vault' }, { state: 'ask', folder: 'Vault' }];
    const { view } = await openEditor(NOTE);
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Tighten');
    enter();
    const question = await screen.findByTestId('comment-line');
    expect(question).toHaveTextContent("Run Claude Code in this folder? It loads this folder's Claude settings, hooks and tools.");
    expect(agent.start).not.toHaveBeenCalled();
    // Cancel goes back to the comment.
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('comment-line')).toBeNull();
    enter();
    const run = within(await screen.findByTestId('comment-line')).getByRole('button', { name: 'Run' });
    expect(run).toHaveFocus();
    readiness = [{ state: 'ready' }];
    fireEvent.click(run);
    await waitFor(() => expect(agent.start).toHaveBeenCalled());
    expect(calls).toEqual(['allow', 'start']);
  });

  it('works the same in a document, and a mark comes back where it was when the editor returns', async () => {
    const { view, rendered } = await openEditor(DOC);
    select(view, TEXT.indexOf('Notes'), TEXT.indexOf('follow'));
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Expand');
    enter();
    await waitFor(() => expect(marksIn(view)).toHaveLength(1));
    act(() => { view.dispatch({ changes: { from: 0, insert: 'Intro.\n' }, userEvent: 'input.type' }); });
    const moved = TEXT.indexOf('Notes') + 'Intro.\n'.length;
    expect(marksIn(view)[0][1].pos).toBe(moved);
    rendered.unmount();
    expect(useCommentStore.getState().marks['run-1'].pos).toBe(moved);
    render(<MarkdownEditor path={DOC} />, { wrapper: TooltipProvider });
    const again = EditorView.findFromDOM(await screen.findByTestId('markdown-editor')) as EditorView;
    await waitFor(() => expect(again.state.doc.toString()).toBe(`Intro.\n${TEXT}`));
    expect(marksIn(again)).toEqual([['run-1', expect.objectContaining({ pos: moved, status: 'running' })]]);
  });

  it('hears the end of the first run of the window even when it comes before the start call answers', async () => {
    vi.mocked(agent.start).mockImplementationOnce(async (request) => {
      // The command could not start: its end is sent before start answers.
      runChanged?.({ id: 'run-early', path: request.path, status: 'failed', reply: 'spawn claude ENOENT', sessionId: null as string | null });
      return { success: true as const, data: { id: 'run-early', path: request.path, status: 'running' as const, reply: '', sessionId: null } };
    });
    const { view } = await openEditor(NOTE);
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Tighten');
    enter();
    await waitFor(() => expect(marksIn(view)).toHaveLength(1));
    await waitFor(() => expect(view.state.field(commentMarks).get('run-early')?.status).toBe('failed'));
    expect(useCommentStore.getState().marks['run-early'].reply).toBe('spawn claude ENOENT');
  });

  it('shares one mark among comments on one row: running before failed before done, oldest first, each with its own Stop or Dismiss', async () => {
    expect(groupStatus(['done', 'failed', 'stopping'])).toBe('running');
    expect(groupStatus(['done', 'failed'])).toBe('failed');
    expect(groupStatus(['done', 'done'])).toBe('done');
    const { view } = await openEditor(NOTE);
    const at = TEXT.indexOf('ship');
    for (const comment of ['First', 'Second', 'Third']) {
      select(view, at, at + 4);
      act(() => { openCommentBox(view); });
      await box();
      typeComment(comment);
      enter();
      await waitFor(() => expect(screen.queryByTestId('comment-box')).toBeNull());
    }
    const groups = markGroups(view);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ ids: ['run-1', 'run-2', 'run-3'], status: 'running' });
    act(() => { runChanged?.(run('run-1', 'done', 'Changed `Projects/Plan.md` line 3.')); });
    act(() => { runChanged?.(run('run-2', 'failed', SIGNED_OUT_MESSAGE)); });
    await waitFor(() => expect(view.state.field(commentMarks).get('run-2')?.status).toBe('failed'));
    expect(markGroups(view)[0].status).toBe('running');

    act(() => { view.dispatch({ effects: setOpenMark.of(markGroups(view)[0].ids) }); });
    const popover = await screen.findByTestId('comment-popover');
    const entries = within(popover).getAllByTestId('comment-entry');
    expect(entries.map((entry) => entry.querySelector('.opal-comment-quote')?.textContent)).toEqual(['First', 'Second', 'Third']);
    // Backtick spans are code; nothing else is read as Markdown.
    expect(entries[0].querySelector('code')?.textContent).toBe('Projects/Plan.md');
    expect(entries[0]).toHaveTextContent('Changed Projects/Plan.md line 3.');
    expect(entries[1].querySelector('code')?.textContent).toBe('claude auth login');
    expect(within(entries[0]).queryByRole('button')).toBeNull();
    expect(within(entries[1]).getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(within(entries[2]).getByRole('button', { name: 'Stop' })).toBeTruthy();
    // Dismissing one keeps the popover open on the others.
    fireEvent.click(within(entries[1]).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(within(screen.getByTestId('comment-popover')).getAllByTestId('comment-entry')).toHaveLength(2));
    // Closing clears the done comment it showed; the running one keeps the mark.
    act(() => { view.dispatch({ effects: setOpenMark.of(null) }); });
    await waitFor(() => expect([...view.state.field(commentMarks).keys()]).toEqual(['run-3']));
    expect(view.state.field(openMark)).toBeNull();
  });

  it('keeps a comment made inside a drawn table on the page', async () => {
    const table = '# Plan\n\n| Item | Owner |\n| --- | --- |\n| Boxes | alex |\n\nAfter.\n';
    const { view } = await openEditor(DOC, table);
    const at = table.indexOf('Boxes');
    select(view, at, at);
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Add a date column');
    enter();
    await waitFor(() => expect(marksIn(view)).toHaveLength(1));
    expect(markGroups(view)).toEqual([expect.objectContaining({ ids: ['run-1'] })]);
    expect(Number.isFinite(markGroups(view)[0].y)).toBe(true);
  });

  it('keeps an open box and its text when Comment is asked for again, and gives its field the focus', async () => {
    const { view } = await openEditor(NOTE);
    select(view, TEXT.indexOf('ship'), TEXT.indexOf('ship') + 4);
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Half a thought');
    const before = view.state.field(commentBox);
    field().blur();
    act(() => { openCommentBox(view); });
    expect(view.state.field(commentBox)).toBe(before);
    expect(field()).toHaveValue('Half a thought');
    expect(field()).toHaveFocus();
  });
});

describe('undo after a comment\'s run edits the page', () => {
  /** Sends a comment on the line holding `text`, so a run is going on the page. */
  async function commentOnLine(view: EditorView, text: string) {
    const at = view.state.doc.toString().indexOf(text);
    select(view, at, at + text.length);
    act(() => { openCommentBox(view); });
    await box();
    typeComment('Rewrite this');
    enter();
    await waitFor(() => expect(marksIn(view)).toHaveLength(1));
  }
  const fromDisk = (api: ReturnType<typeof installMarkdownApi>, body: string) => {
    api.externalEdit(NOTE, body);
    act(() => { changed?.({ directories: ['/Vault/Projects'] }); });
  };
  const typeAt = (view: EditorView, at: number, insert: string) => act(() => {
    view.dispatch({ changes: { from: at, insert }, userEvent: 'input.type' });
  });
  const press = (command: typeof undo, view: EditorView) => act(() => { command(view); });
  const RUN = TEXT.replace('We ship on Friday.', 'Do we ship on Friday?');

  it('counts a page as touched by a run while it runs and for a moment after it ends', async () => {
    const { view } = await openEditor(NOTE);
    expect(runTouches(NOTE)).toBe(false);
    await commentOnLine(view, 'We ship on Friday.');
    expect(runTouches(NOTE)).toBe(true);
    expect(runTouches('/Vault/Projects/Other.md')).toBe(false);
    act(() => { runChanged?.(run('run-1', 'done', 'Done.')); });
    expect(runTouches(NOTE)).toBe(true);
    expect(runTouches(NOTE, Date.now() + RUN_TOUCH_MS + 1)).toBe(false);
  });

  it('takes the run\'s edit back as one step, saves that, brings it back with redo, then undoes earlier typing cleanly', async () => {
    const { api, view } = await openEditor(NOTE);
    typeAt(view, TEXT.indexOf('Notes'), 'Mine. ');
    const typed = TEXT.replace('Notes', 'Mine. Notes');
    await waitFor(() => expect(api.documents.get(NOTE)?.body).toBe(typed));
    await commentOnLine(view, 'We ship on Friday.');
    const ran = typed.replace('We ship on Friday.', 'Do we ship on Friday?');
    fromDisk(api, ran);
    await waitFor(() => expect(view.state.doc.toString()).toBe(ran));
    press(undo, view);
    expect(view.state.doc.toString()).toBe(typed);
    // The page is dirty again, and the file follows.
    await waitFor(() => expect(api.documents.get(NOTE)?.body).toBe(typed));
    press(redo, view);
    expect(view.state.doc.toString()).toBe(ran);
    press(undo, view);
    press(undo, view);
    expect(view.state.doc.toString()).toBe(TEXT);
  });

  it('brings back what a stale write removed, undamaged, in one step', async () => {
    const { api, view } = await openEditor(NOTE);
    await commentOnLine(view, 'Then we rest.');
    const at = TEXT.indexOf('Then we') + 'Then we'.length;
    typeAt(view, at, ' TYPED');
    const typed = `${TEXT.slice(0, at)} TYPED${TEXT.slice(at)}`;
    await waitFor(() => expect(api.documents.get(NOTE)?.body).toBe(typed));
    // The run writes from what it read before the typing was saved.
    const stale = TEXT.replace('Then we rest.', 'THEN WE REST.');
    fromDisk(api, stale);
    await waitFor(() => expect(view.state.doc.toString()).toBe(stale));
    press(undo, view);
    expect(view.state.doc.toString()).toBe(typed);
    await waitFor(() => expect(api.documents.get(NOTE)?.body).toBe(typed));
    press(undo, view);
    expect(view.state.doc.toString()).toBe(TEXT);
  });

  it('takes back only the run\'s part of a merge into a page with unsaved typing', async () => {
    const { api, view } = await openEditor(NOTE);
    await commentOnLine(view, 'We ship on Friday.');
    typeAt(view, view.state.doc.length, 'Unsaved.');
    fromDisk(api, RUN);
    await waitFor(() => expect(view.state.doc.toString()).toBe(`${RUN}Unsaved.`));
    press(undo, view);
    expect(view.state.doc.toString()).toBe(`${TEXT}Unsaved.`);
    press(undo, view);
    expect(view.state.doc.toString()).toBe(TEXT);
  });

  it('after a conflict settled with Keep disk version, undo gives the page\'s side back', async () => {
    const { api, view } = await openEditor(NOTE);
    await commentOnLine(view, 'We ship on Friday.');
    const at = TEXT.indexOf('Friday');
    typeAt(view, at, 'next ');
    const mine = view.state.doc.toString();
    fromDisk(api, RUN);
    const bar = await screen.findByTestId('editor-conflict');
    fireEvent.click(within(bar).getByRole('button', { name: 'Keep disk version' }));
    await waitFor(() => expect(view.state.doc.toString()).toBe(RUN));
    press(undo, view);
    expect(view.state.doc.toString()).toBe(mine);
    press(undo, view);
    expect(view.state.doc.toString()).toBe(TEXT);
  });

  it('keeps every other disk edit out of undo, as before', async () => {
    const { api, view } = await openEditor(NOTE);
    typeAt(view, 0, 'X');
    await waitFor(() => expect(api.documents.get(NOTE)?.body).toBe(`X${TEXT}`));
    fromDisk(api, `X${RUN}`);
    await waitFor(() => expect(view.state.doc.toString()).toBe(`X${RUN}`));
    press(undo, view);
    expect(view.state.doc.toString()).toBe(RUN);
  });
});
