import React, { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ChatRoute } from '@/renderer/features/chat';
import { useChatHandoffStore } from '@/renderer/features/chat/store/chatHandoffStore';
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
          <StrictMode><ChatRoute /></StrictMode>
          <LocationProbe />
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useChatStore.getState().reset();
  useChatHandoffStore.setState({ pending: [], drafts: {}, processing: false, error: null });
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

  it('shows progress with a Stop button while indexing, then the stopped-early note and skipped files', async () => {
    const api = installChatApi({ status: { indexing: true, progress: { phase: 'embedding', done: 20, total: 80, currentFile: '/Vault/Papers/atlas.pdf' } } });
    const user = userEvent.setup();
    renderChat();
    const bar = await screen.findByTestId('chat-index-status');
    await waitFor(() => expect(within(bar).getByRole('status')).toHaveTextContent('Embedding passages 20 of 80 · atlas.pdf'));
    expect(screen.getByRole('progressbar', { name: 'Indexing progress' })).toHaveAttribute('aria-valuenow', '25');
    expect(screen.queryByRole('button', { name: /Index library|Update index/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.indexCancel).toHaveBeenCalled());
    api.setStatus({ ready: true, files: 12, chunks: 40, cancelled: true, staleFiles: 60, skipped: [{ path: '/Vault/Papers/scan.pdf', reason: 'no text layer (scanned document?)' }] });
    expect(await screen.findByText(/stopped early/)).toBeInTheDocument();
    expect(screen.getByText(/60 changes since/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1 file skipped' }));
    expect(await screen.findByText('no text layer (scanned document?)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update index' })).toBeInTheDocument();
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

  it('offers starter questions on an empty conversation that fill the composer', async () => {
    installChatApi({ status: { ready: true, files: 2, chunks: 5 } });
    const user = userEvent.setup();
    renderChat();
    const suggestions = await screen.findByRole('list', { name: 'Suggested questions' });
    await user.click(within(suggestions).getByRole('button', { name: 'Summarize the notes in my library' }));
    const composer = screen.getByLabelText('Ask about your library') as HTMLTextAreaElement;
    expect(composer.value).toBe('Summarize the notes in my library');
    expect(composer).toHaveFocus();
  });
});


describe('task chat handoff', () => {
  it('opens one empty conversation with editable context, preserving another unsent draft across navigation', async () => {
    const api = installChatApi();
    const original = await api.create();
    if (!original.success) throw new Error('fixture');
    const user = userEvent.setup();
    const view = renderChat();
    await waitFor(() => expect(useChatStore.getState().active?.id).toBe(original.data.id));
    await user.type(screen.getByLabelText('Ask about your library'), 'Keep my original thought');
    view.unmount();
    useChatHandoffStore.getState().prepare({ title: 'Plan the launch', context: 'Decide the next step', sourcePath: '/Vault/launch.md', date: '2026-09-08' });
    renderChat();
    await waitFor(() => expect((screen.getByLabelText('Ask about your library') as HTMLTextAreaElement).value).toContain('Plan the launch'));
    const composer = screen.getByLabelText('Ask about your library') as HTMLTextAreaElement;
    expect(composer.value).toContain('Decide the next step');
    expect(composer.value).toContain('/Vault/launch.md');
    expect(composer.value).toContain('2026-09-08');
    expect(useChatStore.getState().active?.messages).toEqual([]);
    expect(api.conversations.size).toBe(2);
    expect(api.ask).not.toHaveBeenCalled();
    expect(api.indexUpdate).not.toHaveBeenCalled();
    await user.type(composer, ' Please be concise.');
    const handoffId = useChatStore.getState().active?.id;
    await act(async () => { await useChatStore.getState().select(original.data.id); });
    await waitFor(() => expect(composer).toHaveValue('Keep my original thought'));
    if (!handoffId) throw new Error('handoff missing');
    await act(async () => { await useChatStore.getState().select(handoffId); });
    await waitFor(() => expect(composer.value).toContain('Please be concise.'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
  });

  it('keeps a failed handoff available for explicit retry without duplicate conversations', async () => {
    const api = installChatApi();
    vi.mocked(api.create).mockRejectedValueOnce(new Error('Storage unavailable'));
    useChatHandoffStore.getState().prepare({ title: 'Prepare notes', date: '2026-09-08' });
    const user = userEvent.setup();
    renderChat();
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.ask).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry draft' }));
    await waitFor(() => expect((screen.getByLabelText('Ask about your library') as HTMLTextAreaElement).value).toContain('Prepare notes'));
    expect(api.conversations.size).toBe(1);
    expect(api.create).toHaveBeenCalledTimes(2);
  });
});


it('preserves a draft written before any conversation exists when a task arrives', async () => {
  const api = installChatApi();
  const user = userEvent.setup();
  const view = renderChat();
  await screen.findByText(/not indexed yet/);
  await user.type(screen.getByLabelText('Ask about your library'), 'An unsaved thought');
  view.unmount();
  useChatHandoffStore.getState().prepare({ title: 'New task', date: '2026-09-08' });
  renderChat();
  await waitFor(() => expect((screen.getByLabelText('Ask about your library') as HTMLTextAreaElement).value).toContain('New task'));
  expect(api.conversations.size).toBe(2);
  const previousId = [...api.conversations.keys()][0];
  await act(async () => { await useChatStore.getState().select(previousId); });
  await waitFor(() => expect(screen.getByLabelText('Ask about your library')).toHaveValue('An unsaved thought'));
  expect(api.ask).not.toHaveBeenCalled();
});

it('blocks editing and sending to the previous conversation while preparing a task draft', async () => {
  const api = installChatApi();
  const user = userEvent.setup();
  await useChatStore.getState().startConversation();
  const oldId = useChatStore.getState().active?.id;
  const view = renderChat();
  await user.type(screen.getByLabelText('Ask about your library'), 'Keep this in the previous conversation');
  view.unmount();
  const create = vi.mocked(api.create).getMockImplementation();
  if (!create) throw new Error('fixture');
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(api.create).mockImplementationOnce(async () => { await gate; return create(); });
  useChatHandoffStore.getState().prepare({ title: 'Next task', date: '2026-09-08' });
  renderChat();
  expect(await screen.findByRole('status', { name: 'Preparing task draft' })).toHaveTextContent('Preparing task draft');
  expect(screen.getByLabelText('Ask about your library')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(useChatStore.getState().active?.id).toBe(oldId);
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(api.ask).not.toHaveBeenCalled();
  await act(async () => { release(); await gate; });
  await waitFor(() => expect((screen.getByLabelText('Ask about your library') as HTMLTextAreaElement).value).toContain('Next task'));
  expect(screen.getByLabelText('Ask about your library')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(useChatHandoffStore.getState().drafts[oldId ?? '']).toBe('Keep this in the previous conversation');
});
