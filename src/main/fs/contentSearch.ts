import path from 'path';
import { readFile, stat } from 'fs/promises';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import { scanRootsFor, walkRoot } from '@/main/fs/rootTraversal';
import { assertNoSymlinks, splitMarkdown } from '@/main/fs/MetadataCodec';
import type { ContentSearchResult } from '@/types/disk';

export function matchingSnippet(text: string, query: string): string | null {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  return `${at > 70 ? '…' : ''}${text.slice(Math.max(0, at - 70), at + query.length + 140).replace(/\s+/g, ' ').trim()}${at + query.length + 140 < text.length ? '…' : ''}`;
}

/**
 * The excerpt for a hit, read from the page body so raw frontmatter never
 * shows. A match only in the frontmatter shows the property line it is on.
 */
export function contentExcerpt(bytes: Buffer, query: string): string | null {
  let frontmatter = '';
  let body: string;
  try {
    const split = splitMarkdown(bytes);
    frontmatter = split.raw;
    body = bytes.subarray(split.bodyOffset).toString('utf8');
  } catch {
    // An unclosed block is ordinary text, as the editor treats it.
    body = bytes.toString('utf8');
  }
  const needle = query.toLowerCase();
  const property = frontmatter.split(/\r?\n/).find((line) => line.toLowerCase().includes(needle));
  return matchingSnippet(body, query) ?? (property ? matchingSnippet(property, query) : null);
}

export async function searchCurrentText(registry: RootRegistry, query: string): Promise<ContentSearchResult> {
  const result: ContentSearchResult = { hits: [], incomplete: false };
  let bytesRead = 0;
  let filesRead = 0;
  for (const root of scanRootsFor(registry.list())) {
    await walkRoot(registry, root, {
      onDirectory: () => undefined,
      onFile: async (file) => {
        if (!/\.(?:md|markdown|txt)$/i.test(file)) return;
        if (filesRead >= 5000 || bytesRead >= 25 * 1024 * 1024 || result.hits.length >= 50) { result.incomplete = true; return; }
        try {
          await assertNoSymlinks(registry, file);
          const info = await stat(file);
          if (info.size > 1024 * 1024 || bytesRead + info.size > 25 * 1024 * 1024) { result.incomplete = true; return; }
          filesRead += 1; bytesRead += info.size;
          const excerpt = contentExcerpt(await readFile(file), query);
          if (excerpt) result.hits.push({ path: file, name: path.basename(file), excerpt });
        } catch { result.incomplete = true; }
      },
      onError: () => { result.incomplete = true; },
    });
  }
  return result;
}
