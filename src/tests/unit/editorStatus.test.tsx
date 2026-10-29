import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorStatus } from '@/renderer/features/disk-explorer/components/editor/EditorStatus';
import { TooltipProvider } from '@/renderer/shared/ui';

const actions = { onKeepMine: vi.fn(), onKeepDisk: vi.fn(), onRetry: vi.fn(), onToggleProperties: vi.fn() };
const renderStatus = (ui: React.ReactElement) => render(ui, { wrapper: TooltipProvider });

describe('EditorStatus', () => {
  it('shows "N properties · N words" and says nothing about saving while all is well', () => {
    const { rerender } = renderStatus(<EditorStatus saveState="saved" error={null} properties={11} words={2759} propertiesOpen={false} {...actions} />);
    expect(screen.getByText('11 properties · 2,759 words')).toBeInTheDocument();
    expect(screen.getByTestId('editor-save-state')).toHaveTextContent(/^$/);
    rerender(<EditorStatus saveState="dirty" error={null} properties={1} words={1} propertiesOpen={false} {...actions} />);
    expect(screen.getByText('1 property · 1 word')).toBeInTheDocument();
    expect(screen.getByTestId('editor-save-state')).toHaveTextContent(/^$/);
    rerender(<EditorStatus saveState="clean" error={null} properties={0} words={3} propertiesOpen={false} {...actions} />);
    expect(screen.getByText('3 words')).toBeInTheDocument();
    expect(screen.queryByText(/propert|·|Read-only/)).toBeNull();
  });

  it('makes the count line the properties toggle, which keeps focus in the editor', () => {
    const { rerender } = renderStatus(<EditorStatus saveState="clean" error={null} properties={2} words={0} propertiesOpen={false} {...actions} />);
    const toggle = screen.getByRole('button', { name: '2 properties · 0 words' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+I');
    // A mousedown that took focus would blur the editor and start a save.
    expect(fireEvent.mouseDown(toggle)).toBe(false);
    fireEvent.click(toggle);
    expect(actions.onToggleProperties).toHaveBeenCalledTimes(1);
    rerender(<EditorStatus saveState="clean" error={null} properties={2} words={0} propertiesOpen {...actions} />);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('starts the line with "Read-only" on a log page', () => {
    renderStatus(<EditorStatus saveState="clean" error={null} properties={3} words={40} readOnly propertiesOpen={false} {...actions} />);
    expect(screen.getByRole('button', { name: 'Read-only · 3 properties · 40 words' })).toBeInTheDocument();
  });

  it('names a failed save and offers a retry', () => {
    renderStatus(<EditorStatus saveState="error" error="The disk is full." properties={0} words={3} propertiesOpen={false} {...actions} />);
    expect(screen.getByTestId('editor-save-state')).toHaveTextContent('Not saved');
    expect(screen.getByRole('alert')).toHaveTextContent('The disk is full.');
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(actions.onRetry).toHaveBeenCalled();
  });
});
