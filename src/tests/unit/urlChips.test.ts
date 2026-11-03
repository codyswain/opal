import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { urlChip } from '@/renderer/features/disk-explorer/components/editor/urlChips';
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

function mount(doc: string) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(DOC) }) });
  view.focus = vi.fn();
  views.push(view);
  return view;
}

describe('service chips', () => {
  it('read a label from each service\'s address alone', () => {
    const table: [string, string | null][] = [
      ['https://linear.app/parametricpbc/issue/sw-640/batteries-no-tether', 'SW-640'],
      ['https://linear.app/parametricpbc/project/nest-1-abc', 'Linear project'],
      ['https://github.com/codyswain/opal/pull/13', 'opal#13'],
      ['https://github.com/codyswain/opal/issues/7', 'opal#7'],
      ['https://github.com/codyswain/opal/commit/41ca4514b394dbcc7eec6b894568f962f3e0d154', 'opal@41ca451'],
      ['https://github.com/codyswain/opal/blob/main/src/main.ts', 'main.ts'],
      ['https://github.com/codyswain/opal', 'codyswain/opal'],
      ['https://docs.google.com/document/d/1KhEoybd1ca9/edit', 'Google Doc'],
      ['https://docs.google.com/spreadsheets/d/1abc/edit#gid=0', 'Google Sheet'],
      ['https://docs.google.com/presentation/d/1abc/edit', 'Google Slides'],
      ['https://drive.google.com/drive/folders/1abc', 'Drive folder'],
      ['https://drive.google.com/file/d/1abc/view', 'Drive file'],
      ['https://calendar.google.com/calendar/event?eid=abc', 'Calendar event'],
      ['https://mail.google.com/mail/u/0/#all/18f2', 'Email'],
      ['https://parametric.slack.com/archives/C07ABC/p1730000000', 'Slack message'],
      ['https://www.figma.com/design/AbC123/Bit-shell-v2?node-id=1', 'Bit shell v2'],
      ['https://cad.onshape.com/documents/abc/w/def/e/ghi', 'Onshape document'],
      ['https://www.notion.so/parametric/Kigali-ops-plan-0123456789abcdef0123456789abcdef', 'Kigali ops plan'],
      ['https://www.youtube.com/watch?v=abc', 'YouTube video'],
      ['https://example.com/page', null],
    ];
    expect(table.map(([url]) => urlChip(url)?.label ?? null)).toEqual(table.map(([, label]) => label));
  });

  it('draw as a chip in text, once the address is ended', () => {
    const url = 'https://github.com/codyswain/opal/pull/13';
    const view = mount('See \n');
    // Typed character by character, the address stays text while the caret is at its end.
    for (const [index, char] of [...url].entries()) {
      act(() => { view.dispatch({ changes: { from: 4 + index, insert: char }, selection: { anchor: 5 + index }, userEvent: 'input.type' }); });
    }
    expect(view.contentDOM.querySelector('.cm-url-chip')).toBeNull();
    act(() => { view.dispatch({ changes: { from: 4 + url.length, insert: ' ' }, selection: { anchor: 5 + url.length }, userEvent: 'input.type' }); });
    expect(view.contentDOM.querySelector('.cm-url-chip')).toHaveTextContent('opal#13');
    expect(view.state.doc.toString()).toBe(`See ${url} \n`);
  });

  it('forms at once for a pasted address, and goes in one Backspace in a document', () => {
    const url = 'https://linear.app/parametricpbc/issue/SW-640';
    const view = mount('See \n');
    act(() => { view.dispatch({ changes: { from: 4, insert: url }, selection: { anchor: 4 + url.length }, userEvent: 'input.paste' }); });
    expect(view.contentDOM.querySelector('.cm-url-chip')).toHaveTextContent('SW-640');
    act(() => { runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor'); });
    expect(view.state.doc.toString()).toBe('See \n');
  });

  it('leaves written links with their own text and unknown addresses alone, and loads nothing', () => {
    const view = mount('[the PR](https://github.com/codyswain/opal/pull/13) and https://example.com/x \n');
    expect(view.contentDOM.querySelector('.cm-url-chip')).toBeNull();
    expect(view.contentDOM.querySelectorAll('[src^="http"]')).toHaveLength(0);
  });

  it('draws a YouTube address alone on its line as a card', () => {
    const view = mount('Intro\n\nhttps://www.youtube.com/watch?v=abc\n\nAfter\n');
    expect(view.contentDOM.querySelector('.cm-file-card')).toHaveTextContent('YouTube video');
  });
});
