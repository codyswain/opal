import type { DiskEntry } from './disk';

export type ActivityKind = 'opened' | 'organized' | 'edited';

export interface ActivityRecord {
  /** Absolute canonical path; the record key. */
  path: string;
  /** Metadata UUID readable when last recorded, or null. Never allocated here. */
  id: string | null;
  openedAt: number | null;
  organizedAt: number | null;
  editedAt: number | null;
}

export interface RecentItem {
  entry: DiskEntry;
  touchedAt: number;
  touchedKind: ActivityKind;
  openedAt: number | null;
  organizedAt: number | null;
  editedAt: number | null;
}

export interface RecentResult {
  /** Files only, most recently touched first. */
  items: RecentItem[];
  warnings: string[];
}

export interface RecentQuery {
  limit?: number;
  /** Leaves out anything last touched before this time, in epoch ms. */
  since?: number;
}

export const RECENT_DEFAULT_LIMIT = 200;
export const RECENT_MAX_LIMIT = 1000;
