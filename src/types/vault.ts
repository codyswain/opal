import type { MarkdownDocument } from "./markdown";

export interface VaultInfo {
  path: string;
  name: string;
}
export interface VaultTask {
  id: string;
  title: string;
  source: "markdown" | "triage";
  sourcePath: string;
  status: "open" | "suggested";
  context?: string;
  sourceRef?: string;
}
export interface FocusItem {
  id: string;
  title: string;
  taskId?: string;
  source?: VaultTask;
  completed: boolean;
  createdAt: string;
}
export interface VaultDay {
  root: string;
  date: string;
  logPath: string;
  document: MarkdownDocument | null;
  brief: string;
  digestPath: string | null;
  digestUpdatedAt: number | null;
  tasks: VaultTask[];
  focus: FocusItem[];
  photos: string[];
  warnings: string[];
}
export interface JournalDraft {
  path: string;
  baseJournal: string;
  text: string;
  version: string;
}
export type VaultResult<T> =
  { success: true; data: T } | { success: false; error: string };
export interface VaultAPI {
  discover: () => Promise<VaultResult<VaultInfo[]>>;
  readDay: (root: string, date: string) => Promise<VaultResult<VaultDay>>;
  createDay: (root: string, date: string) => Promise<VaultResult<undefined>>;
  saveJournal: (
    path: string,
    original: string,
    next: string,
  ) => Promise<VaultResult<{ journal: string; revision: string }>>;
  addFocus: (
    root: string,
    date: string,
    input: { title: string; taskId?: string },
  ) => Promise<VaultResult<FocusItem[]>>;
  updateFocus: (
    root: string,
    date: string,
    id: string,
    patch: { completed?: boolean; remove?: boolean; title?: string },
  ) => Promise<VaultResult<FocusItem[]>>;
  listDrafts: () => Promise<VaultResult<JournalDraft[]>>;
  putDraft: (draft: JournalDraft) => Promise<VaultResult<undefined>>;
  clearDraft: (
    path: string,
    version: string,
  ) => Promise<VaultResult<undefined>>;
}
declare global {
  interface Window {
    vaultAPI: VaultAPI;
  }
}
