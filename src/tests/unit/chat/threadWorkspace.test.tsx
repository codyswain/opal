import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/renderer/shared/ui';
import { ConversationList } from '@/renderer/features/chat/components/ConversationList';
import { ThreadHeader } from '@/renderer/features/chat/components/ThreadHeader';
import type { Conversation, ConversationSummary } from '@/types/chat';

import { installChatApi } from '@/tests/helpers/chatApi';
beforeEach(() => { installChatApi(); });

const conversations: ConversationSummary[] = [
  { id: 'a', title: 'A quiet morning', createdAt: 1, updatedAt: 2, messageCount: 0, context: { title: 'Garden plan', date: '2026-09-09', context: 'Plant lavender' } },
  { id: 'b', title: 'Old ideas', createdAt: 1, updatedAt: 2, messageCount: 2, archivedAt: 3 },
];

describe('Thread workspace', () => {
  it('adds saved-message matches and discards a response for an old query', async () => {
    const user = userEvent.setup();
    let finish!: (value: unknown) => void;
    window.chatAPI.searchMessages = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ success: true, data: { hits: [{ id: 'a', messageId: 'm1', excerpt: 'Remember the solstice' }], incomplete: false } });
    const onSelect = vi.fn();
    render(<TooltipProvider><ConversationList conversations={conversations} activeId={null} onSelect={onSelect} onNew={vi.fn()} onArchive={vi.fn()} /></TooltipProvider>);
    await user.type(screen.getByRole('searchbox'), 'obsolete');
    await waitFor(() => expect(window.chatAPI.searchMessages).toHaveBeenCalledWith('obsolete', false));
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'solstice');
    await act(async () => finish({ success: true, data: { hits: [{ id: 'a', messageId: 'm1', excerpt: 'Old response' }], incomplete: false } }));
    expect(screen.queryByText('Old response')).not.toBeInTheDocument();
    const row = await screen.findByRole('button', { name: /^A quiet morning/ });
    await waitFor(() => expect(row).toHaveTextContent('Remember the solstice'));
    expect(row.querySelector('mark')).toHaveTextContent('solstice');
    expect(screen.getByText('A quiet morning')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^A quiet morning/ }));
    expect(onSelect).toHaveBeenCalledWith('a', 'm1');
  });
  it('retries failed message search while preserving immediate title matches', async () => {
    const user = userEvent.setup();
    window.chatAPI.searchMessages = vi.fn().mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue({ success: true, data: { hits: [], incomplete: true } });
    render(<TooltipProvider><ConversationList conversations={conversations} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onArchive={vi.fn()} /></TooltipProvider>);
    await user.type(screen.getByRole('searchbox'), 'morning');
    expect(screen.getByText('A quiet morning')).toBeVisible();
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('may be incomplete'));
    expect(window.chatAPI.searchMessages).toHaveBeenLastCalledWith('morning', false);
  });
  it('prioritizes pinned threads and lets you unpin them', async () => {
    const onPin = vi.fn();
    render(<TooltipProvider><ConversationList conversations={[conversations[0], { ...conversations[0], id: 'p', title: 'Keep close', pinnedAt: 1, updatedAt: 1 }]} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onArchive={vi.fn()} onPin={onPin} /></TooltipProvider>);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Keep close');
    await userEvent.click(screen.getByRole('button', { name: 'Unpin thread Keep close' }));
    expect(onPin).toHaveBeenCalledWith('p', false);
  });
  it('keeps unreadable threads visible for recovery without offering mutations', () => {
    render(<TooltipProvider><ConversationList conversations={[{ ...conversations[0], unreadable: true }]} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onArchive={vi.fn()} onPin={vi.fn()} /></TooltipProvider>);
    expect(screen.getByText('File kept for recovery')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Archive thread A quiet morning' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pin thread A quiet morning' })).not.toBeInTheDocument();
  });
  it('recovers an unsent new-thread draft alongside saved threads', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TooltipProvider><ConversationList conversations={conversations} activeId="a" onSelect={onSelect} onNew={vi.fn()} onArchive={vi.fn()} drafts={{ new: 'Remember this' }} /></TooltipProvider>);
    await user.click(screen.getByRole('button', { name: /Unfinished thought/ }));
    expect(onSelect).toHaveBeenCalledWith('new');
  });
  it('finds attached drafts and originating dates while respecting archive scope', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TooltipProvider><ConversationList conversations={conversations} activeId="a" onSelect={onSelect} onNew={vi.fn()} onArchive={vi.fn()} drafts={{ a: 'Consider the solstice', b: 'Solstice archive' }} /></TooltipProvider>);
    await user.type(screen.getByRole('searchbox'), 'SOLSTICE');
    await user.click(screen.getByRole('button', { name: /^A quiet morning/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(screen.queryByText('Old ideas')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archived' }));
    expect(screen.getByText('Old ideas')).toBeVisible();
    expect(screen.queryByText('A quiet morning')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), '2026-09-09');
    await user.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.getByText('A quiet morning')).toBeVisible();
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
