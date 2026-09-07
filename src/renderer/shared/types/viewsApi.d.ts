import type { SavedView, SavedViewDefinition, SavedViewsListing } from '@/types/savedView';

export type ViewResult<T> =
  | { success: true; data: T; error?: undefined; conflict?: undefined }
  | { success: false; error: string; data?: undefined; conflict?: true };

export interface ViewsAPI {
  list: () => Promise<ViewResult<SavedViewsListing>>;
  create: (definition: SavedViewDefinition) => Promise<ViewResult<SavedView>>;
  save: (id: string, definition: SavedViewDefinition, expectedRevision: string) => Promise<ViewResult<SavedView>>;
  duplicate: (id: string) => Promise<ViewResult<SavedView>>;
  remove: (id: string) => Promise<ViewResult<{ undoToken: string }>>;
  restore: (undoToken: string) => Promise<ViewResult<SavedView>>;
  onChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    viewsAPI: ViewsAPI;
  }
}
