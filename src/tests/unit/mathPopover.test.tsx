import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { MarkdownEditor } from '@/renderer/features/disk-explorer/components/editor/MarkdownEditor';
import { mathEditor } from '@/renderer/features/disk-explorer/components/editor/mathWrite';
import { ShellProvider } from '@/renderer/features/shell';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';
import { openTabs } from '@/tests/helpers/tabs';

const DOC = '/Vault/Notes/Physics.mdo';

beforeEach(() => {
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  (window as unknown as { systemAPI: unknown }).systemAPI = { reportCommands: vi.fn(), onMenuCommand: vi.fn(() => () => undefined), closeWindow: vi.fn() };
  openTabs([DOC]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openEditor(body: string): Promise<EditorView> {
  installMarkdownApi({ [DOC]: body });
  render(
    <MemoryRouter initialEntries={['/files']}>
      <TooltipProvider>
        <ShellProvider>
          <MarkdownEditor path={DOC} />
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  const view = EditorView.findFromDOM(await screen.findByTestId('markdown-editor'));
  if (!view) throw new Error('No editor view');
  view.focus = vi.fn();
  return view;
}

/** Clicks the drawn formula whose TeX is `tex`. */
async function clickFormula(view: EditorView, tex: string) {
  const formula = await waitFor(() => {
    const found = [...view.contentDOM.querySelectorAll('.cm-math')].find((element) => element.getAttribute('aria-label') === tex);
    if (!found) throw new Error(`no formula ${tex}`);
    return found;
  });
  act(() => { formula.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
  return screen.findByTestId('math-popover');
}

/** Types into the TeX field as the browser does: the field's new value, with the caret at its end. */
function typeInto(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
}

describe('the formula popover', () => {
  it('writes as you type, with pauses, and one Cmd+Z after closing brings the original bytes back', async () => {
    const original = 'Energy $E=mc^2$ is famous.\n';
    const view = await openEditor(original);
    const popover = await clickFormula(view, 'E=mc^2');
    const field = within(popover).getByRole('textbox', { name: 'TeX' }) as HTMLTextAreaElement;
    expect(field.value).toBe('E=mc^2');
    vi.useFakeTimers({ toFake: ['Date'] });
    let value = 'E=mc^2';
    for (const typed of ' + abcdefgh') {
      vi.setSystemTime(Date.now() + 600);
      value += typed;
      typeInto(field, value);
    }
    expect(view.state.doc.toString()).toBe('Energy $E=mc^2 + abcdefgh$ is famous.\n');
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('math-popover')).toBeNull());
    expect(view.state.doc.toString()).toBe('Energy $E=mc^2 + abcdefgh$ is famous.\n');
    expect(view.state.selection.main.head).toBe('Energy $E=mc^2 + abcdefgh$'.length);
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe(original);
  });

  it('keeps the last formula that rendered on the page while the TeX does not, and shows the message in the popover', async () => {
    const view = await openEditor('Half $\\frac{1}{2}$ here.\n');
    const popover = await clickFormula(view, '\\frac{1}{2}');
    const field = within(popover).getByRole('textbox', { name: 'TeX' }) as HTMLTextAreaElement;
    typeInto(field, '\\frac{1}{');
    expect(view.state.doc.toString()).toBe('Half $\\frac{1}{$ here.\n');
    const drawn = view.contentDOM.querySelector('.cm-math');
    expect(drawn?.getAttribute('aria-label')).toBe('\\frac{1}{2}');
    expect(drawn?.classList.contains('cm-math-error')).toBe(false);
    expect(within(popover).getByRole('status').textContent).toMatch(/Unexpected end of input/);
    typeInto(field, '\\frac{1}{3}');
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-math')?.getAttribute('aria-label')).toBe('\\frac{1}{3}'));
    fireEvent.click(within(popover).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('math-popover')).toBeNull());
    expect(view.state.doc.toString()).toBe('Half $\\frac{1}{3}$ here.\n');
    expect(view.state.selection.main.head).toBe('Half $\\frac{1}{3}$'.length);
  });

  it('closes keeping what was written when the window loses focus', async () => {
    const view = await openEditor('So $x$ then.\n');
    const popover = await clickFormula(view, 'x');
    typeInto(within(popover).getByRole('textbox', { name: 'TeX' }) as HTMLTextAreaElement, 'x^2');
    act(() => { window.dispatchEvent(new Event('blur')); });
    await waitFor(() => expect(screen.queryByTestId('math-popover')).toBeNull());
    expect(view.state.field(mathEditor)).toBeNull();
    expect(view.state.doc.toString()).toBe('So $x^2$ then.\n');
  });

  it('switches a formula between inline and display', async () => {
    const view = await openEditor('Sum $a+b$ here.\n');
    const popover = await clickFormula(view, 'a+b');
    fireEvent.click(within(popover).getByRole('button', { name: 'Display' }));
    expect(view.state.doc.toString()).toBe('Sum $$a+b$$ here.\n');
    fireEvent.click(within(popover).getByRole('button', { name: 'Inline' }));
    expect(view.state.doc.toString()).toBe('Sum $a+b$ here.\n');
  });

  it('writes "Not a formula" as an escaped dollar, as one undo step', async () => {
    const view = await openEditor('Price $5,$ total.\n');
    const popover = await clickFormula(view, '5,');
    fireEvent.click(within(popover).getByRole('button', { name: 'Not a formula' }));
    expect(view.state.doc.toString()).toBe('Price \\$5,$ total.\n');
    await waitFor(() => expect(screen.queryByTestId('math-popover')).toBeNull());
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe('Price $5,$ total.\n');
  });
});

describe('the formula popover on the page', () => {
  it('leaves the caret where a click on the page put it when that click closes the popover', async () => {
    const original = 'Energy $E=mc^2$ and more.\n\nA lower line.\n';
    const view = await openEditor(original);
    const popover = await clickFormula(view, 'E=mc^2');
    typeInto(within(popover).getByRole('textbox', { name: 'TeX' }) as HTMLTextAreaElement, 'E=mc^3');
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    const clicked = original.indexOf('lower');
    // The popover hears of a click outside only once it ends; CodeMirror has put the caret where it landed by then.
    const line = [...view.contentDOM.querySelectorAll('.cm-line')].find((element) => element.textContent?.includes('lower'));
    act(() => { line?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); });
    act(() => { view.dispatch({ selection: { anchor: clicked } }); });
    act(() => { line?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })); });
    await waitFor(() => expect(screen.queryByTestId('math-popover')).toBeNull());
    expect(view.state.selection.main.head).toBe(clicked);
    expect(view.state.doc.toString()).toBe('Energy $E=mc^3$ and more.\n\nA lower line.\n');
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe(original);
  });

  it('moves with the page as it scrolls', async () => {
    const view = await openEditor('Energy $E=mc^2$ is famous.\n');
    const formula = await waitFor(() => {
      const found = view.contentDOM.querySelector<HTMLElement>('.cm-math');
      if (!found) throw new Error('no formula');
      return found;
    });
    formula.getBoundingClientRect = () => new DOMRect(100, 300, 60, 20);
    view.scrollDOM.getBoundingClientRect = () => new DOMRect(0, 0, 800, 1000);
    const popover = await clickFormula(view, 'E=mc^2');
    const wrapper = popover.closest<HTMLElement>('[data-radix-popper-content-wrapper]');
    const top = () => Number(/translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(wrapper?.style.transform ?? '')?.[1] ?? NaN);
    await waitFor(() => expect(top()).toBeGreaterThan(0));
    const before = top();
    Object.defineProperty(view.scrollDOM, 'scrollTop', { configurable: true, value: 120 });
    act(() => {
      view.scrollDOM.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(top()).toBe(before - 120));
  });

  it('grows the TeX field to fit long TeX, up to eight lines', async () => {
    const view = await openEditor('Long $x$ here.\n');
    const popover = await clickFormula(view, 'x');
    const field = within(popover).getByRole('textbox', { name: 'TeX' }) as HTMLTextAreaElement;
    Object.defineProperty(field, 'scrollHeight', { configurable: true, get: () => (field.value.length > 40 ? 87 : 31) });
    typeInto(field, 'f(x) = a_0 + a_1 x + a_2 x^2 + a_3 x^3 + a_4 x^4 + a_5 x^5');
    expect(field.style.height).toBe('87px');
  });

  it('says why Display is off in a table cell', async () => {
    const view = await openEditor('| a | b |\n|---|---|\n| $x^2$ | c |\n');
    view.focus = vi.fn();
    const formula = await waitFor(() => {
      const found = view.contentDOM.querySelector('td .cm-math');
      if (!found) throw new Error('no formula');
      return found;
    });
    act(() => { formula.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    const popover = await screen.findByTestId('math-popover');
    const display = within(popover).getByRole('button', { name: 'Display' });
    expect(display).toHaveProperty('disabled', true);
    expect(display.getAttribute('title')).toBe('A table cell holds only inline formulas');
  });
});
