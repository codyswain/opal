import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { CompletionContext, completionStatus, currentCompletions } from '@codemirror/autocomplete';
import { undo } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { setLinkEditor } from '@/renderer/features/disk-explorer/components/editor/docMode';
import { LinkPopover } from '@/renderer/features/disk-explorer/components/editor/LinkPopover';
import { linkCompletions, pickedText } from '@/renderer/features/disk-explorer/components/editor/linkPicker';
import { linksResolved } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { TooltipProvider } from '@/renderer/shared/ui';
import { collectionResult, collectionRow, installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installFilesApi } from '@/tests/helpers/filesApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import type { CollectionQuery } from '@/types/collectionQuery';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const DOC = '/Vault/Notes/Plan.mdo';
const ROWS = [
  collectionRow({ entry: { path: '/Vault/Library/files/2026-11/q3.a3f9c2e1.pdf', name: 'q3.a3f9c2e1.pdf', kind: 'pdf' }, touchedAt: 3 }),
  collectionRow({ entry: { path: '/Vault/Projects/Roadmap.mdo', name: 'Roadmap.mdo', kind: 'markdown' }, touchedAt: 2 }),
  collectionRow({ entry: { path: '/Vault/Decks/Gob deck.pptx', name: 'Gob deck.pptx', kind: 'other' }, touchedAt: 1 }),
];

let views: EditorView[] = [];
let queries: CollectionQuery[] = [];

beforeEach(() => {
  queries = [];
  useDiskStore.setState({ roots: ['/Vault'] });
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '' });
  installFilesApi();
  installCollectionsApi({
    query: vi.fn(async (query: CollectionQuery) => {
      queries.push(query);
      return { success: true as const, data: collectionResult(ROWS) };
    }),
  });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string, caret = doc.length) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: caret }, extensions: markdownEditorExtensions(DOC) }) });
  view.focus = vi.fn();
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

/** Runs the picker's source at the caret and applies option `index` as Enter would. */
async function pick(view: EditorView, index: number) {
  const { head } = view.state.selection.main;
  const result = await linkCompletions(new CompletionContext(view.state, head, true));
  if (!result) throw new Error('no picker here');
  const option = result.options[index];
  act(() => { (option.apply as (view: EditorView, completion: typeof option, from: number, to: number) => void)(view, option, result.from, head); });
  return result;
}

describe('the [[ picker', () => {
  it('lists notes, documents and files, recent first for an empty query and by match once typed', async () => {
    const view = mount('See [[');
    const result = await linkCompletions(new CompletionContext(view.state, view.state.doc.length, true));
    expect(result?.options.map((option) => [option.label, option.detail])).toEqual([
      ['q3.pdf', 'Library/files/2026-11'],
      ['Roadmap', 'Projects'],
      ['Gob deck.pptx', 'Decks'],
    ]);
    expect(queries[0].sort).toEqual({ field: 'touched', direction: 'desc' });
    const typed = mount('See [[road');
    await linkCompletions(new CompletionContext(typed.state, typed.state.doc.length, true));
    expect(queries[1].filters).toContainEqual({ field: 'name', op: 'matches', value: 'road' });
    expect(queries[1].sort).toEqual({ field: 'match', direction: 'desc' });
    expect(await linkCompletions(new CompletionContext(typed.state, 3, true))).toBeNull();
  });

  it('puts a file in mid-sentence as a chip and a note as a link, each one undo step', async () => {
    const view = mount('See [[ today', 6);
    await pick(view, 0);
    expect(text(view)).toBe('See [[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.pdf]] today');
    act(() => { undo(view); });
    expect(text(view)).toBe('See [[ today');
    await pick(view, 1);
    expect(text(view)).toBe('See [[Projects/Roadmap.mdo|Roadmap]] today');
  });

  it('puts a file in on an empty line in its type\'s look, and swallows a closing ]] typed ahead', async () => {
    const view = mount('Intro\n[[]]\n', 8);
    await pick(view, 0);
    expect(text(view)).toBe('Intro\n![[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.pdf]]\n');
    const deck = mount('[[');
    await pick(deck, 2);
    expect(text(deck)).toBe('[[Decks/Gob deck.pptx|Gob deck.pptx]]');
  });

  it('writes a plain link with Option+Enter, even on an empty line', () => {
    expect(pickedText(ROWS[0].entry, DOC, true, true).text).toBe('[[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.pdf]]');
    expect(pickedText(ROWS[0].entry, DOC, true, false).text).toBe('![[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.pdf]]');
  });

  it('opens on typing [[ in a page and takes Option+Enter as a link', async () => {
    const view = mount('Intro\n');
    act(() => { view.dispatch({ changes: { from: 6, insert: '[[' }, selection: { anchor: 8 }, userEvent: 'input.type' }); });
    await waitFor(() => expect(completionStatus(view.state)).toBe('active'), { timeout: 2000 });
    await waitFor(() => expect(currentCompletions(view.state)).toHaveLength(3));
    // The picker takes keys once it has shown for a moment, so a fast Enter still types.
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true }), 'editor'); });
    expect(text(view)).toBe('Intro\n[[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.pdf]]');
  });
});

describe('the [[ picker in tables, code and odd names', () => {
  const cells = (view: EditorView) => {
    const counts: number[] = [];
    syntaxTree(view.state).iterate({ enter: (node) => { if (node.name === 'TableRow' || node.name === 'TableHeader') counts.push(node.node.getChildren('TableCell').length); } });
    return counts;
  };

  it('writes the alias pipe as \\| in a table cell, for a note and for a file', async () => {
    const doc = '| Doc | Owner |\n| --- | --- |\n| [[ | Cody |\n';
    const note = mount(doc, doc.indexOf('[[') + 2);
    await pick(note, 1);
    expect(text(note)).toBe('| Doc | Owner |\n| --- | --- |\n| [[Projects/Roadmap.mdo\\|Roadmap]] | Cody |\n');
    expect(cells(note)).toEqual([2, 2]);
    const file = mount(doc, doc.indexOf('[[') + 2);
    await pick(file, 2);
    expect(text(file)).toBe('| Doc | Owner |\n| --- | --- |\n| [[Decks/Gob deck.pptx\\|Gob deck.pptx]] | Cody |\n');
    expect(cells(file)).toEqual([2, 2]);
  });

  it('stays closed inside a code block and inline code', async () => {
    for (const doc of ['```python\nrows = [[\n```\n', '    rows = [[\n', 'See `a[[` here\n', '```sh\nif [[ -f x\n```\n']) {
      const view = mount(doc, doc.indexOf('[[') + 2);
      expect(await linkCompletions(new CompletionContext(view.state, view.state.selection.main.head, true))).toBeNull();
    }
  });

  it('writes a stored file\'s name without its hash, in the row and in the link', async () => {
    const view = mount('See [[ today', 6);
    const result = await pick(view, 0);
    expect(result.options[0].label).toBe('q3.pdf');
    expect(text(view)).toBe('See [[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.pdf]] today');
  });

  it('names a stored file as this page already shows it, in the row and in the link', async () => {
    const stored = '[[Library/files/2026-11/q3.a3f9c2e1.pdf|Q3 report.pdf]]';
    const view = mount(`${stored}\nSee [[ today`, stored.length + 7);
    act(() => { view.dispatch({ effects: linksResolved.of({ 'Library/files/2026-11/q3.a3f9c2e1.pdf': '/Vault/Library/files/2026-11/q3.a3f9c2e1.pdf' }) }); });
    const result = await pick(view, 0);
    expect(result.options[0].label).toBe('Q3 report.pdf');
    expect(text(view)).toBe(`${stored}\nSee [[Library/files/2026-11/q3.a3f9c2e1.pdf|Q3 report.pdf]] today`);
  });

  it('writes a note whose name holds # as a Markdown link', () => {
    const entry = { path: '/Vault/Projects/PR #12 notes.md', name: 'PR #12 notes.md' };
    expect(pickedText(entry, DOC, false, false).text).toBe('[PR #12 notes](<../Projects/PR %2312 notes.md>)');
  });
});

describe('the link form\'s address field', () => {
  it('lists the same matches and writes a picked file\'s address relative to the page', async () => {
    const view = mount('Read this now\n', 0);
    act(() => { view.dispatch({ selection: { anchor: 5, head: 9 }, effects: setLinkEditor.of({ from: 5, to: 9, editing: true }) }); });
    render(<TooltipProvider><LinkPopover view={view} editor={{ from: 5, to: 9, editing: true }} /></TooltipProvider>);
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'gob' } });
    const list = await screen.findByTestId('link-address-matches');
    expect(queries.at(-1)?.filters).toContainEqual({ field: 'name', op: 'matches', value: 'gob' });
    fireEvent.click(list.querySelectorAll('button')[2]);
    expect(screen.getByLabelText('Link')).toHaveValue('../Decks/Gob%20deck.pptx');
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://example.com' } });
    await waitFor(() => expect(screen.queryByTestId('link-address-matches')).toBeNull());
  });
});
