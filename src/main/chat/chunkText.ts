import type { TextChunk } from '@/types/chat';

export interface ChunkOptions {
  size: number;
  overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { size: 1200, overlap: 200 };

/**
 * Splits text into overlapping chunks on paragraph boundaries where possible.
 * Deterministic for a given input, so an unchanged file re-chunks identically.
 */
export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): TextChunk[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const size = Math.max(200, options.size);
  const overlap = Math.min(Math.max(0, options.overlap), Math.floor(size / 2));
  const chunks: TextChunk[] = [];
  const pieces: { start: number; text: string }[] = [];
  const paragraphPattern = /[^\n][\s\S]*?(?:\n{2,}|$)/g;
  let match: RegExpExecArray | null;
  while ((match = paragraphPattern.exec(normalized)) !== null) {
    if (match[0].trim().length === 0) continue;
    // A single paragraph longer than a chunk is cut on sentence-ish boundaries.
    let cursor = 0;
    const paragraph = match[0];
    while (cursor < paragraph.length) {
      let end = Math.min(paragraph.length, cursor + size);
      if (end < paragraph.length) {
        const breakAt = Math.max(paragraph.lastIndexOf('. ', end), paragraph.lastIndexOf('\n', end));
        if (breakAt > cursor + size / 2) end = breakAt + 1;
      }
      pieces.push({ start: match.index + cursor, text: paragraph.slice(cursor, end) });
      cursor = end;
    }
    if (match[0].length === 0) paragraphPattern.lastIndex += 1;
  }
  let current: { start: number; text: string } | null = null;
  const flush = () => {
    if (!current || current.text.trim().length === 0) return;
    chunks.push({ index: chunks.length, start: current.start, text: current.text.trimEnd() });
  };
  for (const piece of pieces) {
    if (!current) { current = { start: piece.start, text: piece.text }; continue; }
    if (current.text.length + piece.text.length <= size) { current.text += piece.text; continue; }
    flush();
    const carry = current.text.slice(-overlap);
    current = { start: piece.start - carry.length, text: carry + piece.text };
  }
  flush();
  return chunks;
}
