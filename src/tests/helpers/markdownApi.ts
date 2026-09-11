import { vi } from 'vitest';
import type { MarkdownAPI } from '@/renderer/shared/types/markdownApi';

/**
 * An in-memory markdownAPI: documents are keyed by path with a revision that
 * changes on every write, and `conflictOn` makes the next write of a path
 * fail like an external edit would.
 */
export function installMarkdownApi(initial: Record<string, string> = {}, overrides: Partial<MarkdownAPI> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, body]) => [path, { body, revision: `rev-${path}-1` }]));
  const conflicts = new Set<string>();
  let counter = 1;
  const api: MarkdownAPI & { documents: typeof documents; conflictOn: (path: string) => void; externalEdit: (path: string, body: string) => void } = {
    documents,
    conflictOn: (path) => conflicts.add(path),
    externalEdit: (path, body) => { counter += 1; documents.set(path, { body, revision: `rev-external-${counter}` }); },
    read: vi.fn(async (target: string) => {
      const document = documents.get(target);
      if (!document) return { success: false as const, error: 'Only Markdown files can be edited here.' };
      return { success: true as const, data: { path: target, body: document.body, revision: document.revision, size: document.body.length, hasFrontmatter: false } };
    }),
    write: vi.fn(async (target: string, body: string, expectedRevision: string) => {
      const document = documents.get(target);
      if (!document) return { success: false as const, error: 'This file no longer exists.' };
      if (document.revision !== expectedRevision || conflicts.has(target)) {
        conflicts.delete(target);
        return { success: false as const, error: 'This file changed on disk since you opened it.', conflict: true as const };
      }
      counter += 1;
      const revision = `rev-${counter}`;
      documents.set(target, { body, revision });
      return { success: true as const, data: { revision } };
    }),
    create: vi.fn(async (parentDir: string, baseName = 'Untitled') => {
      let index = 1;
      let candidate = `${parentDir}/${baseName}.md`;
      while (documents.has(candidate)) { index += 1; candidate = `${parentDir}/${baseName} ${index}.md`; }
      documents.set(candidate, { body: '', revision: `rev-${candidate}-1` });
      return { success: true as const, data: { path: candidate } };
    }),
    ...overrides,
  };
  (window as unknown as { markdownAPI: MarkdownAPI }).markdownAPI = api;
  return api;
}
