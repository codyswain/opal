import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { JournalPanel } from '@/renderer/features/today/JournalPanel';
import { useJournalStore } from '@/renderer/features/today/journalStore';

beforeEach(() => {useJournalStore.setState({drafts:{}}); window.markdownAPI = {read:vi.fn(),write:vi.fn(),create:vi.fn()};});
it('removes private writing and source links from the rendered page while hidden', () => {
  render(<JournalPanel path="/day" journal="Private thoughts" hidden onOpen={vi.fn()} />);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText('Private thoughts')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Open daily/})).not.toBeInTheDocument();
});
it('keeps the draft when privacy is toggled', async () => {
  window.markdownAPI.read = vi.fn().mockResolvedValue({success:true,data:{body:'Original',revision:'r'}});
  window.markdownAPI.write = vi.fn().mockResolvedValue({success:true,data:{revision:'s'}});
  const props = {path:'/day',journal:'Original',onOpen:vi.fn()};
  const {rerender} = render(<JournalPanel {...props} hidden={false}/>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Draft'}});
  rerender(<JournalPanel {...props} hidden/>);
  rerender(<JournalPanel {...props} hidden={false}/>);
  expect(screen.getByRole('textbox')).toHaveValue('Draft');
  fireEvent.click(screen.getByRole('button',{name:'Save now'}));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved to your vault'));
});
