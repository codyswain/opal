import { vi } from 'vitest';
import { isDocFile, pageName } from '@/common/fileKind';
import type { MarkdownAPI } from '@/renderer/shared/types/markdownApi';

/**
 * An in-memory markdownAPI: documents are keyed by path with a revision that
 * changes on every write, and `conflictOn` makes the next write of a path
 * fail like an external edit would. `setGitBusy(true)` stands for git
 * rewriting the repo: reads say so and writes are refused. Wiki links
 * resolve to notes and documents by name.
 */
export function installMarkdownApi(initial: Record<string, string> = {}, overrides: Partial<MarkdownAPI> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, body]) => [path, { body, revision: `rev-${path}-1` }]));
  const conflicts = new Set<string>();
  let counter = 1;
  let gitBusy = false;
  const unusedPath = (folder: string, name: string, extension = 'md') => {
    let index = 1;
    let candidate = `${folder}/${name}.${extension}`;
    while (documents.has(candidate)) { index += 1; candidate = `${folder}/${name} ${index}.${extension}`; }
    return candidate;
  };
  const api: MarkdownAPI & {
    documents: typeof documents;
    conflictOn: (path: string) => void;
    /** Changes a document outside the page; `revision` puts back one it had before. */
    externalEdit: (path: string, body: string, revision?: string) => void;
    setGitBusy: (busy: boolean) => void;
  } = {
    documents,
    conflictOn: (path) => conflicts.add(path),
    externalEdit: (path, body, revision) => { counter += 1; documents.set(path, { body, revision: revision ?? `rev-external-${counter}` }); },
    setGitBusy: (busy) => { gitBusy = busy; },
    read: vi.fn(async (target: string) => {
      const document = documents.get(target);
      if (!document) return { success: false as const, error: 'Only Markdown files can be edited here.' };
      return { success: true as const, data: { path: target, body: document.body, revision: document.revision, size: document.body.length, properties: 0, gitBusy } };
    }),
    // Paths below "/Vault/" read as relative to it, as below an opened folder.
    properties: vi.fn(async (target: string) => {
      const document = documents.get(target);
      if (!document) return { success: false as const, error: 'Only Markdown files can be edited here.' };
      return {
        success: true as const,
        data: {
          path: target,
          relativePath: target.replace(/^\/Vault\//, ''),
          properties: [],
          created: { ms: new Date(2026, 9, 28, 6, 38).getTime(), dayOnly: false },
          modifiedMs: new Date(2026, 9, 28, 6, 38).getTime(),
          size: new TextEncoder().encode(document.body).length,
        },
      };
    }),
    write: vi.fn(async (target: string, body: string, expectedRevision: string) => {
      const document = documents.get(target);
      if (!document) return { success: false as const, error: 'This file no longer exists.' };
      if (gitBusy) return { success: false as const, error: 'Git is changing files in this folder. Try again in a moment.', gitBusy: true as const };
      if (document.revision !== expectedRevision || conflicts.has(target)) {
        conflicts.delete(target);
        return { success: false as const, error: 'This file changed on disk since you opened it.', conflict: true as const };
      }
      counter += 1;
      const revision = `rev-${counter}`;
      documents.set(target, { body, revision });
      return { success: true as const, data: { revision } };
    }),
    create: vi.fn(async (parentDir: string, baseName = 'Untitled', extension = 'md') => {
      const candidate = unusedPath(parentDir, baseName, extension);
      documents.set(candidate, { body: '', revision: `rev-${candidate}-1` });
      return { success: true as const, data: { path: candidate } };
    }),
    // A copy goes next to the note; the recovery folder is the main process's concern.
    saveCopy: vi.fn(async (target: string, body: string, label: string) => {
      const candidate = unusedPath(target.slice(0, target.lastIndexOf('/')), `${pageName(target)} (${label})`, isDocFile(target) ? 'mdo' : 'md');
      documents.set(candidate, { body, revision: `rev-${candidate}-1` });
      return { success: true as const, data: { path: candidate } };
    }),
    // Resolves a target to an open document with that name, ignoring case.
    resolveLinks: vi.fn(async (_from: string, targets: string[]) => ({
      success: true as const,
      data: Object.fromEntries(targets.map((target) => [
        target,
        [...documents.keys()].find((path) => ['md', 'mdo'].some((extension) => path.toLowerCase().endsWith(`/${target.toLowerCase()}.${extension}`))) ?? null,
      ])),
    })),
    setFlushHandler: vi.fn(),
    ...overrides,
  };
  (window as unknown as { markdownAPI: MarkdownAPI }).markdownAPI = api;
  return api;
}
