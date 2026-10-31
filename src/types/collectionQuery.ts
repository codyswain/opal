import type { FileKind } from '@/common/fileKind';
import type { DiskEntry } from './disk';

/** `match` puts the best `matches` hits first; see evaluateQuery for the ties. */
export type CollectionSortField = 'touched' | 'name' | 'match';
export type SortDirection = 'asc' | 'desc';

export interface CollectionSort {
  field: CollectionSortField;
  direction: SortDirection;
}

/** Every opened folder; the palette's file search is the one caller. */
export interface CollectionScope {
  kind: 'all-roots';
}

/**
 * `matches` is the file switcher's match: on the name first, then every word
 * of the text in the path or the frontmatter title (matchFile.ts).
 */
export type CollectionFilter =
  | { field: 'name'; op: 'contains' | 'not-contains' | 'matches'; value: string }
  | { field: 'kind'; op: 'in' | 'not-in'; values: FileKind[] };

export type CollectionFilterField = CollectionFilter['field'];

/** Every filter must match; a kind filter matches any of its kinds. */
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
  /** When Opal last opened, edited or organized the item, or null. */
  touchedAt: number | null;
}

export interface CollectionQueryResult {
  rows: CollectionRow[];
  total: number;
  offset: number;
  limit: number;
  /** Directories that could not be scanned; the rows may be missing items under them. */
  warnings: string[];
}

export const COLLECTION_PAGE_DEFAULT = 200;
export const COLLECTION_PAGE_MAX = 1000;
