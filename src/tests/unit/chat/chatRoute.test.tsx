import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ChatRoute } from '@/renderer/features/chat';
import { useChatStore } from '@/renderer/features/chat/store/chatStore';
import { ShellProvider } from '@/renderer/features/shell';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { installChatApi } from '@/tests/helpers/chatApi';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/chat']}>
      <TooltipProvider>
        <ShellProvider routes={[{ path: '/chat', element: null, handle: { shell: { id: 'chat', header: { title: 'Chat' } } } }]} fallbackRoute={{ id: 'opal', header: { title: 'Opal' } }}>
          <ChatRoute />
          <LocationProbe />
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useChatStore.getState().reset();
  installActivityApi();
});

describe('ChatRoute', () => {
  it('explains an unindexed library, indexes on request, and points to Settings when the key is missing', async () => {
    const api = installChatApi();
    const user = userEvent.setup();
    renderChat();
    expect(await screen.findByText(/not indexed yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Index library' }));
    await waitFor(() => expect(api.indexUpdate).toHaveBeenCalled());
    expect(await screen.findByText(/2 files, 5 passages/)).toBeInTheDocument();
    api.setStatus({ error: 'Add your OpenAI API key in Settings to use Chat.' });
    expect(await screen.findByRole('link', { name: /API key in Settings/ })).toHaveAttribute('href', '/settings');
  });

  it('sends a question with Enter, streams, renders the cited answer, and opens a source', async () => {
    installChatApi({
      status: { ready: true, files: 2, chunks: 5 },
      answer: () => 'The **atlas** maps mountains [1].',
      sources: [{ n: 1, path: '/Vault/Projects/atlas.md', name: 'atlas.md', excerpt: 'maps mountains', score: 0.9 }],
    });
    const user = userEvent.setup();
    renderChat();
    await screen.findByText(/2 files, 5 passages/);
    const composer = screen.getByLabelText('Ask about your library');
    await user.type(composer, 'What maps the mountains?{Enter}');
    expect(await screen.findByTestId('chat-message-user')).toHaveTextContent('What maps the mountains?');
    await waitFor(() => expect(screen.getByTestId('chat-message-assistant')).toHaveTextContent('maps mountains [1].'));
    expect(screen.getByTestId('chat-message-assistant').querySelector('strong')).toHaveTextContent('atlas');
    expect(screen.getByRole('list', { name: 'Sources' })).toHaveTextContent('atlas.md');
    expect(composer).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open atlas.md' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/files?mode=focus&dir=%2FVault%2FProjects&file=%2FVault%2FProjects%2Fatlas.md'));
    expect(window.activityAPI.record).toHaveBeenCalledWith('/Vault/Projects/atlas.md', 'opened');
  });

  it('lists, switches and removes conversations', async () => {
    const api = installChatApi({ status: { ready: true, files: 1, chunks: 1 } });
    const first = await api.create();
    const firstId = first.success ? first.data.id : '';
    const older = api.conversations.get(firstId);
    if (!older) throw new Error('conversation missing');
    older.title = 'Older one';
    const user = userEvent.setup();
    renderChat();
    await screen.findByRole('button', { name: /^Older one/ });
    await user.click(screen.getByRole('button', { name: 'New' }));
    await waitFor(() => expect(useChatStore.getState().active?.title).toBe('New conversation'));
    await user.click(screen.getByRole('button', { name: /^Older one/ }));
    await waitFor(() => expect(useChatStore.getState().active?.id).toBe(firstId));
    await user.click(screen.getByRole('button', { name: 'Remove conversation Older one' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Older one/ })).not.toBeInTheDocument());
    expect(useChatStore.getState().active).toBeNull();
  });
});
