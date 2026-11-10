import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DigestReviewDialog } from '@/renderer/features/day-sidebar/components/DigestReviewDialog';
import type { DigestReview, DigestReviewChoice } from '@/types/digestReview';
import type { VaultResult } from '@/types/vault';

const ROOT = '/Vault';
const vote = vi.fn();
const reveal = vi.fn();
const checkDigestItem = vi.fn();

function review(extra: Partial<DigestReview> = {}): DigestReview {
  return {
    id: 'morning-one',
    date: '2026-11-04',
    createdAt: '2026-11-04T15:00:00.000Z',
    status: 'ready',
    budgetUsd: 0.25,
    revealed: false,
    variants: {
      A: { items: [{ title: 'Email Kyle with the full consent checklist', detail: 'Use CODY-210. Preserve Lucas’s 0.5%.', checked: true }] },
      B: { items: [{ title: 'Email Kyle the consent checklist', detail: 'Use CODY-210. Preserve Lucas’s 0.5%.', checked: true }] },
    },
    ...extra,
  };
}

function saved(choice: DigestReviewChoice = 'A', reason = ''): DigestReview {
  return review({
    revealed: true,
    labels: { A: 'Current digest', B: 'Shorter headings' },
    costUsd: 0.012,
    vote: { choice, reason, chosenAt: '2026-11-04T16:00:00.000Z', blind: true },
  });
}

beforeEach(() => {
  vote.mockReset();
  reveal.mockReset();
  checkDigestItem.mockReset();
  Object.defineProperty(window, 'vaultAPI', {
    configurable: true,
    value: { voteDigestReview: vote, revealDigestReview: reveal, checkDigestItem },
  });
});

const show = (value = review()) => render(<DigestReviewDialog root={ROOT} review={value} open onOpenChange={vi.fn()} />);

describe('digest comparison', () => {
  it('keeps identities and cost hidden, and comparison checkboxes cannot change the digest', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Which Top 3 would you prefer?');
    expect(screen.queryByText('Current digest')).not.toBeInTheDocument();
    expect(screen.queryByText('Shorter headings')).not.toBeInTheDocument();
    expect(screen.queryByText(/daily cap/)).not.toBeInTheDocument();
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeChecked();
      expect(checkbox).toBeDisabled();
      await user.click(checkbox);
    }
    expect(checkDigestItem).not.toHaveBeenCalled();
    expect(vote).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Preserve Lucas’s 0.5%/)).toHaveLength(2);
  });

  it('saves the chosen version and reason, then shows the returned identities', async () => {
    const user = userEvent.setup();
    vote.mockResolvedValue({ success: true, data: saved('B', 'Shorter, same facts') });
    show();
    await user.type(screen.getByRole('textbox', { name: 'Why? Optional' }), 'Shorter, same facts');
    await user.click(screen.getByRole('button', { name: 'Prefer B' }));
    await waitFor(() => expect(vote).toHaveBeenCalledWith(ROOT, '2026-11-04', 'morning-one', 'B', 'Shorter, same facts'));
    expect(await screen.findByText('Preference saved.')).toBeInTheDocument();
    expect(screen.getByText('Current digest')).toBeInTheDocument();
    expect(screen.getByText('Shorter headings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prefer B' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('$0.012 used. $0.25 daily cap.')).toBeInTheDocument();
    expect(checkDigestItem).not.toHaveBeenCalled();
  });

  it('keeps a failed save blind and lets the user retry', async () => {
    const user = userEvent.setup();
    vote.mockResolvedValueOnce({ success: false, error: 'Could not write the preference.' });
    vote.mockResolvedValueOnce({ success: true, data: saved('tie') });
    show();
    await user.click(screen.getByRole('button', { name: 'No preference' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not write the preference.');
    expect(screen.queryByText('Current digest')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No preference' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'No preference' }));
    expect(await screen.findByText('Preference saved.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('restores an existing vote and can save its changed note without touching digest ticks', async () => {
    const user = userEvent.setup();
    vote.mockResolvedValue({ success: true, data: saved('A', 'Clearer headings') });
    show(saved('A', 'Clearer'));
    expect(screen.getByRole('button', { name: 'Prefer A' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Why? Optional' })).toHaveValue('Clearer');
    await user.type(screen.getByRole('textbox', { name: 'Why? Optional' }), ' headings');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(vote).toHaveBeenCalledWith(ROOT, '2026-11-04', 'morning-one', 'A', 'Clearer headings'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument());
    expect(checkDigestItem).not.toHaveBeenCalled();
  });

  it('reveals only on request, without recording a preference', async () => {
    const user = userEvent.setup();
    reveal.mockResolvedValue({ success: true, data: review({ revealed: true, labels: { A: 'Current digest', B: 'Shorter headings' } }) });
    show();
    await user.click(screen.getByRole('button', { name: 'Reveal versions' }));
    await waitFor(() => expect(reveal).toHaveBeenCalledWith(ROOT, '2026-11-04', 'morning-one'));
    expect(await screen.findByText('Shorter headings')).toBeInTheDocument();
    expect(vote).not.toHaveBeenCalled();
    expect(screen.queryByText('Preference saved.')).not.toBeInTheDocument();
  });

  it('restores keyboard focus to the comparison trigger after closing', async () => {
    const user = userEvent.setup();
    function TriggeredComparison() {
      const [open, setOpen] = React.useState(false);
      return <DigestReviewDialog root={ROOT} review={review()} open={open} onOpenChange={setOpen} trigger={<button>Compare versions</button>} />;
    }
    render(<TriggeredComparison />);
    const trigger = screen.getByRole('button', { name: 'Compare versions' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps a saved vote and reveal when a stale watcher snapshot arrives', async () => {
    const user = userEvent.setup();
    vote.mockResolvedValue({ success: true, data: saved('B', 'Clearer') });
    const view = show();
    await user.click(screen.getByRole('button', { name: 'Prefer B' }));
    expect(await screen.findByText('Preference saved.')).toBeInTheDocument();
    view.rerender(<DigestReviewDialog root={ROOT} review={review()} open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Prefer B' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Why? Optional' })).toHaveValue('Clearer');
    expect(screen.getByText('Shorter headings')).toBeInTheDocument();
  });

  it('does not let a late response change a different day or pair', async () => {
    const user = userEvent.setup();
    let finish: (value: VaultResult<DigestReview>) => void = () => undefined;
    vote.mockImplementation(() => new Promise<VaultResult<DigestReview>>((resolve) => { finish = resolve; }));
    const view = show();
    await user.click(screen.getByRole('button', { name: 'Prefer A' }));
    const tomorrow = review({ id: 'morning-two', date: '2026-11-05' });
    view.rerender(<DigestReviewDialog root={ROOT} review={tomorrow} open onOpenChange={vi.fn()} />);
    await act(async () => { finish({ success: true, data: saved() }); });
    expect(screen.getByText('2026-11-05. Both versions use the same morning digest.')).toBeInTheDocument();
    expect(screen.queryByText('Current digest')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prefer A' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Preference saved.')).not.toBeInTheDocument();
  });
});
