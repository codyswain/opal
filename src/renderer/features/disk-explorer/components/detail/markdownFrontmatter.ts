import { parseMetadataDocument } from '@/common/metadataValidation';

/**
 * Removes a valid authored-metadata frontmatter block before Markdown render.
 * This is renderer-only display logic; authored bytes remain owned by main.
 */
export function stripMarkdownFrontmatter(input: string): string {
  const text = input.startsWith('\ufeff') ? input.slice(1) : input;
  const opener = /^---(\r?\n)/.exec(text);
  if (!opener) return text;

  let cursor = opener[0].length;
  while (cursor <= text.length) {
    const nextNewline = text.indexOf('\n', cursor);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;
    const line = text.slice(cursor, lineEnd).replace(/\r$/, '');
    if (line === '---' || line === '...') {
      const raw = text.slice(opener[0].length, cursor);
      try {
        parseMetadataDocument(raw, false);
      } catch {
        return text;
      }
      return nextNewline === -1 ? '' : text.slice(nextNewline + 1);
    }
    if (nextNewline === -1) return text;
    cursor = nextNewline + 1;
  }
  return text;
}
