import { describe, expect, it } from 'vitest';
import { chunkText } from '@/main/chat/chunkText';

describe('chunkText', () => {
  it('keeps short text as one chunk and is deterministic', () => {
    const text = '# Title\n\nA short paragraph.\n\nAnother one.\n';
    const first = chunkText(text);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ index: 0, start: 0 });
    expect(first[0].text).toContain('Another one.');
    expect(chunkText(text)).toEqual(first);
  });

  it('splits on paragraph boundaries with overlap and tracks offsets', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`.trim());
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, { size: 1000, overlap: 150 });
    expect(chunks.length).toBeGreaterThan(2);
    chunks.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
      expect(chunk.text.length).toBeLessThanOrEqual(1000 + 150);
      // The recorded start points at the chunk's first character in the text.
      expect(text.slice(chunk.start, chunk.start + 20)).toBe(chunk.text.slice(0, 20));
    });
    // Consecutive chunks share the overlap tail.
    expect(chunks[1].text).toContain(chunks[0].text.slice(-60));
    expect(chunks.map((chunk) => chunk.text).join('')).toContain('Paragraph 11');
  });

  it('cuts an oversized paragraph on sentence boundaries', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} says something useful about the topic at hand.`).join(' ');
    const chunks = chunkText(text, { size: 600, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(700);
    expect(chunks[0].text.endsWith('.')).toBe(true);
  });

  it('ignores blank-only text and CRLF differences', () => {
    expect(chunkText('\n\n  \n')).toEqual([]);
    expect(chunkText('a\r\n\r\nb')[0].text).toBe('a\n\nb');
  });
});
