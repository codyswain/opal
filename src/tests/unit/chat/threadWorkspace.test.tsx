import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/renderer/shared/ui';
import { ConversationList } from '@/renderer/features/chat/components/ConversationList';
import { ThreadHeader } from '@/renderer/features/chat/components/ThreadHeader';
import type { Conversation, ConversationSummary } from '@/types/chat';

const conversations: ConversationSummary[] = [
  { id: 'a', title: 'A quiet morning', createdAt: 1, updatedAt: 2, messageCount: 0, context: { title: 'Garden plan', date: '2026-09-09', context: 'Plant lavender' } },
  { id: 'b', title: 'Old ideas', createdAt: 1, updatedAt: 2, messageCount: 2, archivedAt: 3 },
];

describe('Thread workspace', () => {
  it('prioritizes pinned threads and lets you unpin them', async () => {
    const onPin = vi.fn();
    render(<TooltipProvider><ConversationList conversations={[conversations[0], { ...conversations[0], id: 'p', title: 'Keep close', pinnedAt: 1, updatedAt: 1 }]} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onArchive={vi.fn()} onPin={onPin} /></TooltipProvider>);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Keep close');
    await userEvent.click(screen.getByRole('button', { name: 'Unpin thread Keep close' }));
    expect(onPin).toHaveBeenCalledWith('p', false);
  });
  it('recovers an unsent new-thread draft alongside saved threads', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TooltipProvider><ConversationList conversations={conversations} activeId="a" onSelect={onSelect} onNew={vi.fn()} onArchive={vi.fn()} drafts={{ new: 'Remember this' }} /></TooltipProvider>);
    await user.click(screen.getByRole('button', { name: /Unfinished thought/ }));
    expect(onSelect).toHaveBeenCalledWith('new');
  });
  it('searches source context and separates archived threads with restore actions', async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    render(<TooltipProvider><ConversationList conversations={conversations} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onArchive={onArchive} drafts={{ a: 'Unsent thought' }} /></TooltipProvider>);
    expect(screen.queryByText('Old ideas')).not.toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'lavender');
    expect(screen.getByText('A quiet morning')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive thread A quiet morning' }));
    expect(onArchive).toHaveBeenCalledWith('a', true);
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('button', { name: 'Archived' }));
    expect(screen.queryByText('A quiet morning')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore thread Old ideas' }));
    expect(onArchive).toHaveBeenCalledWith('b', false);
  });
});


describe('Thread header', () => {
  const conversation: Conversation = { ...conversations[0], messages: [], context: { title: 'Garden plan', date: '2026-09-09', sourcePath: '/notes/garden.md', context: 'Plant lavender' } };
  it('keeps an unsuccessful rename editable, saves a trimmed name, and cancels with Escape', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<TooltipProvider><ThreadHeader conversation={conversation} busy={false} onRename={onRename} onOpenDay={vi.fn()} onOpenSource={vi.fn()} /></TooltipProvider>);
    await user.click(screen.getByRole('button', { name: 'Rename thread' }));
    await user.clear(screen.getByRole('textbox', { name: 'Thread name' }));
    await user.type(screen.getByRole('textbox'), '  A new name  {Enter}');
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('A new name'));
    expect(screen.getByRole('textbox')).toHaveValue('  A new name  ');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Rename thread' }));
    await user.type(screen.getByRole('textbox'), 'discard{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onRename).toHaveBeenCalledTimes(2);
  });
  it('opens the original day and source with their full identities', async () => {
    const user = userEvent.setup();
    const onOpenDay = vi.fn();
    const onOpenSource = vi.fn();
    render(<TooltipProvider><ThreadHeader conversation={conversation} busy={false} onRename={vi.fn()} onOpenDay={onOpenDay} onOpenSource={onOpenSource} /></TooltipProvider>);
    await user.click(screen.getByRole('button', { name: '2026-09-09' }));
    await user.click(screen.getByRole('button', { name: 'garden.md' }));
    expect(onOpenDay).toHaveBeenCalledWith('2026-09-09');
    expect(onOpenSource).toHaveBeenCalledWith('/notes/garden.md');
  });
});
