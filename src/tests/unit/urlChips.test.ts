import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { urlChip } from '@/renderer/features/disk-explorer/components/editor/urlChips';
import { objectAt } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installFilesApi } from '@/tests/helpers/filesApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const DOC = '/Vault/Notes/Plan.mdo';
let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '' });
  installFilesApi();
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
});

function mount(doc: string, page = DOC) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page) }) });
  view.focus = vi.fn();
  views.push(view);
  return view;
}

describe('service chips', () => {
  it('read a label from each service\'s address alone', () => {
    const table: [string, string | null][] = [
      ['https://linear.app/acme/issue/eng-12/fix-sign-in', 'ENG-12'],
      ['https://linear.app/acme/project/launch-abc', 'Linear project'],
      ['https://github.com/example/project/pull/13', 'project#13'],
      ['https://github.com/example/project/issues/7', 'project#7'],
      ['https://github.com/example/project/commit/41ca4514b394dbcc7eec6b894568f962f3e0d154', 'project@41ca451'],
      ['https://github.com/example/project/blob/main/src/main.ts', 'main.ts'],
      ['https://github.com/example/project', 'example/project'],
      ['https://docs.google.com/document/d/1KhEoybd1ca9/edit', 'Google Doc'],
      ['https://docs.google.com/spreadsheets/d/1abc/edit#gid=0', 'Google Sheet'],
      ['https://docs.google.com/presentation/d/1abc/edit', 'Google Slides'],
      ['https://drive.google.com/drive/folders/1abc', 'Drive folder'],
      ['https://drive.google.com/file/d/1abc/view', 'Drive file'],
      ['https://calendar.google.com/calendar/event?eid=abc', 'Calendar event'],
      ['https://mail.google.com/mail/u/0/#all/18f2', 'Email'],
      ['https://acme.slack.com/archives/C07ABC/p1730000000', 'Slack message'],
      ['https://www.figma.com/design/AbC123/Bit-shell-v2?node-id=1', 'Bit shell v2'],
      ['https://cad.onshape.com/documents/abc/w/def/e/ghi', 'Onshape document'],
      ['https://www.notion.so/acme/Team-plan-0123456789abcdef0123456789abcdef', 'Team plan'],
      ['https://www.youtube.com/watch?v=abc', 'YouTube video'],
      ['https://example.com/page', null],
    ];
    expect(table.map(([url]) => urlChip(url)?.label ?? null)).toEqual(table.map(([, label]) => label));
  });

  it('draw as a chip in text, once the address is ended', () => {
    const url = 'https://github.com/example/project/pull/13';
    const view = mount('See \n');
    // Typed character by character, the address stays text while the caret is at its end.
    for (const [index, char] of [...url].entries()) {
      act(() => { view.dispatch({ changes: { from: 4 + index, insert: char }, selection: { anchor: 5 + index }, userEvent: 'input.type' }); });
    }
    expect(view.contentDOM.querySelector('.cm-url-chip')).toBeNull();
    act(() => { view.dispatch({ changes: { from: 4 + url.length, insert: ' ' }, selection: { anchor: 5 + url.length }, userEvent: 'input.type' }); });
    expect(view.contentDOM.querySelector('.cm-url-chip')).toHaveTextContent('project#13');
    expect(view.state.doc.toString()).toBe(`See ${url} \n`);
  });

  it('forms at once for a pasted address, and goes in one Backspace in a document', () => {
    const url = 'https://linear.app/acme/issue/ENG-12';
    const view = mount('See \n');
    act(() => { view.dispatch({ changes: { from: 4, insert: url }, selection: { anchor: 4 + url.length }, userEvent: 'input.paste' }); });
    expect(view.contentDOM.querySelector('.cm-url-chip')).toHaveTextContent('ENG-12');
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(view.state.doc.toString()).toBe('See \n');
  });

  it('shows the address as written while a document\'s caret is at its start, where a typed letter would join it', () => {
    const url = 'https://github.com/example/project/pull/13';
    const shown = mount(`Watch: ${url}\n`);
    expect(shown.contentDOM.querySelector('.cm-url-chip')).not.toBeNull();
    act(() => { shown.dispatch({ selection: { anchor: 7 } }); });
    // Lines redraw when the page has focus; a fresh view reads the caret at once.
    const fresh = new EditorView({ parent: document.body, state: shown.state });
    views.push(fresh);
    expect(fresh.contentDOM.querySelector('.cm-url-chip')).toBeNull();
    expect(fresh.contentDOM.textContent).toContain(url);
  });

  it('leaves written links with their own text and unknown addresses alone, and loads nothing', () => {
    const view = mount('[the PR](https://github.com/example/project/pull/13) and https://example.com/x \n');
    expect(view.contentDOM.querySelector('.cm-url-chip')).toBeNull();
    expect(view.contentDOM.querySelectorAll('[src^="http"]')).toHaveLength(0);
  });

  it('writes a link dragged from a browser as [Anchor](url), its text escaped', () => {
    const view = mount('Read  today\n');
    vi.spyOn(view, 'posAtCoords').mockReturnValue(5);
    const event = new Event('drop', { bubbles: true, cancelable: true });
    const data: Record<string, string> = {
      'text/uri-list': 'https://example.com/a_b',
      'text/html': '<meta charset="utf-8"><a href="https://example.com/a_b">Q3 *final* [draft] | notes</a>',
      'text/plain': 'https://example.com/a_b',
    };
    Object.defineProperty(event, 'dataTransfer', { value: { types: Object.keys(data), getData: (type: string) => data[type] ?? '' } });
    act(() => { view.contentDOM.dispatchEvent(event); });
    expect(view.state.doc.toString()).toBe('Read [Q3 \\*final\\* \\[draft\\] | notes](https://example.com/a_b) today\n');
  });

  it('takes one character on Backspace while an address being typed still shows as text, and on Delete at its start', () => {
    const url = 'https://github.com/example/project/pull/13x';
    const view = mount('See \n');
    const type = (char: string, at: number) => act(() => { view.dispatch({ changes: { from: at, insert: char }, selection: { anchor: at + 1 }, userEvent: 'input.type' }); });
    for (const [index, char] of [...url].entries()) type(char, 4 + index);
    expect(view.contentDOM.querySelector('.cm-url-chip')).toBeNull();
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(view.state.doc.toString()).toBe('See https://github.com/example/project/pull/13\n');
    const start = mount('See https://github.com/example/project/pull/13 now\n');
    act(() => { start.dispatch({ selection: { anchor: 4 } }); });
    act(() => { runScopeHandlers(start, new KeyboardEvent('keydown', { key: 'Delete' }), 'editor'); });
    expect(start.state.doc.toString()).toBe('See ttps://github.com/example/project/pull/13 now\n');
  });

  it('keeps a YouTube address alone on its line a card object, framed on the first Backspace', () => {
    const doc = 'Intro\n\nhttps://www.youtube.com/watch?v=abc\n\nAfter\n';
    const end = doc.indexOf('\n\nAfter');
    const view = mount(doc);
    act(() => { view.dispatch({ selection: { anchor: end } }); });
    expect(objectAt(view.state, end, -1)?.kind).toBe('file');
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.field(objectFrame)).not.toBeNull();
  });

  it('draws no card for a YouTube address while it is typed alone on its line', () => {
    const url = 'https://youtu.be/abc';
    const view = mount('Intro\n\n\nAfter\n');
    for (const [index, char] of [...url].entries()) {
      act(() => { view.dispatch({ changes: { from: 7 + index, insert: char }, selection: { anchor: 8 + index }, userEvent: 'input.type' }); });
    }
    expect(view.contentDOM.querySelector('.cm-file-card')).toBeNull();
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(view.state.doc.toString()).toBe('Intro\n\nhttps://youtu.be/ab\nAfter\n');
  });

  it('escapes a dropped link\'s pipe in a table cell, and drops a bare address into code', () => {
    const data: Record<string, string> = {
      'text/uri-list': 'https://example.com/plan',
      'text/html': '<a href="https://example.com/plan">Plan | Notion</a>',
    };
    const dropAt = (view: EditorView, at: number) => {
      vi.spyOn(view, 'posAtCoords').mockReturnValue(at);
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { types: Object.keys(data), getData: (type: string) => data[type] ?? '' } });
      act(() => { view.contentDOM.dispatchEvent(event); });
    };
    const tableDoc = '| a | b |\n| --- | --- |\n| x |  |\n';
    const table = mount(tableDoc, '/Vault/Notes/Plan.md');
    dropAt(table, tableDoc.lastIndexOf('|  |') + 2);
    expect(table.state.doc.toString()).toBe('| a | b |\n| --- | --- |\n| x | [Plan \\| Notion](https://example.com/plan) |\n');
    const codeDoc = '```sh\ncurl \n```\n';
    const code = mount(codeDoc, '/Vault/Notes/Plan.md');
    dropAt(code, codeDoc.indexOf('curl ') + 5);
    expect(code.state.doc.toString()).toBe('```sh\ncurl https://example.com/plan\n```\n');
  });

  it('draws a YouTube address alone on its line as a card, whose still main loads once on Load preview', async () => {
    const still = 'data:image/jpeg;base64,c3RpbGw=';
    const api = installFilesApi({ videoStill: vi.fn(async (_address: string, options?: { cached?: boolean }) => ({ success: true as const, data: options?.cached ? null : still })) });
    const view = mount('Intro\n\nhttps://www.youtube.com/watch?v=abc\n\nAfter\n');
    const card = view.contentDOM.querySelector('.cm-file-card') as HTMLElement;
    expect(card.querySelector('.cm-file-card-name')).toHaveTextContent('YouTube video');
    expect(card.querySelector('.cm-file-card-meta')).toHaveTextContent('youtube.com/watch?v=abc');
    const load = await waitFor(() => [...card.querySelectorAll('button')].find((control) => control.textContent === 'Load preview') as HTMLButtonElement);
    expect(api.videoStill).toHaveBeenCalledWith('https://www.youtube.com/watch?v=abc', { cached: true });
    await act(async () => { load.click(); });
    await waitFor(() => expect(card.querySelector('.cm-file-thumb')).toHaveAttribute('src', still));
    expect(api.videoStill).toHaveBeenLastCalledWith('https://www.youtube.com/watch?v=abc');
    expect(card.querySelector('button')).toBeNull();
  });
});
