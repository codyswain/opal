import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { parseWikiTarget } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const PAGE = '/Vault/Notes/brief.md';
const PERSON = '/Vault/People/Robert Xu.md';

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [PAGE]: '', [PERSON]: '# Robert' });
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

function mount(doc: string, openNote = vi.fn()) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(PAGE, openNote) }) });
  views.push(view);
  return { view, openNote };
}

const lineText = (view: EditorView, startsWith: string) =>
  [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').find((text) => text.startsWith(startsWith));

/**
 * Makes the page report focus the way CodeMirror reads it, and waits for the
 * focus to reach its state. Real focus would let happy-dom fire selectionchange
 * inside CodeMirror's own updates, which browsers never do.
 */
async function focusPage(view: EditorView) {
  view.focus = vi.fn();
  Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true });
  act(() => { view.contentDOM.dispatchEvent(new FocusEvent('focus')); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

async function focusAt(view: EditorView, at: number) {
  await focusPage(view);
  act(() => { view.dispatch({ selection: { anchor: at } }); });
}

const press = (element: Element, init: MouseEventInit = {}) =>
  act(() => { element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init })); });

describe('live preview', () => {
  it('reads as rendered until the page has focus: marks hidden, headings sized, the file name as the title', () => {
    const { view } = mount('# Title\n\nSome **bold**, *italic*, `code` and a [link](https://example.com).\n');
    expect(view.contentDOM.querySelector('.cm-md-inline-title')).toHaveTextContent('brief');
    expect(view.contentDOM.querySelector('.cm-md-h1')).toHaveTextContent(/^Title$/);
    expect(lineText(view, 'Some')).toBe('Some bold, italic, code and a link.');
    expect(view.contentDOM.querySelector('.cm-md-link')).toHaveAttribute('data-href', 'https://example.com');
    expect(view.state.doc.toString()).toBe('# Title\n\nSome **bold**, *italic*, `code` and a [link](https://example.com).\n');
  });

  it('shows the Markdown as written only on the lines the selection touches', async () => {
    const { view } = mount('# Title\n\nSome **bold** text.\n');
    await focusAt(view, 12);
    expect(lineText(view, 'Some')).toBe('Some **bold** text.');
    expect(view.contentDOM.querySelector('.cm-md-h1')).toHaveTextContent(/^Title$/);
    act(() => { view.dispatch({ selection: { anchor: 3 } }); });
    expect(view.contentDOM.querySelector('.cm-md-h1')).toHaveTextContent('# Title');
    expect(lineText(view, 'Some')).toBe('Some bold text.');
  });

  it('holds the revealed lines still while the mouse button is down, so a click does not move the text under it', async () => {
    const { view } = mount('# Title\n\nSome **bold** text.\n');
    await focusAt(view, 12);
    press(view.contentDOM.querySelector('.cm-md-h1') as Element);
    act(() => { view.dispatch({ selection: { anchor: 3 }, userEvent: 'select.pointer' }); });
    expect(lineText(view, 'Some')).toBe('Some **bold** text.');
    expect(view.contentDOM.querySelector('.cm-md-h1')).toHaveTextContent(/^Title$/);
    act(() => { window.dispatchEvent(new MouseEvent('mouseup')); });
    expect(lineText(view, 'Some')).toBe('Some bold text.');
    expect(view.contentDOM.querySelector('.cm-md-h1')).toHaveTextContent('# Title');
  });

  it('draws bullets, numbers and checkboxes indented by depth, and keeps them while the caret is in the text', async () => {
    const { view } = mount('- one\n  - nested\n1. first\n- [ ] open\n- [x] done\n');
    const markers = [...view.contentDOM.querySelectorAll('.cm-md-list-marker')].map((marker) => marker.getAttribute('data-kind'));
    expect(markers).toEqual(['bullet', 'bullet', 'number', 'task', 'task']);
    const lines = [...view.contentDOM.querySelectorAll('.cm-md-list')] as HTMLElement[];
    expect(lines.map((line) => line.style.getPropertyValue('--list-indent'))).toEqual(['1.5em', '3em', '1.5em', '1.5em', '1.5em']);
    expect(lineText(view, '1.')).toBe('1.first');
    expect(view.contentDOM.querySelector('.cm-md-task-done')).toHaveTextContent('done');
    await focusAt(view, 4);
    expect(view.contentDOM.querySelectorAll('.cm-md-list-marker')).toHaveLength(5);
    act(() => { view.dispatch({ selection: { anchor: 1 } }); });
    expect(lineText(view, '- one')).toBe('- one');
  });

  it('toggles a task by writing [x] and [ ] in place, without focusing the page', () => {
    const { view } = mount('- [ ] open\n> - [x] in a callout\n');
    const [open, quoted] = view.contentDOM.querySelectorAll('.cm-md-task');
    press(open);
    expect(view.state.doc.toString()).toBe('- [x] open\n> - [x] in a callout\n');
    press(quoted);
    expect(view.state.doc.toString()).toBe('- [x] open\n> - [ ] in a callout\n');
    expect(view.hasFocus).toBe(false);
  });

  it('draws a callout as a box with its title, an [!ai] one with the bot icon, and plain quotes with a rule', () => {
    const { view } = mount('> [!ai] AI\n> Text the agent wrote.\n\n> [!note]\n> Body.\n\n> Plain quote\n');
    const callouts = [...view.contentDOM.querySelectorAll('.cm-md-callout')];
    expect(callouts.map((line) => line.getAttribute('data-callout'))).toEqual(['ai', 'ai', 'note', 'note']);
    expect(callouts[0]).toHaveClass('cm-md-callout-first');
    expect(callouts[1]).toHaveClass('cm-md-callout-last');
    expect(callouts[0].textContent).toBe('AI');
    expect(callouts[0].querySelector('.cm-md-callout-icon svg')).not.toBeNull();
    expect(callouts[1].textContent).toBe('Text the agent wrote.');
    expect(callouts[2].querySelector('.cm-md-callout-title')).toHaveTextContent('Note');
    expect(callouts[2].querySelector('.cm-md-callout-icon')).toBeNull();
    expect(view.contentDOM.querySelector('.cm-md-quote')).toHaveTextContent(/^Plain quote$/);
  });

  it('draws a table with its alignment and cell markup, and a click shows its source with the caret in the cell', async () => {
    const doc = 'Before\n\n| Left | Right |\n|:--|--:|\n| a | **b** [[Robert Xu]] |\n|  | c |\n';
    const { view } = mount(doc);
    const table = view.contentDOM.querySelector('.cm-md-table table') as HTMLTableElement;
    expect([...table.querySelectorAll('th')].map((cell) => [cell.textContent, cell.style.textAlign])).toEqual([['Left', 'left'], ['Right', 'right']]);
    expect([...table.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['a', 'b Robert Xu', '', 'c']);
    expect(table.querySelector('strong')).toHaveTextContent('b');
    expect(table.querySelector('[data-wiki-target="Robert Xu"]')).not.toBeNull();
    view.focus = vi.fn();
    press(table.querySelectorAll('td')[1]);
    expect(view.focus).toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(doc.indexOf('**b**'));
    await focusPage(view);
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    expect(view.contentDOM.querySelectorAll('.cm-md-table-source')).toHaveLength(4);
  });

  it('draws fenced code as a block without its fences or list indent, and puts the caret on the clicked line', async () => {
    const doc = '- item\n  ```\n  first line\n    indented\n  ```\n';
    const { view } = mount(doc);
    const block = view.contentDOM.querySelector('.cm-md-codeblock-widget') as HTMLElement;
    const lines = [...block.querySelectorAll('[data-offset]')];
    expect(lines.map((line) => line.textContent)).toEqual(['first line', '  indented']);
    expect(block.style.getPropertyValue('--list-indent')).toBe('1.5em');
    view.focus = vi.fn();
    press(lines[1]);
    expect(view.state.selection.main.head).toBe(doc.indexOf('  indented'));
    await focusPage(view);
    expect(view.contentDOM.querySelectorAll('.cm-md-codeblock')).toHaveLength(4);
  });

  it('draws images from the page\'s folder, the web, and resolved ![[embeds]]', async () => {
    installMarkdownApi({ [PAGE]: '' }, {
      resolveLinks: vi.fn(async (_from: string, targets: string[]) => ({
        success: true as const,
        data: Object.fromEntries(targets.map((target) => [target, target === 'photo.png' ? '/Vault/Media/photo.png' : null])),
      })),
    });
    const { view } = mount('![Plan|300](../media/plan%20v2.png)\n![](https://example.com/a.png)\n![[photo.png]]\n');
    const images = () => [...view.contentDOM.querySelectorAll('.cm-md-image img')] as HTMLImageElement[];
    expect(images().map((image) => image.getAttribute('src'))).toEqual([toOpalFileUrl('/Vault/media/plan v2.png'), 'https://example.com/a.png']);
    expect(images()[0]).toHaveAttribute('alt', 'Plan');
    expect(images()[0].style.width).toBe('300px');
    await waitFor(() => expect(images()).toHaveLength(3));
    expect(images()[2]).toHaveAttribute('src', toOpalFileUrl('/Vault/Media/photo.png'));
  });

  it('shows wiki links by name or alias, fades links to nothing, and opens the note on click', async () => {
    const { view, openNote } = mount('See [[Robert Xu]], [[robert xu|Robert]] and [[Nobody]].\n');
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-md-unresolved')).toHaveTextContent('Nobody'));
    expect(window.markdownAPI.resolveLinks).toHaveBeenCalledWith(PAGE, ['Robert Xu', 'robert xu', 'Nobody']);
    expect(lineText(view, 'See')).toBe('See Robert Xu, Robert and Nobody.');
    press(view.contentDOM.querySelectorAll('.cm-md-wikilink')[1]);
    await waitFor(() => expect(openNote).toHaveBeenCalledWith(PERSON));
    expect(view.hasFocus).toBe(false);
  });

  it('creates a note that a link names but that does not exist yet, at the top of the opened folder', async () => {
    const { view, openNote } = mount('Meet [[New Person]].\n');
    press(view.contentDOM.querySelector('.cm-md-wikilink') as Element);
    await waitFor(() => expect(openNote).toHaveBeenCalledWith('/Vault/New Person.md'));
    expect(window.markdownAPI.create).toHaveBeenCalledWith('/Vault', 'New Person');
  });

  it('opens an external link in the browser on Cmd+click only', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { view } = mount('A [link](https://example.com) and https://bare.example.\n');
    const [link, bare] = view.contentDOM.querySelectorAll('.cm-md-link');
    // A plain click is CodeMirror's to handle; keep happy-dom's focus out of it.
    view.contentDOM.focus = vi.fn();
    press(link);
    expect(open).not.toHaveBeenCalled();
    press(link, { metaKey: true });
    press(bare, { metaKey: true });
    expect(open.mock.calls.map(([href]) => href)).toEqual(['https://example.com', 'https://bare.example']);
    open.mockRestore();
  });

  it('draws rules and hides the indent of indented code', () => {
    const { view } = mount('Above\n\n---\n\n    indented code\n');
    expect(view.contentDOM.querySelector('.cm-md-hr')).not.toBeNull();
    expect(view.contentDOM.querySelector('.cm-md-codeblock')).toHaveTextContent(/^indented code$/);
  });
});

describe('parseWikiTarget', () => {
  it('splits the target, heading and alias, including a pipe escaped for a table', () => {
    expect(parseWikiTarget('Robert Xu')).toEqual({ target: 'Robert Xu', heading: null, aliasAt: null });
    expect(parseWikiTarget('Library/people/Ahmed Ahmed#Relationship|Ahmed')).toEqual({ target: 'Library/people/Ahmed Ahmed', heading: 'Relationship', aliasAt: 40 });
    expect(parseWikiTarget('Robert Xu\\|Robert')).toEqual({ target: 'Robert Xu', heading: null, aliasAt: 11 });
    expect(parseWikiTarget('#Only a heading')).toEqual({ target: '', heading: 'Only a heading', aliasAt: null });
  });
});
