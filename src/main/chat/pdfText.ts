import path from 'path';

/** Pages are joined with a form feed so a character offset maps back to a page. */
export const PAGE_BREAK = '\f';

export class PdfTextError extends Error {}

interface PdfTextItem { str?: string; hasEOL?: boolean }
interface PdfPage { getTextContent(): Promise<{ items: PdfTextItem[] }>; cleanup(): void }
interface PdfDocument { numPages: number; getPage(n: number): Promise<PdfPage> }
interface PdfLoadingTask { promise: Promise<PdfDocument>; destroy(): Promise<void> }
interface PdfJs { getDocument(options: Record<string, unknown>): PdfLoadingTask }

let pdfjs: Promise<PdfJs> | null = null;

// pdfjs-dist ships ESM only. The main bundle is CommonJS and marks the package
// external, so this stays a real dynamic import that Node resolves at run time.
const PDFJS_MODULE = 'pdfjs-dist/legacy/build/pdf.mjs';

function load(): Promise<PdfJs> {
  if (!pdfjs) {
    pdfjs = (import(/* @vite-ignore */ PDFJS_MODULE) as Promise<PdfJs>).catch((error: unknown) => {
      pdfjs = null;
      throw new PdfTextError(`PDF support is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return pdfjs;
}

export interface ExtractPdfOptions {
  /** Stop after this many characters; the rest of the document is ignored. */
  maxCharacters?: number;
  /** Polled between pages so a long extraction can be abandoned. */
  isCancelled?: () => boolean;
}

/**
 * The text layer of every page, in reading order as pdf.js reports it, pages
 * separated by PAGE_BREAK. Scanned documents without a text layer yield an
 * empty string. Nothing is rendered, so no canvas is needed.
 */
export async function extractPdfText(bytes: Uint8Array, options: ExtractPdfOptions = {}): Promise<string> {
  const lib = await load();
  // pdf.js refuses Node Buffers; a plain view over the same memory is fine.
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let task: PdfLoadingTask | null = null;
  try {
    task = lib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
    const document = await task.promise;
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      if (options.isCancelled?.()) break;
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      page.cleanup();
      const text = content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join('').trim();
      pages.push(text);
      length += text.length + 1;
      if (options.maxCharacters !== undefined && length >= options.maxCharacters) break;
    }
    return pages.join(PAGE_BREAK);
  } catch (error) {
    if (error instanceof PdfTextError) throw error;
    throw new PdfTextError(error instanceof Error && error.message ? error.message : 'The PDF could not be read.');
  } finally {
    await task?.destroy().catch(() => undefined);
  }
}

/** 1-based page containing a character offset in text produced by extractPdfText. */
export function pageAt(text: string, offset: number): number {
  let page = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 12) page += 1;
  return page;
}

export function isPdf(file: string): boolean {
  return path.extname(file).toLowerCase() === '.pdf';
}
