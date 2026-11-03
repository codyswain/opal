import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { CompletionContext, completionStatus, currentCompletions } from '@codemirror/autocomplete';
import { undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { setLinkEditor } from '@/renderer/features/disk-explorer/components/editor/docMode';
import { LinkPopover } from '@/renderer/features/disk-explorer/components/editor/LinkPopover';
import { linkCompletions, pickedText } from '@/renderer/features/disk-explorer/components/editor/linkPicker';
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
      ['q3.a3f9c2e1.pdf', 'Library/files/2026-11'],
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
    expect(text(view)).toBe('See [[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.a3f9c2e1.pdf]] today');
    act(() => { undo(view); });
    expect(text(view)).toBe('See [[ today');
    await pick(view, 1);
    expect(text(view)).toBe('See [[Projects/Roadmap.mdo|Roadmap]] today');
  });

  it('puts a file in on an empty line in its type\'s look, and swallows a closing ]] typed ahead', async () => {
    const view = mount('Intro\n[[]]\n', 8);
    await pick(view, 0);
    expect(text(view)).toBe('Intro\n![[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.a3f9c2e1.pdf]]\n');
    const deck = mount('[[');
    await pick(deck, 2);
    expect(text(deck)).toBe('[[Decks/Gob deck.pptx|Gob deck.pptx]]');
  });

  it('writes a plain link with Option+Enter, even on an empty line', () => {
    expect(pickedText(ROWS[0].entry, DOC, true, true).text).toBe('[[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.a3f9c2e1.pdf]]');
    expect(pickedText(ROWS[0].entry, DOC, true, false).text).toBe('![[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.a3f9c2e1.pdf]]');
  });

  it('opens on typing [[ in a page and takes Option+Enter as a link', async () => {
    const view = mount('Intro\n');
    act(() => { view.dispatch({ changes: { from: 6, insert: '[[' }, selection: { anchor: 8 }, userEvent: 'input.type' }); });
    await waitFor(() => expect(completionStatus(view.state)).toBe('active'), { timeout: 2000 });
    await waitFor(() => expect(currentCompletions(view.state)).toHaveLength(3));
    // The picker takes keys once it has shown for a moment, so a fast Enter still types.
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true }), 'editor'); });
    expect(text(view)).toBe('Intro\n[[Library/files/2026-11/q3.a3f9c2e1.pdf|q3.a3f9c2e1.pdf]]');
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
