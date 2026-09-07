/**
 * A minimal, uncompressed PDF with one Helvetica text line per page. Enough
 * for pdf.js to parse and extract, small enough to build inline in a test.
 */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, index) => `${3 + 2 * index} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const fontId = 3 + 2 * pages.length;
  pages.forEach((text, index) => {
    const escaped = text.replace(/[\\()]/g, (char) => `\\${char}`);
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + 2 * index} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
