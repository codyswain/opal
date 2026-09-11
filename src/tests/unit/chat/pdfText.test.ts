import { describe, expect, it } from 'vitest';
import { PAGE_BREAK, PdfTextError, extractPdfText, isPdf, pageAt } from '@/main/chat/pdfText';
import { makePdf } from '@/tests/helpers/pdfFixture';

describe('extractPdfText', () => {
  it('returns each page\'s text separated by page breaks', async () => {
    const text = await extractPdfText(makePdf(['The atlas project maps mountains.', 'Rivers are on page two.']));
    expect(text.split(PAGE_BREAK)).toEqual(['The atlas project maps mountains.', 'Rivers are on page two.']);
    expect(pageAt(text, 0)).toBe(1);
    expect(pageAt(text, text.indexOf('Rivers'))).toBe(2);
  });

  it('yields an empty string for a document without a text layer', async () => {
    expect((await extractPdfText(makePdf(['']))).trim()).toBe('');
  });

  it('stops early when cancelled or when enough characters were read', async () => {
    const bytes = makePdf(['one', 'two', 'three']);
    let calls = 0;
    expect((await extractPdfText(bytes, { isCancelled: () => calls++ >= 1 })).split(PAGE_BREAK)).toEqual(['one']);
    expect((await extractPdfText(bytes, { maxCharacters: 5 })).split(PAGE_BREAK)).toEqual(['one', 'two']);
  });

  it('reports unreadable documents as a PdfTextError and recognizes the extension', async () => {
    await expect(extractPdfText(Buffer.from('%PDF-1.4 not really'))).rejects.toBeInstanceOf(PdfTextError);
    expect(isPdf('/a/b.PDF')).toBe(true);
    expect(isPdf('/a/b.md')).toBe(false);
  });
});
