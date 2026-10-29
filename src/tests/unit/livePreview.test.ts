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

function mount(doc: string, openNote = vi.fn(), page = PAGE) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page, openNote) }) });
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

const key = (view: EditorView, name: string) =>
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); });

/** Whether a character at `at` sits inside a muted syntax span. */
const muted = (view: EditorView, at: number) => {
  const { node, offset } = view.domAtPos(at + 1);
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node.childNodes[offset - 1] as Element | undefined)?.parentElement;
  return Boolean(element?.closest('.cm-md-syntax'));
};

describe('live preview', () => {
  it('reads as rendered until the page has focus: marks hidden, headings sized, the file name as the title', () => {
    const { view } = mount('# Title\n\nSome **bold**, *italic*, `code` and a [link](https://example.com).\n');
    expect(view.contentDOM.querySelector('.cm-md-inline-title')).toHaveTextContent('brief');
    expect(view.contentDOM.querySelector('.cm-md-h1')).toHaveTextContent(/^Title$/);
    expect(lineText(view, 'Some')).toBe('Some bold, italic, code and a link.');
    expect(view.contentDOM.querySelector('.cm-md-link')).toHaveAttribute('data-href', 'https://example.com');
    expect(view.state.doc.toString()).toBe('# Title\n\nSome **bold**, *italic*, `code` and a [link](https://example.com).\n');
  });

  it('shows inline marks as written only where the selection touches them, and heading marks on their line', async () => {
    const { view } = mount('# Title\n\nSome **bold** text and a [link](https://example.com).\n');
    await focusAt(view, 10);
    expect(lineText(view, 'Some')).toBe('Some bold text and a link.');
    act(() => { view.dispatch({ selection: { anchor: 17 } }); });
    expect(lineText(view, 'Some')).toBe('Some **bold** text and a link.');
    expect(view.contentDOM.querySelector('.cm-md-h1')).toHaveTextContent(/^Title$/);
    act(() => { view.dispatch({ selection: { anchor: 3 } }); });
    expect(view.contentDOM.querySelector('.cm-md-h1')).toHaveTextContent('# Title');
    expect(lineText(view, 'Some')).toBe('Some bold text and a link.');
  });

  it('keeps "> " hidden until the caret is in it, and never reveals a read-only log', async () => {
    const { view } = mount('> Quoted text\n');
    await focusAt(view, 2);
    expect(lineText(view, 'Quoted')).toBe('Quoted text');
    act(() => { view.dispatch({ selection: { anchor: 0 } }); });
    expect(lineText(view, '>')).toBe('> Quoted text');
    const log = '# Day\n\n## Activity Log\n\n- 10:00 Edited **the plan** with [[Robert Xu]]\n';
    const daily = mount(log, vi.fn(), '/Vault/Inbox/Logs/2026-10-28.md').view;
    await focusAt(daily, log.indexOf('the plan'));
    expect(lineText(daily, '10:00')).toBe('10:00 Edited the plan with Robert Xu');
    act(() => { daily.dispatch({ selection: { anchor: log.indexOf('Activity') } }); });
    expect(daily.contentDOM.querySelector('.cm-md-h2')).toHaveTextContent(/^Activity Log$/);
    const line = '- 10:00 Edited **the plan** with [[Robert Xu]] · agent turn\n';
    const { view: page, openNote } = mount(line, vi.fn(), '/Vault/Library/logs/2026-10-28 log.md');
    await focusAt(page, line.indexOf('the plan'));
    expect(lineText(page, '10:00')).toBe('10:00 Edited the plan with Robert Xu · agent turn');
    // Its links still open their notes.
    press(page.contentDOM.querySelector('.cm-md-wikilink') as Element);
    await waitFor(() => expect(openNote).toHaveBeenCalledWith(PERSON));
  });

  it('holds the revealed lines still while the mouse button is down, so a click does not move the text under it', async () => {
    const { view } = mount('# Title\n\nSome **bold** text.\n');
    await focusAt(view, 17);
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

  it('draws a table with its alignment and cell markup; a click marks the cell, Enter or a double-click shows the source', async () => {
    const doc = 'Before\n\n| Left | Right |\n|:--|--:|\n| a | **b** [[Robert Xu]] |\n|  | c |\n';
    const { view } = mount(doc);
    const cells = () => [...view.contentDOM.querySelectorAll('.cm-md-table td')];
    const table = view.contentDOM.querySelector('.cm-md-table table') as HTMLTableElement;
    expect([...table.querySelectorAll('th')].map((cell) => [cell.textContent, cell.style.textAlign])).toEqual([['Left', 'left'], ['Right', 'right']]);
    expect(cells().map((cell) => cell.textContent)).toEqual(['a', 'b Robert Xu', '', 'c']);
    expect(table.querySelector('strong')).toHaveTextContent('b');
    expect(table.querySelector('[data-wiki-target="Robert Xu"]')).not.toBeNull();
    view.focus = vi.fn();
    press(cells()[3]);
    expect(view.focus).toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(doc.indexOf('c |'));
    await focusPage(view);
    // The table stays drawn, so nothing on the page moves.
    expect(cells()[3]).toHaveClass('cm-md-cell-caret');
    expect(view.contentDOM.querySelectorAll('.cm-md-table-source')).toHaveLength(0);
    press(cells()[0]);
    expect(cells().map((cell) => cell.classList.contains('cm-md-cell-caret'))).toEqual([true, false, false, false]);
    key(view, 'Enter');
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    expect(view.contentDOM.querySelectorAll('.cm-md-table-source')).toHaveLength(4);
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.head).toBe(doc.indexOf('a |'));
    // Leaving the table draws it again; a double-click goes straight to the source.
    act(() => { view.dispatch({ selection: { anchor: 0 } }); });
    press(cells()[1], { detail: 2 });
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull();
    expect(view.state.selection.main.head).toBe(doc.indexOf('**b**'));
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

  it('opens web and mail links in the default app on a click, and only on Cmd+click while they show as written', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const doc = 'A [link](https://example.com), https://bare.example, www.example.org and robert@ishikilabs.ai.\n';
    const { view } = mount(doc);
    const links = () => [...view.contentDOM.querySelectorAll('.cm-md-link')];
    for (const link of links()) press(link);
    expect(open.mock.calls.map(([href]) => href)).toEqual(['https://example.com', 'https://bare.example', 'https://www.example.org', 'mailto:robert@ishikilabs.ai']);
    open.mockClear();
    // With the caret in the link, a click edits it.
    view.contentDOM.focus = vi.fn();
    await focusAt(view, doc.indexOf('link]'));
    press(links()[0]);
    expect(open).not.toHaveBeenCalled();
    press(links()[0], { metaKey: true });
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank');
    open.mockRestore();
  });

  it('opens a link to a note by its path, relative to the page, in Opal', async () => {
    const resolveLinks = vi.fn(async (_from: string, targets: string[]) => ({
      success: true as const,
      data: Object.fromEntries(targets.map((target) => [target, target === '../People/Robert Xu.md' ? PERSON : null])),
    }));
    installMarkdownApi({ [PAGE]: '' }, { resolveLinks });
    const { view, openNote } = mount('See [Robert](../People/Robert%20Xu.md#Notes) and [gone](missing.md).\n');
    const [robert] = view.contentDOM.querySelectorAll('.cm-md-link');
    press(robert);
    await waitFor(() => expect(openNote).toHaveBeenCalledWith(PERSON));
    expect(resolveLinks).toHaveBeenCalledWith(PAGE, ['../People/Robert Xu.md']);
  });

  it('keeps bracketed text that is no link as written, brackets and all', async () => {
    const doc = 'Waiting on [needs Cody] per [N §9], a note[^1] and [x] marks.\n\n- [-] cancelled task\n\n[^1]: The footnote.\n';
    const { view } = mount(doc);
    expect(view.contentDOM.querySelector('.cm-md-link')).toBeNull();
    expect(lineText(view, 'Waiting')).toBe('Waiting on [needs Cody] per [N §9], a note[^1] and [x] marks.');
    expect(lineText(view, '[^1]')).toBe('[^1]: The footnote.');
    expect(muted(view, doc.indexOf('[needs'))).toBe(false);
    expect(view.contentDOM.querySelector('.cm-md-list')?.textContent).toBe('[-] cancelled task');
    const callout = mount('> [!ai] AI\n> Text.\n').view;
    await focusAt(callout, 4);
    expect(callout.contentDOM.querySelector('.cm-md-link')).toBeNull();
  });

  it('follows reference links and images to their definitions, and shortens a long definition', () => {
    const data = `data:image/png;base64,${'A'.repeat(400)}`;
    const doc = `Read [the spec][Spec], [Spec][] or [spec].\n\n![][image1]\n\n[spec]: https://example.com/spec "Spec"\n[image1]: <${data}>\n`;
    const { view } = mount(doc);
    expect([...view.contentDOM.querySelectorAll('.cm-md-link')].map((link) => [link.textContent, link.getAttribute('data-href')])).toEqual([
      ['the spec', 'https://example.com/spec'], ['Spec', 'https://example.com/spec'], ['spec', 'https://example.com/spec'],
    ]);
    expect(lineText(view, 'Read')).toBe('Read the spec, Spec or spec.');
    expect(view.contentDOM.querySelector('.cm-md-image img')).toHaveAttribute('src', data);
    const definition = lineText(view, '[image1]') ?? '';
    expect(definition.length).toBeLessThan(80);
    expect(definition).toMatch(/^\[image1\]: <data:image\/png;base64,A+…$/);
    expect(muted(view, doc.indexOf('[spec]:'))).toBe(true);
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
