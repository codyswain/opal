import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import type { DigestReview, DigestReviewChoice, DigestReviewItem } from '@/types/digestReview';

interface DigestReviewDialogProps {
  root: string;
  review: DigestReview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactElement;
}

const CHOICES: readonly { value: DigestReviewChoice; label: string }[] = [
  { value: 'A', label: 'Prefer A' },
  { value: 'B', label: 'Prefer B' },
  { value: 'tie', label: 'No preference' },
  { value: 'neither', label: 'Both need work' },
];

function ReviewItems({ label, items }: { label: 'A' | 'B'; items: DigestReviewItem[] }) {
  return (
    <ol className="space-y-4" aria-label={`Version ${label}`}>
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={item.checked}
            disabled
            aria-label={`${label}: ${item.title}`}
            className="mt-1 h-3.5 w-3.5 flex-none accent-foreground"
          />
          <div className="min-w-0 flex-1 break-words">
            <p className={cn('text-ui font-medium', item.checked && 'text-foreground-tertiary line-through')}>
              {item.title}
            </p>
            {item.detail ? (
              <p className="mt-1 whitespace-pre-wrap text-control text-foreground-secondary">{item.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A new root/date/id mounts a fresh form, so a late response cannot change another day's review. */
function ReviewForm({ root, review }: Pick<DigestReviewDialogProps, 'root' | 'review'>) {
  const [{ shown, reason }, setForm] = React.useState({ shown: review, reason: review.vote?.reason ?? '' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pending = React.useRef(false);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  React.useEffect(() => {
    setForm((form) => {
      const previous = form.shown;
      // Disk notifications can race the IPC response. A stale snapshot must not hide a saved vote.
      const newerVote = review.vote && (!previous.vote || review.vote.chosenAt > previous.vote.chosenAt);
      if (!newerVote && previous.revealed && !review.revealed) return form;
      return {
        shown: {
          ...review,
          vote: newerVote ? review.vote : previous.vote ?? review.vote,
          revealed: previous.revealed || review.revealed,
          labels: review.labels ?? previous.labels,
          costUsd: review.costUsd ?? previous.costUsd,
        },
        reason: newerVote && form.reason === (previous.vote?.reason ?? '') ? review.vote!.reason : form.reason,
      };
    });
  }, [review]);

  const act = async (choice?: DigestReviewChoice) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = choice
        ? await window.vaultAPI.voteDigestReview(root, review.date, review.id, choice, reason.trim())
        : await window.vaultAPI.revealDigestReview(root, review.date, review.id);
      if (!mounted.current) return;
      if ('error' in result) setError(result.error);
      else {
        setForm((form) => ({ shown: result.data, reason: result.data.vote?.reason ?? form.reason }));
      }
    } catch (thrown) {
      if (mounted.current) setError(thrown instanceof Error ? thrown.message : 'Could not save the comparison.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const variants = shown.variants;
  const saved = shown.vote;
  const noteChanged = saved && reason.trim() !== saved.reason;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Which Top 3 would you prefer?</DialogTitle>
        <DialogDescription>{review.date}. Both versions use the same morning digest.</DialogDescription>
      </DialogHeader>
      {variants ? (
        <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {(['A', 'B'] as const).map((label) => (
            <section key={label} aria-label={`Answer ${label}`} className="min-w-0">
              <h3 className="mb-3 text-ui font-medium">
                {label}
                {shown.revealed && shown.labels ? (
                  <span className="ml-2 text-control font-normal text-foreground-tertiary">{shown.labels[label]}</span>
                ) : null}
              </h3>
              <ReviewItems label={label} items={variants[label].items} />
            </section>
          ))}
        </div>
      ) : <p className="mt-4 text-ui text-foreground-secondary">No comparison is available for this day.</p>}
      {variants ? (
        <div className="mt-5 border-t border-border pt-4">
          <label htmlFor="digest-review-reason" className="text-control text-foreground-secondary">Why? <span className="text-foreground-tertiary">Optional</span></label>
          <textarea
            id="digest-review-reason"
            value={reason}
            maxLength={1000}
            rows={2}
            disabled={busy}
            onChange={(event) => setForm((form) => ({ ...form, reason: event.target.value }))}
            className="mt-1 block w-full resize-y rounded-control border border-border-strong bg-canvas px-2 py-1.5 text-ui text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
          />
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Your preference">
            {CHOICES.map((choice) => (
              <Button
                key={choice.value}
                size="compact"
                variant={saved?.choice === choice.value ? 'default' : 'outline'}
                aria-pressed={saved?.choice === choice.value}
                disabled={busy}
                onClick={() => void act(choice.value)}
              >
                {choice.label}
              </Button>
            ))}
            {noteChanged ? (
              <Button size="compact" variant="ghost" disabled={busy} onClick={() => void act(saved.choice)}>Save note</Button>
            ) : null}
          </div>
          <div aria-live="polite" className="mt-2 text-control text-foreground-tertiary">
            {busy ? 'Saving…' : saved ? 'Preference saved.' : ''}
          </div>
          {!shown.revealed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act()}
              className="mt-2 rounded-sm text-control text-foreground-tertiary underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
            >
              Reveal versions
            </button>
          ) : (
            <p className="mt-2 text-control text-foreground-tertiary">
              {shown.costUsd === undefined ? '' : `$${shown.costUsd.toFixed(3)} used. `}
              ${shown.budgetUsd.toFixed(2)} daily cap.
            </p>
          )}
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-ui font-medium text-foreground">{error}</p> : null}
    </>
  );
}

export function DigestReviewDialog({ root, review, open, onOpenChange, trigger }: DigestReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
        <ReviewForm key={`${root}:${review.date}:${review.id}`} root={root} review={review} />
      </DialogContent>
    </Dialog>
  );
}
