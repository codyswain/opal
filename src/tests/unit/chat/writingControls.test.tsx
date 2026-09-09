import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Composer } from '@/renderer/features/chat/components/Composer';
import { IndexStatusBar } from '@/renderer/features/chat/components/IndexStatusBar';
import { TooltipProvider } from '@/renderer/shared/ui';
import type { LibraryIndexStatus } from '@/types/chat';

function WritingHarness({ onSend }: { onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('A thought worth keeping');
  return <TooltipProvider><Composer sending={false} onSend={onSend} onCancel={vi.fn()} draft={draft} onDraftChange={setDraft} saveStatus="Saved on this device" /></TooltipProvider>;
}
const status: LibraryIndexStatus = { files: 0, chunks: 0, staleFiles: 0, indexing: false, progress: null, cancelled: false, lastIndexedAt: null, error: null, skipped: [], ready: false };

describe('Writing controls', () => {
  it('sizes wrapped text using its rendered height and bounds the compact writing surface', () => {
    render(<WritingHarness onSend={vi.fn()} />);
    const input = screen.getByRole('textbox');
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 340 });
    fireEvent.change(input, { target: { value: 'A long wrapping paragraph' } });
    expect(input).toHaveStyle({ height: '180px' });
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 64 });
    fireEvent.change(input, { target: { value: 'Short again' } });
    expect(input).toHaveStyle({ height: '64px' });
  });
  it('preserves the draft and textarea focus when opening and closing writing room', () => {
    render(<WritingHarness onSend={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Ask about your library' });
    fireEvent.click(screen.getByRole('button', { name: 'Expand writing room' }));
    expect(input).toHaveFocus();
    expect(input).toHaveValue('A thought worth keeping');
    fireEvent.change(input, { target: { value: 'Another paragraph' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse writing room' }));
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Another paragraph');
  });
  it('does not submit IME composition or Shift+Enter and retains sent text until its owner clears it', () => {
    const onSend = vi.fn();
    render(<WritingHarness onSend={onSend} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('A thought worth keeping');
    expect(input).toHaveValue('A thought worth keeping');
  });
  it('blocks over-limit drafts without silently truncating saved text', () => {
    const onSend = vi.fn();
    render(<TooltipProvider><Composer sending={false} onSend={onSend} onCancel={vi.fn()} draft={'x'.repeat(8001)} onDraftChange={vi.fn()} /></TooltipProvider>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('x'.repeat(8001));
  });
  it('opens library details without indexing and discloses sharing before the explicit action', () => {
    const onUpdate = vi.fn();
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><IndexStatusBar status={status} error={null} onUpdate={onUpdate} onCancel={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Index library' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Library context/ }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/sends the text.*OpenAI/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Index library' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
  it('keeps indexing progress and errors visible while details are closed', () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><IndexStatusBar status={{ ...status, indexing: true, progress: { phase: 'embedding', done: 3, total: 10, currentFile: '/notes/project.md' } }} error="Connection interrupted" onUpdate={vi.fn()} onCancel={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Embedding passages 3 of 10');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    expect(screen.getByRole('alert')).toHaveTextContent('Connection interrupted');
  });
});
