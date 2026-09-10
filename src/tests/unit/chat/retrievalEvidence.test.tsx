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
