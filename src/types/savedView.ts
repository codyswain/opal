import type { CollectionQuery } from './collectionQuery';

export type ViewLayout = 'list' | 'gallery';

/** Everything a view file holds; never results, selection, scroll or activity. */
export interface SavedViewDefinition {
  name: string;
  query: CollectionQuery;
  layout: ViewLayout;
}

export interface SavedView extends SavedViewDefinition {
  id: string;
  /** SHA-256 of the file bytes; saves must present the revision they were based on. */
  revision: string;
  file: string;
}

export interface UnreadableView {
  file: string;
  error: string;
}

export interface SavedViewsListing {
  views: SavedView[];
  unreadable: UnreadableView[];
}

export const VIEW_NAME_MAX_LENGTH = 120;
