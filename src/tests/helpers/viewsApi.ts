import { vi } from 'vitest';
import type { ViewsAPI } from '@/renderer/shared/types/viewsApi';
import type { SavedView, SavedViewDefinition } from '@/types/savedView';
import { emptyQuery } from '@/common/collectionQuery';

let counter = 0;

export function savedView(over: Partial<SavedView> = {}): SavedView {
  counter += 1;
  const id = over.id ?? `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  return {
    id,
    name: 'Project references',
    layout: 'list',
    query: emptyQuery(),
    revision: `rev-${counter}`,
    file: `/library/views/${id}.yaml`,
    ...over,
  };
}

/**
 * An in-memory viewsAPI: creates, saves, duplicates, removes and restores
 * behave like the repository so component tests can run whole flows.
 */
export function installViewsApi(initial: SavedView[] = [], overrides: Partial<ViewsAPI> = {}): ViewsAPI & { views: SavedView[] } {
  const views = [...initial];
  const trash = new Map<string, SavedView>();
  const conflictIds = new Set<string>();
  const api: ViewsAPI & { views: SavedView[] } = {
    views,
    list: vi.fn(async () => ({ success: true as const, data: { views: [...views], unreadable: [] } })),
    create: vi.fn(async (definition: SavedViewDefinition) => {
      const view = savedView({ ...definition });
      views.push(view);
      return { success: true as const, data: view };
    }),
    save: vi.fn(async (id: string, definition: SavedViewDefinition, expectedRevision: string) => {
      const index = views.findIndex((view) => view.id === id);
      if (index < 0) return { success: false as const, error: 'This view no longer exists.' };
      if (views[index].revision !== expectedRevision || conflictIds.has(id)) {
        return { success: false as const, error: 'This view changed on disk since you opened it.', conflict: true as const };
      }
      counter += 1;
      const view = { ...views[index], ...definition, revision: `rev-${counter}` };
      views[index] = view;
      return { success: true as const, data: view };
    }),
    duplicate: vi.fn(async (id: string) => {
      const source = views.find((view) => view.id === id);
      if (!source) return { success: false as const, error: 'This view no longer exists.' };
      const copy = savedView({ name: `${source.name} copy`, query: source.query, layout: source.layout });
      views.splice(views.indexOf(source) + 1, 0, copy);
      return { success: true as const, data: copy };
    }),
    remove: vi.fn(async (id: string) => {
      const index = views.findIndex((view) => view.id === id);
      if (index < 0) return { success: false as const, error: 'This view no longer exists.' };
      const [removed] = views.splice(index, 1);
      const undoToken = `${id}-${Date.now()}`;
      trash.set(undoToken, removed);
      return { success: true as const, data: { undoToken } };
    }),
    restore: vi.fn(async (undoToken: string) => {
      const view = trash.get(undoToken);
      if (!view) return { success: false as const, error: 'This view can no longer be restored.' };
      trash.delete(undoToken);
      views.push(view);
      return { success: true as const, data: view };
    }),
    onChanged: vi.fn(() => () => undefined),
    ...overrides,
  };
  (api as unknown as { markConflict: (id: string) => void }).markConflict = (id) => conflictIds.add(id);
  (window as unknown as { viewsAPI: ViewsAPI }).viewsAPI = api;
  return api;
}
