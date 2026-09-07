import type { FileKind } from '@/common/fileKind';
import type { DiskEntry } from './disk';
import type { ActivityKind } from './activity';

export type CollectionSortField = 'touched' | 'opened' | 'modified' | 'name';
export type SortDirection = 'asc' | 'desc';

export interface CollectionSort {
  field: CollectionSortField;
  direction: SortDirection;
}

export type CollectionScope =
  | { kind: 'all-roots' }
  | { kind: 'folders'; folders: string[]; includeDescendants: boolean };

export type ActivityField = 'touched' | 'opened';

export type CollectionFilter =
  | { field: 'name'; op: 'contains' | 'not-contains'; value: string }
  | { field: 'kind'; op: 'in' | 'not-in'; values: FileKind[] }
  | { field: 'tags'; op: 'has-any' | 'has-all' | 'has-none'; values: string[] }
  | { field: 'tags'; op: 'is-empty' }
  | { field: 'description'; op: 'is-empty' | 'is-not-empty' }
  | { field: ActivityField; op: 'within'; durationMs: number }
  | { field: ActivityField; op: 'before' | 'after'; at: number }
  | { field: ActivityField; op: 'never' }
  | { field: 'modified'; op: 'within'; durationMs: number }
  | { field: 'modified'; op: 'before' | 'after'; at: number };

export type CollectionFilterField = CollectionFilter['field'];

/** Every chip must match; multi-value operations are OR within one chip. */
export interface CollectionQuery {
  version: 1;
  scope: CollectionScope;
  filters: CollectionFilter[];
  sort: CollectionSort;
}

export interface CollectionPage {
  offset: number;
  limit: number;
}

export interface CollectionRow {
  entry: DiskEntry;
  /** Null when the item's metadata could not be read. */
  tags: string[] | null;
  descriptionEmpty: boolean | null;
  touchedAt: number | null;
  touchedKind: ActivityKind | null;
  openedAt: number | null;
}

export type CollectionIndexState = 'building' | 'ready';

export interface CollectionQueryResult {
  rows: CollectionRow[];
  total: number;
  offset: number;
  limit: number;
  /** True when items were excluded because a predicate needed unreadable metadata. */
  incomplete: boolean;
  warnings: string[];
  indexState: CollectionIndexState;
  /** Scoped folders that are not inside any opened root. The query never widens past them. */
  unavailableScopes: string[];
  generation: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export const COLLECTION_PAGE_DEFAULT = 200;
export const COLLECTION_PAGE_MAX = 1000;
