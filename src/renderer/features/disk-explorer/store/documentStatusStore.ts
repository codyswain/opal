import { create } from 'zustand';
import type { MarkdownSaveState } from '../components/editor/useMarkdownDocument';

interface DocumentStatusState {
  /** Save state of every mounted editor, keyed by path; absent means nothing is editing that file. */
  statuses: Record<string, MarkdownSaveState>;
  set: (path: string, state: MarkdownSaveState) => void;
  clear: (path: string) => void;
}

/** Lets the tab strip show unsaved-change and problem indicators without owning editors. */
export const useDocumentStatusStore = create<DocumentStatusState>((set) => ({
  statuses: {},
  set: (path, state) => set((current) => (current.statuses[path] === state ? {} : { statuses: { ...current.statuses, [path]: state } })),
  clear: (path) => set((current) => {
    if (!(path in current.statuses)) return {};
    const statuses = { ...current.statuses };
    delete statuses[path];
    return { statuses };
  }),
}));

/** Unsaved work the person could lose; 'saving' counts because the write has not landed yet. */
export const hasUnsavedChanges = (state: MarkdownSaveState | undefined): boolean => state === 'dirty' || state === 'saving';
export const hasProblem = (state: MarkdownSaveState | undefined): boolean => state === 'conflict' || state === 'error';
