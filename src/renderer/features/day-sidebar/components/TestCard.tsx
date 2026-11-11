import * as React from 'react';
import { toast } from 'sonner';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { browseRecent, focusFile } from '@/renderer/features/disk-explorer/navigation';
import { selectOpenedPath, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import { openDaily } from '@/renderer/features/shell/utils/openDaily';
import { knowsVariant, useVariantsStore } from '@/renderer/features/variants';
import { Button, SegmentedControl } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import type { TestChoice, VariantSide, VaultTest } from '@/types/dailyTest';
import { weekdayName } from '../dayRule';
import { DayCard, FootButton } from './DayCard';

interface TestCardProps {
  test: VaultTest;
  today: string;
  /** Takes the test as an answer left it. */
  onAnswered: (test: VaultTest) => void;
}

/** "You picked Tighter.", "You picked neither." */
export function pickedLine({ test, answer }: VaultTest): string {
  if (!answer) return '';
  return answer.choice === 'neither' ? 'You picked neither.' : `You picked ${test[answer.choice].label}.`;
}

/**
 * The day's A/B test, at the top of the right sidebar. A switch tries each
 * version: for an interface test it puts the variant on that side and goes
 * where the test says; for a page test it opens that side's file in this
 * tab. Then A, B or Neither, a reason, and Send writes the answer file.
 * Once answered the card shrinks to one line, with Change to answer again.
 */
export function TestCard({ onAnswered, test: current, today }: TestCardProps) {
  const { root, date, test, answer } = current;
  const { navigateFiles } = useShell();
  const openedPath = useTabsStore(selectOpenedPath);
  const known = useVariantsStore((state) => knowsVariant(state, test.variant));
  const sides = useVariantsStore((state) => state.sides);
  const loadSides = useVariantsStore((state) => state.load);
  const setSide = useVariantsStore((state) => state.set);
  const takeSides = useVariantsStore((state) => state.take);
  const [collapsed, setCollapsed] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [choice, setChoice] = React.useState<TestChoice | null>(null);
  const [reason, setReason] = React.useState('');
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    void loadSides();
  }, [loadSides]);
  // A different test starts with an empty form.
  React.useEffect(() => {
    setEditing(false);
    setChoice(null);
    setReason('');
  }, [test.id]);

  const title = date === today ? "Today's test" : `Test from ${weekdayName(date)}`;
  const open = (path: string) => {
    recordOpened(path);
    navigateFiles(focusFile(path));
  };

  const on: VariantSide | 'none' =
    test.kind === 'interface'
      ? test.variant && sides[test.variant] === 'b' ? 'b' : 'a'
      : openedPath === test.a.path ? 'a' : openedPath === test.b.path ? 'b' : 'none';

  const apply = async (side: VariantSide) => {
    if (test.kind === 'page') {
      const path = test[side].path;
      if (path) open(path);
      return;
    }
    if (!test.variant) return;
    const error = await setSide(test.variant, side);
    if (error) {
      toast.error(error);
      return;
    }
    if (test.where === 'daily') void openDaily(navigateFiles);
    else if (test.where === 'recent') navigateFiles(browseRecent());
    else if (test.where) open(test.where);
  };

  const send = async () => {
    if (!choice || sending) return;
    setSending(true);
    try {
      const result = await window.vaultAPI.answerTest(root, date, test.id, choice, reason);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      takeSides(result.data.sides);
      setEditing(false);
      onAnswered({ ...current, answer: result.data.answer });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the answer.');
    } finally {
      setSending(false);
    }
  };

  const change = () => {
    setChoice(answer?.choice ?? null);
    setReason(answer?.reason ?? '');
    setEditing(true);
  };

  const answered = answer !== null && !editing;
  const tryable = test.kind === 'page' || known;
  const choices: { value: TestChoice; label: string }[] = [
    { value: 'a', label: test.a.label },
    { value: 'b', label: test.b.label },
    { value: 'neither', label: 'Neither' },
  ];

  return (
    <DayCard id="test" title={title} summary={test.title} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)}>
      <div className="px-2 text-foreground">{test.title}</div>
      {answered ? (
        <div className="flex items-center gap-0.5">
          <span className="truncate pl-2 text-control text-foreground-secondary">{pickedLine(current)}</span>
          <FootButton className="ml-auto" onClick={change}>
            Change
          </FootButton>
        </div>
      ) : (
        <>
          <div className="px-2 text-foreground-secondary">{test.question}</div>
          {tryable ? (
            <div className="px-2 pt-1.5">
              <SegmentedControl
                label="Version"
                className="flex w-full [&>button]:flex-1"
                options={[
                  { value: 'a', label: test.a.label },
                  { value: 'b', label: test.b.label },
                ]}
                value={on}
                onValueChange={(side) => void apply(side as VariantSide)}
              />
            </div>
          ) : (
            <div className="px-2 pt-1 text-control text-foreground-tertiary">This test needs a newer build of Opal.</div>
          )}
          {tryable ? (
            <form
              className="flex flex-col gap-1.5 px-2 pb-1 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <div role="group" aria-label="Your pick" className="flex gap-1">
                {choices.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={choice === option.value}
                    onClick={() => setChoice(option.value)}
                    className={cn(
                      'h-row-compact min-w-0 flex-1 truncate rounded-row border border-page-ring px-2 text-control text-foreground-secondary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus',
                      choice === option.value && 'border-foreground bg-surface-selected text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={reason}
                  placeholder="Why?"
                  aria-label="Why?"
                  maxLength={1000}
                  onChange={(event) => setReason(event.target.value)}
                  className="h-row-compact min-w-0 flex-1 rounded-row border border-page-ring bg-canvas px-2 text-control text-foreground outline-none placeholder:text-foreground-tertiary focus-visible:ring-2 focus-visible:ring-focus"
                />
                <Button type="submit" size="compact" className="h-row-compact text-control" disabled={!choice || sending}>
                  Send
                </Button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </DayCard>
  );
}
