import * as React from 'react';
import type { DayRecording } from '@/types/day';
import { openTitle } from '../dayLinks';
import { RowTime, rowStyles } from './DayCard';
import { useDaySidebarContext, vaultRelative } from './daySidebarContext';

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

/** The tooltip: where the row goes, then the source and who was there. */
export function recordingTitle(recording: DayRecording, file: string): string {
  const people = recordingPeople(recording);
  return `${openTitle(file)}\n${recordingMeta(recording)}.${people.length ? `\n${people.join(', ')}` : ''}`;
}

/**
 * A Meet or Pocket recording. A click opens its page, the summary note with
 * its links and its transcript below, in this tab; Cmd-click opens a new tab.
 */
export function RecordingRow({ recording }: { recording: DayRecording }) {
  const { openPath, root } = useDaySidebarContext();
  return (
    <button
      type="button"
      title={recordingTitle(recording, vaultRelative(root, recording.path))}
      onClick={(event) => openPath(recording.path, event)}
      onAuxClick={(event) => event.button === 1 && openPath(recording.path, event)}
      className={rowStyles}
    >
      <RowTime>{recording.time}</RowTime>
      <span className="min-w-0 flex-1 truncate">{recording.title}</span>
      {recording.durationMin !== null ? (
        <span className="flex-none text-2xs tabular-nums text-foreground-tertiary">{recording.durationMin} min</span>
      ) : null}
    </button>
  );
}
