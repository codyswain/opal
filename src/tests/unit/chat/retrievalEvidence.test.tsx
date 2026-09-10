import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MessageThread } from '@/renderer/features/chat/components/MessageThread';

it('keeps retrieval coverage available separately from the generated answer', async () => {
  render(<MessageThread messages={[{ id: 'a', role: 'assistant', content: 'A short reflection.', createdAt: 1, retrieval: { method: 'calendar', summary: 'Read two days of notes. Eight days have no readable notes.' } }]} streaming={null} onOpenSource={vi.fn()} />);
  expect(screen.getByText('A short reflection.')).toBeVisible();
  expect(screen.getByText('Daily notes checked')).toBeVisible();
  expect(screen.queryByText('Read two days of notes. Eight days have no readable notes.')).not.toBeVisible();
  await userEvent.click(screen.getByText('Daily notes checked'));
  expect(screen.getByText('Read two days of notes. Eight days have no readable notes.')).toBeVisible();
});

it('marks a stopped answer while keeping its partial text readable', () => {
  render(<MessageThread messages={[{ id: 'a', role: 'assistant', content: 'A partial thought', createdAt: 1, cancelled: true }]} streaming={null} onOpenSource={vi.fn()} />);
  expect(screen.getByText('A partial thought')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Stopped · partial answer saved');
});

it('focuses a selected search message once without pulling focus back on updates', () => {
  const messages = [{ id: 'first', role: 'user' as const, content: 'Earlier thought', createdAt: 1 }, { id: 'last', role: 'user' as const, content: 'Later thought', createdAt: 2 }];
  const props = { messages, streaming: null as string | null, onOpenSource: vi.fn() };
  const { rerender } = render(<><button>Keep writing</button><MessageThread {...props} /></>);
  const article = screen.getByText('Earlier thought').closest('article');
  if (!article) throw new Error('Expected a message article');
  article.scrollIntoView = vi.fn();
  const target = { messageId: 'first', sequence: 1 };
  rerender(<><button>Keep writing</button><MessageThread {...props} focusMessage={target} /></>);
  expect(article).toHaveFocus();
  expect(article.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  expect(article).toHaveAttribute('data-search-match', 'true');
  screen.getByRole('button', { name: 'Keep writing' }).focus();
  rerender(<><button>Keep writing</button><MessageThread {...props} messages={[...messages]} focusMessage={target} /></>);
  expect(screen.getByRole('button', { name: 'Keep writing' })).toHaveFocus();
  expect(article.scrollIntoView).toHaveBeenCalledTimes(1);
});
