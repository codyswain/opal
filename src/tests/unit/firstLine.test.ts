import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { moveLineUp, undo } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions, replaceText } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { opensAsProperties, setFileProperties } from '@/renderer/features/disk-explorer/components/editor/firstLine';

const DOC = '/Vault/Notes/Plan.mdo';

let views: EditorView[] = [];

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
});

function mount(doc: string, anchor = 0, head = anchor) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor, head }, extensions: markdownEditorExtensions(DOC) }) });
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

describe('a document\'s first line', () => {
  it('tells a body that would open as properties', () => {
    expect(opensAsProperties(EditorState.create({ doc: '---\nOwner: Cody\n---\nText' }).doc)).toBe(true);
    expect(opensAsProperties(EditorState.create({ doc: '---\n---\n' }).doc)).toBe(true);
    expect(opensAsProperties(EditorState.create({ doc: '---\n- a list\n---\n' }).doc)).toBe(false);
    expect(opensAsProperties(EditorState.create({ doc: '---\nNo closing line\n' }).doc)).toBe(false);
    expect(opensAsProperties(EditorState.create({ doc: '***\nOwner: Cody\n---\n' }).doc)).toBe(false);
  });

  it('writes the rule as *** when deleting the text above it would turn it into properties, in one undo step', () => {
    const doc = 'Intro\n\n---\n\nOwner: Cody\n\n---\n\nText\n';
    const view = mount(doc, 0, 7);
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(text(view)).toBe('***\n\nOwner: Cody\n\n---\n\nText\n');
    act(() => { undo(view); });
    expect(text(view)).toBe(doc);
  });

  it('writes *** for a paste that starts with a properties block', () => {
    const view = mount('');
    act(() => { view.dispatch({ changes: { from: 0, insert: '---\nOwner: Cody\n---\nNotes' }, selection: { anchor: 25 }, userEvent: 'input.paste' }); });
    expect(text(view)).toBe('***\nOwner: Cody\n---\nNotes');
  });

  it('writes *** when a line move puts a rule first', () => {
    const doc = 'Owner: Cody\n---\n---\nmore\n';
    const view = mount(doc, 12);
    act(() => { moveLineUp(view); });
    expect(text(view)).toBe('***\nOwner: Cody\n---\nmore\n');
    act(() => { undo(view); });
    expect(text(view)).toBe(doc);
  });

  it('leaves a file with properties, and an agent\'s write, alone', () => {
    const view = mount('Intro\n\n---\nOwner: Cody\n---\n', 0, 7);
    act(() => { view.dispatch({ effects: setFileProperties.of(true) }); });
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(text(view)).toBe('---\nOwner: Cody\n---\n');
    const remote = mount('Intro\n');
    act(() => { replaceText(remote, '---\nOwner: Agent\n---\nIntro\n'); });
    expect(text(remote)).toBe('---\nOwner: Agent\n---\nIntro\n');
    act(() => { remote.dispatch({ changes: { from: 0, insert: 'x' }, annotations: Transaction.remote.of(true) }); });
    expect(text(remote).startsWith('x---')).toBe(true);
  });
});

describe('Option+Up and Option+Down', () => {
  const press = (doc: string, at: number, key: string) => {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: at }, extensions: markdownEditorExtensions('/Vault/Notes/Plan.md') }) });
    views.push(view);
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key, altKey: true }), 'editor'); });
    return text(view);
  };

  it('never moves a line into a table, code or HTML block', () => {
    const table = 'Text\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    expect(press(table, 0, 'ArrowDown')).toBe(table);
    const code = 'Intro\n```\ncode\n```\n';
    expect(press(code, 0, 'ArrowDown')).toBe(code);
    const after = '```\ncode\n```\nText\n';
    expect(press(after, after.indexOf('Text'), 'ArrowUp')).toBe(after);
  });

  it('never moves a list item away from the items nested under it, and moves lines elsewhere', () => {
    const list = '- a\n- b\n  - child\n';
    expect(press(list, list.indexOf('b'), 'ArrowUp')).toBe(list);
    expect(press('one\ntwo\n', 4, 'ArrowUp')).toBe('two\none\n');
  });
});
