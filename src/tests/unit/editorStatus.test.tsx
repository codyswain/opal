import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorStatus } from '@/renderer/features/disk-explorer/components/editor/EditorStatus';

const actions = { onKeepMine: vi.fn(), onKeepDisk: vi.fn(), onRetry: vi.fn() };

describe('EditorStatus', () => {
  it('shows "N properties · N words" and says nothing about saving while all is well', () => {
    const { rerender } = render(<EditorStatus saveState="saved" error={null} properties={11} words={2759} {...actions} />);
    expect(screen.getByText('11 properties')).toBeInTheDocument();
    expect(screen.getByText('2,759 words')).toBeInTheDocument();
    expect(screen.getByTestId('editor-save-state')).toHaveTextContent(/^$/);
    rerender(<EditorStatus saveState="dirty" error={null} properties={1} words={1} {...actions} />);
    expect(screen.getByText('1 property')).toBeInTheDocument();
    expect(screen.getByText('1 word')).toBeInTheDocument();
    expect(screen.getByTestId('editor-save-state')).toHaveTextContent(/^$/);
    rerender(<EditorStatus saveState="clean" error={null} properties={0} words={3} {...actions} />);
    expect(screen.queryByText(/propert/)).toBeNull();
    expect(screen.queryByText('·')).toBeNull();
  });

  it('names a failed save and offers a retry', () => {
    render(<EditorStatus saveState="error" error="The disk is full." properties={0} words={3} {...actions} />);
    expect(screen.getByTestId('editor-save-state')).toHaveTextContent('Not saved');
    expect(screen.getByRole('alert')).toHaveTextContent('The disk is full.');
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(actions.onRetry).toHaveBeenCalled();
  });
});
