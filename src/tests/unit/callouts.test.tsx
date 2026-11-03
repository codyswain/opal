import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { retypeCallout } from '@/renderer/features/disk-explorer/components/editor/callouts';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '' });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
});

function mount(doc: string, page = DOC) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page) }) });
  views.push(view);
  return view;
}

const lines = (view: EditorView) => [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent);

describe('callouts', () => {
  it('draws one grey icon per Obsidian type family, in any case, with a note\'s for an unknown type', () => {
    const view = mount('> [!WARNING] Careful\n> a\n\n> [!faq] Asked\n> b\n\n> [!custom] Mine\n> c\n\n> [!ai] AI\n> d\n', NOTE);
    expect([...view.contentDOM.querySelectorAll('[data-callout-icon]')].map((icon) => (icon as HTMLElement).dataset.calloutIcon)).toEqual(['warning', 'question', 'note', 'ai']);
    // In a note a click opens no menu, so the icon is no button.
    expect(view.contentDOM.querySelector('[data-callout-icon]')).not.toHaveAttribute('role');
  });

  it('rewrites only the type word, in its case, keeping the fold sign and title', () => {
    const state = EditorState.create({ doc: '> [!QUESTION]- Title\n> [!Note] x\n> [!note]+\n' });
    const apply = (head: number, type: string) => {
      const change = retypeCallout(state, head, type);
      return change ? state.update({ changes: change }).state.doc.line(state.doc.lineAt(head).number).text : null;
    };
    expect(apply(0, 'tip')).toBe('> [!TIP]- Title');
    expect(apply(state.doc.line(2).from, 'tip')).toBe('> [!Tip] x');
    expect(apply(state.doc.line(3).from, 'warning')).toBe('> [!warning]+');
  });

  it('starts "-" folded and "+" open, and the chevron folds and opens without writing', () => {
    const doc = '> [!tip]- Folded\n> hidden body\n\n> [!note]+ Open\n> shown body\n\n> [!info] Plain\n> always shown\n';
    const view = mount(doc);
    expect(lines(view)).not.toContain('hidden body');
    expect(lines(view)).toContain('shown body');
    const chevrons = view.contentDOM.querySelectorAll('.cm-md-callout-fold');
    expect(chevrons).toHaveLength(2);
    expect((chevrons[0] as HTMLElement).dataset.open).toBe('false');
    act(() => { chevrons[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
    expect(lines(view)).toContain('hidden body');
    act(() => { view.contentDOM.querySelectorAll('.cm-md-callout-fold')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
    expect(lines(view)).not.toContain('shown body');
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('folds and opens a callout on Cmd+Enter on its title, writing nothing', () => {
    const doc = '> [!tip]- Folded\n> hidden body\n\nAfter\n';
    const view = mount(doc);
    act(() => { view.dispatch({ selection: { anchor: doc.indexOf('Folded') + 3 } }); });
    const press = () => act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', ...(/Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }) }), 'editor'); });
    press();
    expect(lines(view)).toContain('hidden body');
    press();
    expect(lines(view)).not.toContain('hidden body');
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('opens a folded callout when a selection lands inside it, as a search match does', () => {
    const doc = '> [!tip]- Folded\n> hidden body\n';
    const view = mount(doc);
    expect(lines(view)).not.toContain('hidden body');
    act(() => { view.dispatch({ selection: { anchor: doc.indexOf('body'), head: doc.indexOf('body') + 4 } }); });
    expect(lines(view)).toContain('hidden body');
  });

  it('opens the type menu from the icon in a document and writes the picked type', async () => {
    installMarkdownApi({ [DOC]: '> [!NOTE] Title\n> body\n' });
    render(<TooltipProvider><MarkdownEditor path={DOC} /></TooltipProvider>);
    const editor = await screen.findByTestId('markdown-editor');
    const view = EditorView.findFromDOM(editor) as EditorView;
    view.focus = vi.fn();
    const icon = view.contentDOM.querySelector('[data-callout-icon]') as Element;
    expect(icon).toHaveAttribute('role', 'button');
    expect(icon).toHaveAttribute('aria-haspopup', 'menu');
    expect(icon).toHaveAttribute('aria-label', 'Callout type, Note');
    act(() => { icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('menuitemradio', { name: 'Warning' }));
    expect(view.state.doc.toString()).toBe('> [!WARNING] Title\n> body\n');
  });
});
