import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EditorView } from '@codemirror/view';
import { AppCommands, usePaletteStore } from '@/renderer/features/commands';
import { commandRegistry } from '@/renderer/features/commands/services/commandRegistry';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { ShellProvider } from '@/renderer/features/shell';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { openTabs } from '@/tests/helpers/tabs';

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/brief.md';
const MOD: KeyboardEventInit = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  usePaletteStore.setState({ open: false, initialQuery: '', newTab: false, filesOnly: false });
  for (const command of commandRegistry.getAllCommands()) commandRegistry.unregisterCommand(command);
  (window as unknown as { systemAPI: unknown }).systemAPI = { reportCommands: vi.fn(), onMenuCommand: vi.fn(() => () => undefined), closeWindow: vi.fn() };
  openTabs([DOC]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openEditor(path: string, body: string, withCommands = false): Promise<EditorView> {
  installMarkdownApi({ [path]: body });
  render(
    <MemoryRouter initialEntries={['/files']}>
      <TooltipProvider>
        <ShellProvider>
          {withCommands ? <AppCommands /> : null}
          <MarkdownEditor path={path} />
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  const view = EditorView.findFromDOM(await screen.findByTestId('markdown-editor'));
  if (!view) throw new Error('No editor view');
  return view;
}

const select = (view: EditorView, anchor: number, head = anchor) => act(() => { view.dispatch({ selection: { anchor, head } }); });
const button = (name: string) => within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name });

describe('the document toolbar', () => {
  it('shows on a document only, in Google Docs\' order, with no syntax on the page', async () => {
    await openEditor(DOC, 'Some **bold** text.\n');
    const names = within(screen.getByRole('toolbar', { name: 'Formatting' })).getAllByRole('button').map((item) => item.getAttribute('aria-label'));
    expect(names).toEqual([
      'Undo', 'Redo', 'Style, Normal text', 'Bold', 'Italic', 'Link', 'Image',
      'Checklist', 'Bulleted list', 'Numbered list', 'Decrease indent', 'Increase indent', 'Clear formatting',
    ]);
    installMarkdownApi({ [NOTE]: 'Plain.\n' });
    render(<TooltipProvider><MarkdownEditor path={NOTE} /></TooltipProvider>);
    await waitFor(() => expect(screen.getAllByTestId('markdown-editor')).toHaveLength(2));
    expect(screen.getAllByRole('toolbar')).toHaveLength(1);
  });

  it('shows a style as pressed only when the whole selection has it, and keeps focus in the text on a click', async () => {
    const view = await openEditor(DOC, 'Some **bold** text.\n');
    select(view, 7, 11);
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Italic')).toHaveAttribute('aria-pressed', 'false');
    select(view, 0, 11);
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'false');
    const press = fireEvent.mouseDown(button('Bold'));
    expect(press).toBe(false);
    fireEvent.click(button('Bold'));
    expect(view.state.doc.toString()).toBe('**Some bold** text.\n');
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Undo')).toBeEnabled();
    expect(button('Decrease indent')).toBeDisabled();
    fireEvent.click(button('Bulleted list'));
    expect(view.state.doc.toString()).toBe('- **Some bold** text.\n');
    expect(button('Bulleted list')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Increase indent')).toBeEnabled();
  });

  it('keeps one button in the tab order, moves along with the arrow keys, and goes back to the text on Escape', async () => {
    const view = await openEditor(DOC, 'Text\n');
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    const stops = () => within(toolbar).getAllByRole('button').filter((item) => item.tabIndex === 0);
    // Undo cannot run yet, so the first stop is the style menu.
    expect(stops().map((item) => item.getAttribute('aria-label'))).toEqual(['Style, Normal text']);
    const focusText = vi.spyOn(view, 'focus').mockImplementation(() => undefined);
    act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true })); });
    expect(button('Style, Normal text')).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(button('Bold')).toHaveFocus();
    expect(stops()).toEqual([button('Bold')]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(button('Clear formatting')).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(focusText).toHaveBeenCalled();
  });

  it('sets a heading from the style menu and gives focus back to the text', async () => {
    const user = userEvent.setup();
    const view = await openEditor(DOC, 'Title\n');
    const focusText = vi.spyOn(view, 'focus').mockImplementation(() => undefined);
    await user.click(button('Style, Normal text'));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Heading 2' }));
    expect(view.state.doc.toString()).toBe('## Title\n');
    await waitFor(() => expect(focusText).toHaveBeenCalled());
    expect(button('Style, Heading 2')).toBeInTheDocument();
  });

  it('moves the buttons that do not fit into a "more" menu', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const user = userEvent.setup();
    const view = await openEditor(DOC, 'Text\n');
    view.focus = vi.fn();
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    expect(within(toolbar).getAllByRole('button').map((item) => item.getAttribute('aria-label'))).toEqual(['Undo', 'Redo', 'Style, Normal text', 'Bold', 'Italic', 'More']);
    select(view, 0, 4);
    await user.click(button('More'));
    expect(await screen.findByRole('menuitem', { name: 'Image' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Numbered list' }));
    expect(view.state.doc.toString()).toBe('1. Text\n');
  });

  it('inserts a picked image on a line after the caret\'s line', async () => {
    const pickAndImport = vi.fn(async () => ({
      success: true as const,
      data: { files: [{ path: '/Vault/Library/files/2026-11/nest.a3f9c2e1.jpg', vaultPath: 'Library/files/2026-11/nest.a3f9c2e1.jpg', name: 'nest.jpg' }], skipped: [] },
    }));
    window.filesAPI = { pickAndImport } as unknown as typeof window.filesAPI;
    const view = await openEditor(DOC, '> Quoted line\nNext\n');
    select(view, 5);
    fireEvent.click(button('Image'));
    await waitFor(() => expect(view.state.doc.toString()).toBe('> Quoted line\n> ![[Library/files/2026-11/nest.a3f9c2e1.jpg]]\nNext\n'));
    expect(pickAndImport).toHaveBeenCalledWith(DOC);
  });
});

describe('the link popover', () => {
  it('shows a clicked link\'s address with Edit and Remove, and Remove leaves the text', async () => {
    const view = await openEditor(DOC, 'See [the site](https://example.com) now.\n');
    view.focus = vi.fn();
    const link = await waitFor(() => view.contentDOM.querySelector('[data-href]') as Element);
    act(() => { link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    const popover = await screen.findByTestId('link-popover');
    expect(within(popover).getByRole('button', { name: 'https://example.com' })).toBeInTheDocument();
    fireEvent.click(within(popover).getByRole('button', { name: 'Remove link' }));
    expect(view.state.doc.toString()).toBe('See the site now.\n');
    await waitFor(() => expect(screen.queryByTestId('link-popover')).toBeNull());
  });

  it('edits a link from Edit, writing only its address when the text stays', async () => {
    const user = userEvent.setup();
    const view = await openEditor(DOC, 'See [the site](https://example.com) now.\n');
    view.focus = vi.fn();
    const link = await waitFor(() => view.contentDOM.querySelector('[data-href]') as Element);
    act(() => { link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    await user.click(within(await screen.findByTestId('link-popover')).getByRole('button', { name: 'Edit link' }));
    const field = await screen.findByRole('textbox', { name: 'Link' });
    expect(field).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('the site');
    await user.clear(field);
    await user.type(field, 'https://example.org{Enter}');
    expect(view.state.doc.toString()).toBe('See [the site](https://example.org) now.\n');
    await waitFor(() => expect(screen.queryByTestId('link-popover')).toBeNull());
  });

  it('opens on Cmd+K in a document to link the selection, while Cmd+K elsewhere and Cmd+P still open search', async () => {
    const user = userEvent.setup();
    const view = await openEditor(DOC, 'See this now.\n', true);
    view.focus = vi.fn();
    select(view, 4, 8);
    act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...MOD })); });
    expect(usePaletteStore.getState().open).toBe(false);
    const field = await screen.findByRole('textbox', { name: 'Link' });
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('this');
    await user.type(field, 'https://example.com{Enter}');
    expect(view.state.doc.toString()).toBe('See [this](https://example.com) now.\n');
    act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true, ...MOD })); });
    expect(usePaletteStore.getState().open).toBe(true);
    act(() => usePaletteStore.getState().hide());
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...MOD })); });
    expect(usePaletteStore.getState().open).toBe(true);
  });
});
