import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ShellProvider } from '@/renderer/features/shell';
import { ContinueThinking } from '@/renderer/features/chat/components/ContinueThinking';
import { installChatApi } from '@/tests/helpers/chatApi';

it('offers active threads on Today without indexing or asking a model', async () => {
  const api = installChatApi();
  await api.create({ title: 'A thought to return to' });
  const old = await api.create({ title: 'Archived thought' });
  if (!old.success) throw new Error('fixture');
  await api.update(old.data.id, { archived: true });
  render(<MemoryRouter><ShellProvider routes={[]} fallbackRoute={{ id: 'today', header: { title: 'Today' } }}><ContinueThinking /></ShellProvider></MemoryRouter>);
  expect(await screen.findByRole('button', { name: /A thought to return to/ })).toBeInTheDocument();
  expect(screen.queryByText('Archived thought')).not.toBeInTheDocument();
  expect(api.ask).not.toHaveBeenCalled();
  expect(api.indexUpdate).not.toHaveBeenCalled();
});


it.each(['response', 'exception'])('keeps a failed thread load visible and retries it (%s)', async (failure) => {
  const api = installChatApi();
  const list = vi.mocked(api.list);
  if (failure === 'response') list.mockResolvedValueOnce({ success: false, error: 'Unavailable' });
  else list.mockRejectedValueOnce(new Error('Unavailable'));
  await api.create({ title: 'Still saved' });
  render(<MemoryRouter><ShellProvider routes={[]} fallbackRoute={{ id: 'today', header: { title: 'Today' } }}><ContinueThinking /></ShellProvider></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your threads');
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading threads' }));
  expect(await screen.findByRole('button', { name: /Still saved/ })).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(api.ask).not.toHaveBeenCalled();
  expect(api.indexUpdate).not.toHaveBeenCalled();
});
