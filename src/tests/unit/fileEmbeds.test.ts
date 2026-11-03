import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { undo } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import {
  captionOf,
  clearFileInfo,
  fileInfo,
  fileRefOf,
  lookOf,
  namesFile,
  readAddress,
  shownName,
  type FileRef,
} from '@/renderer/features/disk-explorer/components/editor/fileEmbeds';
import { objectFrame } from '@/renderer/features/disk-explorer/components/editor/objectFrame';
import { objectKinds } from '@/renderer/features/disk-explorer/components/editor/extensionPoints';
import { linksResolved, resolvedLinks } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installFilesApi } from '@/tests/helpers/filesApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import type { FileInfo, FileInfoStatus } from '@/types/files';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';
const PDF = 'Library/files/2026-11/q3-report.a3f9c2e1.pdf';
const DECK = 'Library/files/2026-11/gob-deck.a3f9c2e1.pptx';
const CLIP = 'Library/files/2026-11/clip.a3f9c2e1.mp4';
const MEMO = 'Library/files/2026-11/memo.a3f9c2e1.m4a';
const SHOT = 'Library/files/2026-11/shot.a3f9c2e1.png';
const FILES = [PDF, DECK, CLIP, MEMO, SHOT];

let views: EditorView[] = [];
let statuses: Record<string, FileInfoStatus> = {};

function info(target: string): FileInfo {
  const name = target.slice(target.lastIndexOf('/') + 1);
  const pdf = name.endsWith('.pdf');
  const video = name.endsWith('.mp4');
  return {
    path: target, name, size: 9_100_000, mtimeMs: 0, kind: pdf ? 'pdf' : video ? 'video' : 'other',
    status: statuses[target] ?? 'local',
    ...(pdf ? { pages: 15 } : {}),
    ...(video ? { width: 1920, height: 1080, duration: 42 } : {}),
  };
}

beforeEach(() => {
  statuses = {};
  clearFileInfo();
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [DOC]: '', [NOTE]: '' }, {
    resolveLinks: vi.fn(async (_from: string, targets: string[]) => ({
      success: true as const,
      data: Object.fromEntries(targets.map((target) => [target, FILES.includes(target) ? `/Vault/${target}` : null])),
    })),
  });
  installFilesApi({
    info: vi.fn(async (target: string) => ({ success: true as const, data: info(target) })),
    appName: vi.fn(async () => ({ success: true as const, data: 'Keynote' })),
  });
  toastError.mockClear();
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
});

const resolved = Object.fromEntries(FILES.map((target) => [target, `/Vault/${target}`]));

async function mount(doc: string, page = DOC) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(page) }) });
  view.focus = vi.fn();
  views.push(view);
  act(() => { view.dispatch({ effects: linksResolved.of(resolved) }); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const key = (view: EditorView, name: string, init: KeyboardEventInit = {}) =>
  act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: name, ...init }), 'editor'); });
/** A key as the browser sends it, which the frame's own handler reads. */
const press = (view: EditorView, name: string) =>
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); });

/** The file links in `doc`, read as a page at DOC with every fixture file resolved. */
function refs(doc: string, page = DOC): FileRef[] {
  const state = EditorState.create({ doc, extensions: markdownEditorExtensions(page) }).update({ effects: linksResolved.of(resolved) }).state;
  const found: FileRef[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!['Embed', 'WikiLink', 'Image', 'Link'].includes(node.name)) return;
      const ref = fileRefOf(state, node.node, state.field(resolvedLinks), page);
      if (ref) found.push(ref);
      return false;
    },
  });
  return found;
}

describe('reading file links', () => {
  it('gives each its look: a chip in text, a card alone on its line, a preview for embeds of images, PDF, video and audio', () => {
    const doc = [
      `See [[${PDF}|Q3 report]] today.`,
      `[[${DECK}|Gob deck.pptx]]`,
      `![[${PDF}|Q3 report.pdf]]`,
      `![[${DECK}]]`,
      `![[${CLIP}|640]]`,
      `![[${MEMO}]]`,
      `- [[${DECK}|In a list]]`,
      `| a | [[${DECK}\\|cell]] |`,
      '|---|---|',
    ].join('\n');
    expect(refs(doc).map((ref) => [shownName(ref), lookOf(ref)])).toEqual([
      ['Q3 report', 'chip'],
      ['Gob deck.pptx', 'card'],
      ['Q3 report.pdf', 'preview'],
      ['gob-deck.pptx', 'card'],
      ['clip.mp4', 'preview'],
      ['memo.m4a', 'preview'],
      ['In a list', 'chip'],
      ['cell', 'chip'],
    ]);
  });

  it('reads Markdown-form video, audio and PDF with relative paths as previews, and leaves notes and web pages as links', () => {
    const doc = [
      '![The rig at night](assets/clip.mp4)',
      '![](../assets/q3.pdf#page=3)',
      '[Recording](assets/memo%20one.m4a)',
      '[A note](plan.md)',
      '[A site](https://example.com)',
      '![web](https://example.com/a.png)',
    ].join('\n');
    const found = refs(doc);
    expect(found.map((ref) => [ref.form, ref.kind, lookOf(ref), ref.path])).toEqual([
      ['image', 'video', 'preview', '/Vault/Notes/assets/clip.mp4'],
      ['image', 'pdf', 'preview', '/Vault/assets/q3.pdf'],
      ['link', 'audio', 'card', '/Vault/Notes/assets/memo one.m4a'],
    ]);
    expect(found[1].fragment).toBe('page=3');
  });

  it('draws a YouTube or Loom address embedded as a picture as a video card, and as a chip in text', () => {
    const found = refs('![](https://www.youtube.com/watch?v=abc)\nWatch [this](https://loom.com/share/x) now.\n');
    expect(found.map((ref) => [lookOf(ref), shownName(ref)])).toEqual([['card', 'YouTube video'], ['chip', 'this']]);
  });

  it('decodes each segment of an address, so %23 is a # in a name and a bare # starts the fragment', () => {
    expect(readAddress('<Library/files/a%2523b%23c.pdf#page=2>', DOC)).toEqual({ path: '/Vault/Notes/Library/files/a%23b#c.pdf', fragment: 'page=2' });
    expect(readAddress('<x\\<y\\>.pdf>', DOC).path).toBe('/Vault/Notes/x<y>.pdf');
    expect(readAddress('/Vault/a b.pdf', DOC).path).toBe('/Vault/a b.pdf');
  });

  it('shows alt text as a caption unless it is empty, "image" or a file name', () => {
    const doc = ['![The rig at night](a.mp4)', '![](a.mp4)', '![image](a.png)', '![clip.mp4](a/clip.mp4)', '![IMG_2041.JPG](b.jpg)', '![Q3|300](q.png)'].join('\n');
    expect(refs(doc).map(captionOf)).toEqual(['The rig at night', null, null, null, null, 'Q3']);
  });

  it('names a missing link a file by its type, so it is a file and not a note to create', () => {
    expect(['deck.pptx', 'model.stl', 'a.zip', 'x.excalidraw', 'b.canvas', 'shot.png', 'notes.txt'].every(namesFile)).toBe(true);
    expect(['v0.2', 'Meeting 10.30', 'Plan', 'Plan.mdo', 'Plan.md'].some(namesFile)).toBe(false);
  });
});

describe('file widgets', () => {
  it('draws a chip, a card with kind and size, and a PDF preview with its page count, never showing the Markdown', async () => {
    const view = await mount(`See [[${PDF}|Q3 report]] today.\n[[${DECK}|Gob deck.pptx]]\n![[${PDF}|Q3 report.pdf]]\n`);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('PowerPoint · 9.1 MB'));
    expect(view.contentDOM.querySelector('.cm-file-chip')).toHaveTextContent('Q3 report');
    expect(view.contentDOM.querySelector('.cm-file-chip')).toHaveAttribute('aria-label', 'PDF, Q3 report');
    expect(view.contentDOM.querySelector('.cm-file-card')).toHaveAttribute('role', 'group');
    expect(view.contentDOM.querySelector('.cm-file-card')).toHaveAttribute('aria-label', 'PowerPoint, Gob deck.pptx');
    expect(view.contentDOM.querySelector('.cm-file-pdf')).toHaveAttribute('aria-label', 'PDF, Q3 report.pdf');
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-pdf-footer')).toHaveTextContent('Q3 report.pdf15 pages · 9.1 MB'));
    expect(view.contentDOM.textContent).not.toContain('[[');
    expect(view.contentDOM.textContent).not.toContain('a3f9c2e1');
  });

  it('says a file is not downloaded and gets it from the Mini', async () => {
    statuses[`/Vault/${DECK}`] = 'lfs-missing';
    const view = await mount(`[[${DECK}|Gob deck.pptx]]\n`);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('Not downloaded yet'));
    statuses = {};
    const control = view.contentDOM.querySelector('.cm-file-card button') as HTMLButtonElement;
    expect(control).toHaveTextContent('Get from Mini');
    await act(async () => { control.click(); });
    expect(window.filesAPI.fetch).toHaveBeenCalledWith(`/Vault/${DECK}`);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('PowerPoint · 9.1 MB'));
  });

  it('draws a picture that is not on this Mac as the Not-downloaded card, before and after its bytes fail to load', async () => {
    statuses[`/Vault/${SHOT}`] = 'lfs-missing';
    installFilesApi({
      info: vi.fn(async (target: string) => ({ success: true as const, data: info(target) })),
      status: vi.fn(async () => ({ success: true as const, data: 'remote' as const })),
    });
    // Known before the page draws: a card from the start.
    await act(async () => { await fileInfo(`/Vault/${SHOT}`); });
    const known = await mount(`![[${SHOT}|480]]\n`);
    expect(known.contentDOM.querySelector('.cm-md-image img')).toBeNull();
    expect(known.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('Not downloaded yet');
    // Found out when the picture fails to load: the same card, not a line of text.
    clearFileInfo();
    const late = await mount(`![[${SHOT}|480]]\n`);
    const image = late.contentDOM.querySelector('.cm-md-image img');
    if (image) await act(async () => { image.dispatchEvent(new Event('error')); });
    await waitFor(() => expect(late.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('Not downloaded yet'));
    expect(late.contentDOM.querySelector('.cm-md-image-remote')).toBeNull();
    expect(late.contentDOM.querySelector('.cm-file-card button')).toHaveTextContent('Get from Mini');
  });

  it('says a file is gone, with Locate… and Remove, and Remove takes the link off the page in one undo step', async () => {
    const view = await mount(`Intro\n![[Library/files/2026-11/gone.a3f9c2e1.pdf]]\nAfter\n`);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('File not found'));
    const buttons = [...view.contentDOM.querySelectorAll<HTMLButtonElement>('.cm-file-card button')];
    expect(buttons.map((control) => control.textContent)).toEqual(['Locate…', 'Remove']);
    act(() => { buttons[1].click(); });
    expect(text(view)).toBe('Intro\n\nAfter\n');
    act(() => { undo(view); });
    expect(text(view)).toBe('Intro\n![[Library/files/2026-11/gone.a3f9c2e1.pdf]]\nAfter\n');
  });

  it('marks a moved file and updates its link only when Update link is picked', async () => {
    const moved = '/Vault/Library/files/2026-10/q3.a3f9c2e1.pdf';
    installFilesApi({
      info: vi.fn(async (target: string) => ({ success: true as const, data: { ...info(target), status: 'missing' as const } })),
      findMoved: vi.fn(async () => ({ success: true as const, data: moved })),
    });
    const view = await mount('![Q3](assets/q3.a3f9c2e1.pdf)\n');
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('Moved'));
    expect(text(view)).toBe('![Q3](assets/q3.a3f9c2e1.pdf)\n');
    act(() => { (view.contentDOM.querySelector('.cm-file-card button') as HTMLButtonElement).click(); });
    expect(text(view)).toBe('![Q3](<../Library/files/2026-10/q3.a3f9c2e1.pdf>)\n');
  });

  it('plays Markdown-form video at its known shape, with its caption, and says when Opal can\'t play it', async () => {
    const view = await mount('![The rig at night](assets/clip.mp4)\n');
    await waitFor(() => expect(view.contentDOM.querySelector('video')).not.toBeNull());
    const video = view.contentDOM.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(toOpalFileUrl('/Vault/Notes/assets/clip.mp4'));
    expect((view.contentDOM.querySelector('.cm-file-video') as HTMLElement).style.aspectRatio).toBe('1920 / 1080');
    expect(view.contentDOM.querySelector('.cm-file-caption')).toHaveTextContent('The rig at night');
    Object.defineProperty(video, 'error', { value: { code: 4 } });
    act(() => { video.dispatchEvent(new Event('error')); });
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-card')).toHaveTextContent("Can't play this video in Opal"));
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-card button')).toHaveTextContent('Open in Keynote'));
  });

  it('keeps a player across a redraw of its line', async () => {
    const view = await mount(`![[${CLIP}|640]]\n\ntext\n`);
    await waitFor(() => expect(view.contentDOM.querySelector('video')).not.toBeNull());
    const first = view.contentDOM.querySelector('video');
    // An edit elsewhere and a viewport change leave the same element.
    act(() => { view.dispatch({ changes: { from: text(view).length, insert: 'more' } }); });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(view.contentDOM.querySelector('video')).toBe(first);
  });

  it('reads a PDF in place with Read here, one viewer in the window, until Done or Escape', async () => {
    const view = await mount(`![[${PDF}|Q3.pdf]]\n\n![[${PDF}#page=3|Q3 again.pdf]]\n`);
    await waitFor(() => expect(view.contentDOM.querySelectorAll('.cm-file-pdf-read')).toHaveLength(2));
    const [first, second] = [...view.contentDOM.querySelectorAll<HTMLButtonElement>('.cm-file-pdf-read')];
    act(() => { first.click(); });
    const viewer = view.contentDOM.querySelector('.cm-file-pdf-viewer');
    expect(viewer).toHaveAttribute('src', `${toOpalFileUrl(`/Vault/${PDF}`)}#toolbar=0&view=FitH`);
    act(() => { second.click(); });
    expect(view.contentDOM.querySelectorAll('.cm-file-pdf-viewer')).toHaveLength(1);
    expect(view.contentDOM.querySelector('.cm-file-pdf-viewer')).toHaveAttribute('src', expect.stringContaining('&page=3'));
    // Escape in a menu or anywhere outside the page is left to it.
    const menu = document.createElement('button');
    document.body.append(menu);
    const reached = vi.fn();
    menu.addEventListener('keydown', reached);
    act(() => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(reached).toHaveBeenCalled();
    expect(view.contentDOM.querySelector('.cm-file-pdf-viewer')).not.toBeNull();
    menu.remove();
    act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(view.contentDOM.querySelector('.cm-file-pdf-viewer')).toBeNull();
    expect(text(view)).toBe(`![[${PDF}|Q3.pdf]]\n\n![[${PDF}#page=3|Q3 again.pdf]]\n`);
  });

  it('forgets a reader once its page is gone, so Escape in another page goes through', async () => {
    const view = await mount(`![[${PDF}|Q3.pdf]]\n`);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-pdf-read')).not.toBeNull());
    act(() => { (view.contentDOM.querySelector('.cm-file-pdf-read') as HTMLButtonElement).click(); });
    view.destroy();
    views = views.filter((candidate) => candidate !== view);
    const other = await mount('Text\n');
    const reached = vi.fn();
    other.contentDOM.addEventListener('keydown', reached);
    act(() => { other.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(reached).toHaveBeenCalled();
  });

  it('floats a 240px picture over a card after 400 ms on it', async () => {
    installFilesApi({
      info: vi.fn(async (target: string) => ({ success: true as const, data: info(target) })),
      thumbnail: vi.fn(async (_target: string, px: number) => ({ success: true as const, data: `data:image/png;base64,${px}` })),
    });
    const view = await mount(`[[${DECK}|Gob deck.pptx]]\n`);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-thumb')).toHaveAttribute('src', 'data:image/png;base64,48'));
    vi.useFakeTimers();
    const card = view.contentDOM.querySelector('.cm-file-card') as HTMLElement;
    const at = (top: number) => ({ top, bottom: top + 64, left: 0, right: 400, width: 400, height: 64, x: 0, y: top, toJSON: () => ({}) });
    const place = vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(at(400));
    card.dispatchEvent(new MouseEvent('mouseenter'));
    await act(async () => { await vi.advanceTimersByTimeAsync(399); });
    expect(card.querySelector('.cm-file-hover')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    vi.useRealTimers();
    await waitFor(() => expect(card.querySelector('.cm-file-hover img')).toHaveAttribute('src', 'data:image/png;base64,240'));
    expect(card.querySelector('.cm-file-hover')).not.toHaveClass('cm-file-hover-below');
    card.dispatchEvent(new MouseEvent('mouseleave'));
    expect(card.querySelector('.cm-file-hover')).toBeNull();
    // Near the top of the page there is no room above the card, so the picture goes under it.
    place.mockReturnValue(at(85));
    card.dispatchEvent(new MouseEvent('mouseenter'));
    await waitFor(() => expect(card.querySelector('.cm-file-hover')).toHaveClass('cm-file-hover-below'), { timeout: 2000 });
  });

  it('gives a picture its height before it loads, from files:info', async () => {
    installFilesApi();
    const view = await mount(`![[${SHOT}|300]]\n`);
    await waitFor(() => expect((view.contentDOM.querySelector('.cm-md-image img') as HTMLImageElement).style.aspectRatio).toMatch(/^1\.6( \/ 1)?$/));
  });

  it('drags the file itself out of the window from a card\'s tile', async () => {
    const view = await mount(`[[${DECK}|Gob deck.pptx]]\n`);
    await waitFor(() => expect(view.contentDOM.querySelector('[data-drag-file]')).not.toBeNull());
    const tile = view.contentDOM.querySelector('[data-drag-file]') as HTMLElement;
    expect(tile.draggable).toBe(true);
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    act(() => { tile.dispatchEvent(drag); });
    expect(drag.defaultPrevented).toBe(true);
    expect(window.filesAPI.startDrag).toHaveBeenCalledWith(`/Vault/${DECK}`);
    const pdf = await mount(`![[${PDF}|Q3.pdf]]\n`);
    const icon = await waitFor(() => pdf.contentDOM.querySelector('.cm-file-pdf-footer [data-drag-file]') as HTMLElement);
    act(() => { icon.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })); });
    expect(window.filesAPI.startDrag).toHaveBeenLastCalledWith(`/Vault/${PDF}`);
  });

  it('plays one video at a time in the window', async () => {
    const view = await mount(`![[${CLIP}|300]]\n\n![[${CLIP}|400]]\n`);
    await waitFor(() => expect(view.contentDOM.querySelectorAll('video')).toHaveLength(2));
    const [first, second] = [...view.contentDOM.querySelectorAll('video')];
    expect(first).not.toBe(second);
    Object.defineProperty(first, 'paused', { configurable: true, value: false });
    const pause = vi.spyOn(first, 'pause').mockImplementation(() => undefined);
    act(() => { second.dispatchEvent(new Event('play')); });
    expect(pause).toHaveBeenCalled();
  });

  it('marks a wiki link to a stored file that moved', async () => {
    const { useDiskStore } = await import('@/renderer/features/disk-explorer/store/diskStore');
    useDiskStore.setState({ roots: ['/Vault'] });
    installFilesApi({ findMoved: vi.fn(async () => ({ success: true as const, data: '/Vault/Library/files/2026-10/gone.a3f9c2e1.pdf' })) });
    const view = await mount('[[Library/files/2026-11/gone.a3f9c2e1.pdf|Gone.pdf]]\n');
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('Moved'));
    expect(window.filesAPI.findMoved).toHaveBeenCalledWith('/Vault/Library/files/2026-11/gone.a3f9c2e1.pdf');
    act(() => { (view.contentDOM.querySelector('.cm-file-card button') as HTMLButtonElement).click(); });
    expect(text(view)).toBe('[[Library/files/2026-10/gone.a3f9c2e1.pdf|Gone.pdf]]\n');
  });

  it('renders a page full of links without loading anything from the web except embedded web pictures', async () => {
    const page = [
      '[a](https://example.com/a.png) https://docs.google.com/document/d/1 [[https://x.com/y]]',
      '![](https://www.youtube.com/watch?v=abc)',
      '![web](https://example.com/b.png)',
      '[Loom](https://www.loom.com/share/abc)',
      `![[${PDF}]] [[${DECK}]]`,
    ].join('\n');
    const view = await mount(page);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const sources = [...view.contentDOM.querySelectorAll('[src], [href]')].map((node) => node.getAttribute('src') ?? node.getAttribute('href') ?? '');
    expect(sources.filter((source) => /^https?:/i.test(source))).toEqual(['https://example.com/b.png']);
  });
});

describe('file objects in a document', () => {
  it('frames a card on the first Backspace and removes it on the second; a chip goes in one press', async () => {
    const view = await mount(`Intro\n[[${DECK}|Gob deck.pptx]]\nSee [[${PDF}|Q3]] here\n`);
    const line = text(view).indexOf('\nSee');
    act(() => { view.dispatch({ selection: { anchor: line + 1 } }); });
    key(view, 'Backspace');
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'file', from: 6 });
    expect(text(view)).toContain('[[Library/files/2026-11/gob-deck');
    key(view, 'Backspace');
    expect(text(view)).toBe(`Intro\n\nSee [[${PDF}|Q3]] here\n`);
    const chipEnd = text(view).indexOf(' here');
    act(() => { view.dispatch({ selection: { anchor: chipEnd } }); });
    key(view, 'Backspace');
    expect(text(view)).toBe('Intro\n\nSee  here\n');
  });

  it('frames a picture from the web on the first Backspace, draws its corners, and sizes it from the bar', async () => {
    const doc = 'Text\n![chart](https://example.com/chart.png)\nMore\n';
    const view = await mount(doc);
    expect(view.contentDOM.querySelector('.cm-md-image[data-object] .cm-md-image-handle')).not.toBeNull();
    act(() => { view.dispatch({ selection: { anchor: doc.indexOf('\nMore') } }); });
    key(view, 'Backspace');
    expect(text(view)).toBe(doc);
    const frame = view.state.field(objectFrame);
    expect(frame).toMatchObject({ kind: 'web-picture', from: 5 });
    if (!frame) return;
    const kind = view.state.facet(objectKinds).find((candidate) => candidate.kind === 'web-picture');
    expect(kind?.destination?.(view.state, frame)).toBe('example.com/chart.png');
    const medium = kind?.actions(view.state, frame).find((item) => item.id === 'size')?.items?.find((item) => item.id === 'medium');
    act(() => { medium?.run?.(view, frame); });
    expect(text(view)).toBe('Text\n![chart|400](https://example.com/chart.png)\nMore\n');
    key(view, 'Backspace');
    key(view, 'Backspace');
    expect(text(view)).toBe('Text\nMore\n');
  });

  it('never deletes part of a hidden path: Backspace after an embed in text takes the whole embed', async () => {
    const view = await mount(`A ![[${CLIP}|300]] b\n`);
    act(() => { view.dispatch({ selection: { anchor: 2 + `![[${CLIP}|300]]`.length } }); });
    key(view, 'Backspace');
    expect(text(view)).toBe('A  b\n');
  });

  it('frames a card on a click and follows it on Cmd+click', async () => {
    const openNote = vi.fn();
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: `Intro\n[[${PDF}|Q3.pdf]]\n`, extensions: markdownEditorExtensions(DOC, openNote) }) });
    view.focus = vi.fn();
    views.push(view);
    act(() => { view.dispatch({ effects: linksResolved.of(resolved) }); });
    const card = view.contentDOM.querySelector('.cm-file-card') as HTMLElement;
    act(() => { card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(view.state.field(objectFrame)).toMatchObject({ kind: 'file', from: 6 });
    expect(openNote).not.toHaveBeenCalled();
    act(() => { card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, metaKey: true })); });
    expect(openNote).toHaveBeenCalledWith(`/Vault/${PDF}`, true);
  });

  it('opens Quick Look on Space when a file is framed', async () => {
    const view = await mount(`Intro\n[[${DECK}|Gob deck.pptx]]\n`);
    act(() => { view.dispatch({ selection: { anchor: text(view).length } }); });
    key(view, 'Backspace');
    press(view, ' ');
    expect(window.filesAPI.quickLook).toHaveBeenCalledWith(`/Vault/${DECK}`, { confirmed: undefined });
    expect(text(view)).toBe(`Intro\n[[${DECK}|Gob deck.pptx]]\n`);
  });

  it('opens a PDF in an Opal tab and a deck in its app on Enter', async () => {
    const openNote = vi.fn();
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: `![[${PDF}]]\n[[${DECK}]]\n`, extensions: markdownEditorExtensions(DOC, openNote) }) });
    views.push(view);
    act(() => { view.dispatch({ effects: linksResolved.of(resolved) }); });
    act(() => { view.dispatch({ selection: { anchor: `![[${PDF}]]`.length + 1 } }); });
    key(view, 'Backspace');
    press(view, 'Enter');
    expect(openNote).toHaveBeenCalledWith(`/Vault/${PDF}`, true);
    act(() => { view.dispatch({ selection: { anchor: text(view).length } }); });
    key(view, 'Backspace');
    press(view, 'Enter');
    await waitFor(() => expect(window.filesAPI.open).toHaveBeenCalledWith(`/Vault/${DECK}`, { confirmed: undefined }));
  });
});

describe('putting files in', () => {
  const stored = (name: string) => {
    const dot = name.lastIndexOf('.');
    const stem = name.slice(0, dot).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `Library/files/2026-11/${stem}.a3f9c2e1${name.slice(dot).toLowerCase()}`;
  };
  function paste(view: EditorView, files: File[]) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => '' } });
    act(() => { view.contentDOM.dispatchEvent(event); });
  }
  function drop(view: EditorView, files: File[]) {
    vi.spyOn(view, 'lineBlockAtHeight').mockReturnValue({ from: 0, to: 5, top: 0, bottom: 40 } as ReturnType<EditorView['lineBlockAtHeight']>);
    const event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 30 });
    Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'], getData: () => '' } });
    act(() => { view.contentDOM.dispatchEvent(event); });
  }
  const file = (name: string) => new File(['x'], name);

  it('puts a file in mid-sentence as a chip, and on an empty line in its type\'s look', async () => {
    const view = await mount('See  today\n\n');
    act(() => { view.dispatch({ selection: { anchor: 4 } }); });
    paste(view, [file('Gob deck.pptx')]);
    await waitFor(() => expect(text(view)).toBe(`See [[${stored('Gob deck.pptx')}|Gob deck.pptx]] today\n\n`));
    act(() => { view.dispatch({ selection: { anchor: text(view).length - 1 } }); });
    paste(view, [file('Q3 report.pdf')]);
    await waitFor(() => expect(text(view)).toContain(`![[${stored('Q3 report.pdf')}|Q3 report.pdf]]`));
  });

  it('drops a PDF, a video and a deck one per line, as previews and a card', async () => {
    const view = await mount('Intro\n');
    drop(view, [file('Q3 report.pdf'), file('clip.mp4'), file('Gob deck.pptx')]);
    await waitFor(() => expect(text(view)).toBe([
      'Intro',
      `![[${stored('Q3 report.pdf')}|Q3 report.pdf]]`,
      // The video's width from its header; in the app the column caps it.
      `![[${stored('clip.mp4')}|1920]]`,
      `[[${stored('Gob deck.pptx')}|Gob deck.pptx]]`,
      '',
    ].join('\n')));
  });

  it('puts a pasted file after a code block, and escapes its alias pipe in a table cell', async () => {
    const code = await mount('```sh\nls -la here\n```\n');
    act(() => { code.dispatch({ selection: { anchor: text(code).indexOf('here') } }); });
    paste(code, [file('Gob deck.pptx')]);
    await waitFor(() => expect(text(code)).toContain(`\`\`\`sh\nls -la here\n\`\`\`\n[[${stored('Gob deck.pptx')}|Gob deck.pptx]]`));
    // A note: a document draws the table, so its caret is never in a cell.
    const table = await mount('| Item | Owner |\n| --- | --- |\n| Q3  | Cody |\n', '/Vault/Notes/Plan.md');
    act(() => { table.dispatch({ selection: { anchor: text(table).indexOf('Q3 ') + 3 } }); });
    paste(table, [file('Gob deck.pptx')]);
    await waitFor(() => expect(text(table)).toBe(`| Item | Owner |\n| --- | --- |\n| Q3 [[${stored('Gob deck.pptx')}\\|Gob deck.pptx]] | Cody |\n`));
  });

  it('puts ten dropped PDFs in as cards, not previews', async () => {
    const view = await mount('Intro\n');
    const names = Array.from({ length: 10 }, (_, index) => `Report ${index + 1}.pdf`);
    drop(view, names.map(file));
    await waitFor(() => expect(text(view).split('\n')).toHaveLength(12));
    expect(text(view)).toBe(['Intro', ...names.map((name) => `[[${stored(name)}|${name}]]`), ''].join('\n'));
  });

  it('shows a placeholder while a file is stored, then an error card with Retry and Remove when it fails, writing nothing', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const results = [
      new Promise((resolve) => { finish = resolve; }),
      Promise.resolve({ success: true, data: { path: `/Vault/${stored('clip.mov')}`, vaultPath: stored('clip.mov'), name: 'clip.mov' } }),
    ];
    installFilesApi({ import: vi.fn(() => results.shift() as never) });
    const view = await mount('Intro\n');
    drop(view, [file('clip.mov')]);
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-pending')).toHaveTextContent('Adding clip.mov…'));
    // A grey box at the movie's final size: the column's width (640 when it can't be read) at 16:9.
    const box = view.contentDOM.querySelector('.cm-file-pending-box') as HTMLElement;
    expect([box.style.width, box.style.height]).toEqual(['640px', '360px']);
    await act(async () => { finish({ success: false, error: 'The disk is full.' }); });
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-file-pending')).toHaveTextContent('The disk is full.'));
    expect(text(view)).toBe('Intro\n');
    const retry = [...view.contentDOM.querySelectorAll<HTMLButtonElement>('.cm-file-pending button')].find((control) => control.textContent === 'Retry');
    await act(async () => { retry?.click(); });
    await waitFor(() => expect(text(view)).toBe(`Intro\n![[${stored('clip.mov')}]]\n`));
    expect(view.contentDOM.querySelector('.cm-file-pending')).toBeNull();
  });

  it('writes a file whose name a wiki link can\'t hold as a Markdown link with its address encoded', async () => {
    installFilesApi({
      import: vi.fn(async () => ({ success: true as const, data: { path: '/Vault/Docs/Plan #2 [draft].pptx', vaultPath: 'Docs/Plan #2 [draft].pptx', name: 'Plan #2 [draft].pptx' } })),
    });
    const view = await mount('Intro\n');
    drop(view, [file('Plan #2 [draft].pptx')]);
    await waitFor(() => expect(text(view)).toBe('Intro\n[Plan #2 \\[draft\\].pptx](<../Docs/Plan %232 [draft].pptx>)\n'));
  });
});
