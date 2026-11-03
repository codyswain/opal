import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { widthChange } from '@/renderer/features/disk-explorer/components/editor/imageFrame';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { linksResolved } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installFilesApi } from '@/tests/helpers/filesApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';
const TARGET = 'Library/files/2026-11/nest.a3f9c2e1.png';
const FILE = `/Vault/${TARGET}`;
const EMBED = `![[${TARGET}|300]]`;

let views: EditorView[] = [];

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '' }, {
    resolveLinks: vi.fn(async (_from: string, targets: string[]) => ({
      success: true as const,
      data: Object.fromEntries(targets.map((target) => [target, target === TARGET ? FILE : null])),
    })),
  });
  installFilesApi();
  toastError.mockClear();
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

/** A page with its focus as CodeMirror reads it, as the live preview tests make it, and its image drawn. */
async function mount(doc: string, page = DOC) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page) }) });
  views.push(view);
  view.focus = vi.fn();
  Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true });
  act(() => { view.contentDOM.dispatchEvent(new FocusEvent('focus')); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  await waitFor(() => expect(view.contentDOM.querySelector('.cm-md-image img')).not.toBeNull());
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const image = (view: EditorView) => view.contentDOM.querySelector('.cm-md-image img') as HTMLImageElement;

const mouse = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })); });

const key = (view: EditorView, name: string) =>
  act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: name }), 'editor'); });

describe('a selected image', () => {
  it('is framed by a click, with its four corners, keeping the loaded image', async () => {
    const view = await mount(`Intro\n${EMBED}\nAfter\n`);
    const loaded = image(view);
    mouse(loaded, 'mousedown');
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'file', from: 6, to: 6 + EMBED.length });
    expect(view.state.selection.main.head).toBe(7 + EMBED.length);
    await waitFor(() => expect(view.contentDOM.querySelectorAll('[data-file-framed] .cm-md-image-handle')).toHaveLength(4));
    expect(image(view)).toBe(loaded);
    // The caret moves off and the frame goes.
    act(() => { view.dispatch({ selection: { anchor: 2 } }); });
    expect(view.state.field(objectFrame)).toBeNull();
    await waitFor(() => expect(view.contentDOM.querySelector('[data-file-framed]')).toBeNull());
  });

  it('drags its file out of the window once framed', async () => {
    const view = await mount(`Intro\n${EMBED}\nAfter\n`);
    mouse(image(view), 'mousedown');
    await waitFor(() => expect(view.contentDOM.querySelector('[data-file-framed]')).not.toBeNull());
    // The browser's own drag starts from a framed picture (the acceptance run checks the mousedown in Chromium).
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    act(() => { image(view).dispatchEvent(drag); });
    expect(drag.defaultPrevented).toBe(true);
    expect(window.filesAPI.startDrag).toHaveBeenCalledWith(FILE);
    expect(text(view)).toBe(`Intro\n${EMBED}\nAfter\n`);
  });

  it('is stepped over whole by the arrow keys', async () => {
    const view = await mount(`Intro\n${EMBED}\nAfter\n`);
    act(() => { view.dispatch({ selection: { anchor: 6 } }); });
    key(view, 'ArrowRight');
    expect(view.state.selection.main.head).toBe(6 + EMBED.length);
    key(view, 'ArrowLeft');
    expect(view.state.selection.main.head).toBe(6);
  });

  it('keeps a plain note as it was: no frame', async () => {
    const view = await mount(`Intro\n![[${TARGET}]]\n`, NOTE);
    act(() => { view.dispatch({ selection: { anchor: 6, head: 10 + TARGET.length } }); });
    expect(view.contentDOM.querySelector('.cm-md-image-selected')).toBeNull();
  });

  it('resizes from a corner, keeping its shape, and writes only the width when the button comes up', async () => {
    const view = await mount(`Intro\n${EMBED}\nAfter\n`);
    mouse(image(view), 'mousedown');
    const frame = view.contentDOM.querySelector('.cm-md-image') as HTMLElement;
    Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 700 });
    vi.spyOn(image(view), 'getBoundingClientRect').mockReturnValue({ width: 300, height: 200 } as DOMRect);
    mouse(frame.querySelector('[data-corner="se"]') as Element, 'mousedown', { clientX: 100, clientY: 100 });
    // Down by 40 is 60 across at this shape, less than the 100 across.
    mouse(window, 'mousemove', { clientX: 200, clientY: 140 });
    expect(image(view).style.width).toBe('400px');
    expect(text(view)).toBe(`Intro\n${EMBED}\nAfter\n`);
    mouse(window, 'mouseup');
    expect(text(view)).toBe(`Intro\n![[${TARGET}|400]]\nAfter\n`);
    expect(view.state.field(objectFrame)).toMatchObject({ from: 6, to: 6 + EMBED.length });
    // A left corner grows the other way, and the column is the most it can take.
    mouse(frame.querySelector('[data-corner="nw"]') as Element, 'mousedown', { clientX: 100, clientY: 100 });
    mouse(window, 'mousemove', { clientX: -900, clientY: 100 });
    mouse(window, 'mouseup');
    expect(text(view)).toBe(`Intro\n![[${TARGET}|700]]\nAfter\n`);
    act(() => { undo(view); });
    expect(text(view)).toBe(`Intro\n![[${TARGET}|400]]\nAfter\n`);
  });

  it('writes a width where none was, and leaves an alias that is not a size alone', () => {
    const state = EditorState.create({
      doc: `![[${TARGET}]] ![Plan|300](plan.png) ![Plan](plan.png) ![[${TARGET}|caption]]`,
      extensions: markdownEditorExtensions(DOC),
    }).update({ effects: linksResolved.of({ [TARGET]: FILE }) }).state;
    const write = (from: number) => {
      const change = widthChange(state, from, 420);
      return change && state.update({ changes: change }).state.doc.toString();
    };
    const doc = state.doc.toString();
    expect(write(0)).toBe(doc.replace(`${TARGET}]]`, `${TARGET}|420]]`));
    expect(write(doc.indexOf('![Plan|300]'))).toBe(doc.replace('Plan|300', 'Plan|420'));
    expect(write(doc.indexOf('![Plan]'))).toBe(doc.replace('![Plan](', '![Plan|420]('));
    expect(write(doc.lastIndexOf('![['))).toBeNull();
  });

  it('frames on Backspace or Delete beside it and goes on a second press, leaving a blank line; the file stays', async () => {
    const view = await mount(`Intro\n${EMBED}\nAfter\n`);
    mouse(image(view), 'mousedown');
    key(view, 'Delete');
    expect(text(view)).toBe('Intro\n\nAfter\n');
    act(() => { undo(view); });
    expect(text(view)).toBe(`Intro\n${EMBED}\nAfter\n`);
    act(() => { view.dispatch({ selection: { anchor: 6 + EMBED.length } }); });
    key(view, 'Backspace');
    expect(text(view)).toBe(`Intro\n${EMBED}\nAfter\n`);
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'file', from: 6 });
    key(view, 'Backspace');
    expect(text(view)).toBe('Intro\n\nAfter\n');
    expect(window.filesAPI.fetch).not.toHaveBeenCalled();
  });

  it('goes in one press when text shares its line', async () => {
    const view = await mount(`See ${EMBED} here\n`);
    act(() => { view.dispatch({ selection: { anchor: 4 + EMBED.length } }); });
    key(view, 'Backspace');
    expect(text(view)).toBe('See  here\n');
  });
});

describe('an image not on this Mac yet', () => {
  it('offers Download, then loads the file again under a new address', async () => {
    installFilesApi({ status: vi.fn(async () => ({ success: true as const, data: 'remote' as const })) });
    const view = await mount(`Intro\n${EMBED}\n`, NOTE);
    act(() => { image(view).dispatchEvent(new Event('error')); });
    const frame = view.contentDOM.querySelector('.cm-md-image') as HTMLElement;
    await waitFor(() => expect(frame).toHaveTextContent('Not downloaded yet'));
    expect(window.filesAPI.status).toHaveBeenCalledWith(FILE);
    const button = frame.querySelector('button') as HTMLButtonElement;
    expect(button).toHaveTextContent('Get from Mini');
    await act(async () => { button.click(); });
    expect(window.filesAPI.fetch).toHaveBeenCalledWith(FILE);
    await waitFor(() => expect(image(view)).toHaveAttribute('src', `${toOpalFileUrl(FILE)}?v=1`));
  });

  it('loads once the vault\'s sync brings the bytes to its folder', async () => {
    installFilesApi({ status: vi.fn(async () => ({ success: true as const, data: 'remote' as const })) });
    const view = await mount(`Intro\n${EMBED}\n`, NOTE);
    act(() => { image(view).dispatchEvent(new Event('error')); });
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-md-image')).toHaveTextContent('Not downloaded yet'));
    const listener = vi.mocked(window.diskAPI.onChanged).mock.calls.at(-1)?.[0];
    act(() => { listener?.({ directories: ['/Vault/Library/files/2026-11'] }); });
    await waitFor(() => expect(image(view)).toHaveAttribute('src', `${toOpalFileUrl(FILE)}?v=1`));
  });

  it('keeps Get from Mini when the download fails, and shows a missing file as a card with Locate… and Remove', async () => {
    installFilesApi({
      status: vi.fn(async () => ({ success: true as const, data: 'remote' as const })),
      fetch: vi.fn(async () => ({ success: false as const, error: 'The file store did not answer.' })),
    });
    const view = await mount(`Intro\n${EMBED}\n`, NOTE);
    act(() => { image(view).dispatchEvent(new Event('error')); });
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-md-image button')).not.toBeNull());
    const button = view.contentDOM.querySelector('.cm-md-image button') as HTMLButtonElement;
    await act(async () => { button.click(); });
    expect(toastError).toHaveBeenCalledWith('The file store did not answer.');
    expect(button).toHaveTextContent('Get from Mini');
    expect(button.disabled).toBe(false);

    installFilesApi({ status: vi.fn(async () => ({ success: true as const, data: 'missing' as const })) });
    const missing = await mount(`![[${TARGET}]]\n`, NOTE);
    act(() => { image(missing).dispatchEvent(new Event('error')); });
    await waitFor(() => expect(missing.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('File not found'));
    expect([...missing.contentDOM.querySelectorAll('.cm-file-card button')].map((control) => control.textContent)).toEqual(['Locate…', 'Remove']);
  });
});
