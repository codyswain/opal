import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
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
