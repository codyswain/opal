import * as React from 'react';
import { User } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';
import type { DayLink, DayRecording } from '@/types/day';
import { RowTime, rowBaseStyles } from './DayCard';
import { LinkList } from './DayLinks';
import { useDaySidebarContext, vaultRelative } from './daySidebarContext';
import { closeOnEscape } from './LogEntry';

const SOURCES: Record<string, string> = { meet: 'Google Meet', pocket: 'Pocket' };

/** "Google Meet, no notes yet" */
export function recordingMeta(recording: Pick<DayRecording, 'source' | 'hasSummary'>): string {
  const source = recording.source ? SOURCES[recording.source.toLowerCase()] ?? recording.source : 'Recording';
  return recording.hasSummary ? source : `${source}, no notes yet`;
}

/** The people who spoke, or without a transcript the people invited. */
export function recordingPeople(recording: Pick<DayRecording, 'speakers' | 'attendees'>): string[] {
  return [...new Set(recording.speakers.length ? recording.speakers : recording.attendees)];
}

interface RecordingRowProps {
  recording: DayRecording;
  open: boolean;
  onToggle: () => void;
}

/** A Meet or Pocket recording. It opens in place to who was there, the note and its Google links. */
export function RecordingRow({ onToggle, open, recording }: RecordingRowProps) {
  const { root } = useDaySidebarContext();
  const head = React.useRef<HTMLButtonElement>(null);
  const people = recordingPeople(recording);
  const note: DayLink = {
    label: 'Recording note',
    target: vaultRelative(root, recording.path).replace(/\.md$/, ''),
    external: false,
    path: recording.path,
  };

  return (
    <div onKeyDown={closeOnEscape(open, onToggle, head)}>
      <button
        ref={head}
        type="button"
        aria-expanded={open}
        title={open ? 'Hide the details' : 'Show who was there and the links'}
        onClick={onToggle}
        className={cn(rowBaseStyles, open ? 'min-h-[28px] items-baseline py-[5px] text-foreground' : 'h-row-compact')}
      >
        <RowTime>{recording.time}</RowTime>
        <span className={cn('min-w-0 flex-1', open ? 'whitespace-normal' : 'truncate')}>{recording.title}</span>
        {recording.durationMin !== null ? (
          <span className="flex-none text-2xs tabular-nums text-foreground-tertiary">{recording.durationMin} min</span>
        ) : null}
      </button>
      {open ? (
        <div className="pb-1.5 pl-12 pr-2">
          <div className="pb-1 pt-0.5 text-2xs tabular-nums text-foreground-tertiary">{recordingMeta(recording)}</div>
          {people.length ? (
            <div className="flex items-start gap-1.5 pb-1 text-control text-foreground-secondary">
              <User aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-icon" />
              <span className="min-w-0 break-words">{people.join(', ')}</span>
            </div>
          ) : null}
          <LinkList links={[note, ...recording.links]} />
        </div>
      ) : null}
    </div>
  );
}
