import { beforeEach, describe, expect, it } from 'vitest';
import { hasProblem, hasUnsavedChanges, useDocumentStatusStore } from '@/renderer/features/disk-explorer/store/documentStatusStore';

beforeEach(() => useDocumentStatusStore.setState({ statuses: {} }));

describe('documentStatusStore', () => {
  it('tracks one save state per path and forgets closed editors', () => {
    const store = useDocumentStatusStore.getState();
    store.set('/V/a.md', 'dirty');
    store.set('/V/b.md', 'clean');
    expect(useDocumentStatusStore.getState().statuses).toEqual({ '/V/a.md': 'dirty', '/V/b.md': 'clean' });
    const before = useDocumentStatusStore.getState().statuses;
    store.set('/V/a.md', 'dirty');
    expect(useDocumentStatusStore.getState().statuses).toBe(before);
    store.clear('/V/a.md');
    expect(useDocumentStatusStore.getState().statuses).toEqual({ '/V/b.md': 'clean' });
  });

  it('classifies states for the tab indicators', () => {
    expect(['dirty', 'saving'].every((state) => hasUnsavedChanges(state as never))).toBe(true);
    expect(['clean', 'saved', undefined].some((state) => hasUnsavedChanges(state as never))).toBe(false);
    expect(['conflict', 'error'].every((state) => hasProblem(state as never))).toBe(true);
  });
});
