// The files files.mdo shows, written into a gallery or acceptance vault: a
// picture with a transparent ground, a three-page PDF, a short movie and a
// voice memo (made with ffmpeg when it is installed), a deck, a model, an
// archive, a file still on the Mini, one that moved, one that is gone, and
// the October investor update's assets beside the page. Nothing here is
// fetched; the YouTube card stays a card.
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { crc32, deflateSync } from 'zlib';

const run = promisify(execFile);

/** An RGBA PNG: `paint(x, y)` gives each pixel's grey and opacity. */
export function png(width, height, paint) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [grey, alpha] = paint(x, y);
      const at = y * (1 + width * 4) + 1 + x * 4;
      rows[at] = grey;
      rows[at + 1] = grey;
      rows[at + 2] = grey;
      rows[at + 3] = alpha;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** A PDF of `pages`, each with a title and a few lines, that Chromium and macOS can draw. */
export function pdf(pages) {
  // 1 catalog, 2 page tree, 3 font, then each page and its content stream.
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const [index, title] of pages.entries()) {
    const lines = [`BT /F1 28 Tf 72 700 Td (${title}) Tj ET`, ...[0, 1, 2, 3, 4, 5].map((row) => `BT /F1 12 Tf 72 ${650 - row * 22} Td (Line ${row + 1} of page ${index + 1}: boxes per operator hour) Tj ET`), '0.6 g 72 360 468 120 re f'];
    const stream = lines.join('\n');
    const number = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${number + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(`${number} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A Git LFS placeholder for bytes that are not on this Mac. */
function pointer(bytes) {
  const oid = createHash('sha256').update(bytes).digest('hex');
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`;
}

/** A dark ring on a transparent ground, which needs the light tile in dark mode. */
const ring = (width, height) => png(width, height, (x, y) => {
  const d = Math.hypot(x - width / 2, y - height / 2);
  return d > height * 0.28 && d < height * 0.36 ? [38, 255] : x > width * 0.7 && y > height * 0.7 ? [90, 255] : [0, 0];
});

/** A grey photo-like gradient. */
const shade = (width, height) => png(width, height, (x, y) => [Math.round(60 + (150 * x) / width + 20 * Math.sin(y / 9)), 255]);

async function ffmpeg(args) {
  try {
    await run('ffmpeg', ['-v', 'error', ...args], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes the fixture's files under `vault`, with the page itself in `pageDir`.
 * Returns what it could make: movies and audio need ffmpeg.
 */
export default async function setup(vault, pageDir = path.join(vault, 'Gallery')) {
  const files = path.join(vault, 'Library/files/2026-11');
  const older = path.join(vault, 'Library/files/2026-10');
  const assets = path.join(pageDir, 'assets');
  await mkdir(files, { recursive: true });
  await mkdir(older, { recursive: true });
  await mkdir(assets, { recursive: true });
  await mkdir(path.join(vault, '.git'), { recursive: true });
  await mkdir(path.join(vault, '.opal'), { recursive: true });
  await writeFile(path.join(vault, '.opal/files.json'), JSON.stringify({ version: 1, folder: 'Library/files', store: 'git-lfs' }));

  await writeFile(path.join(files, 'diagram.a3f9c2e1.png'), ring(640, 360));
  await writeFile(path.join(files, 'q3-report.a3f9c2e1.pdf'), pdf(['Q3 report', 'Throughput', 'Next quarter']));
  await writeFile(path.join(files, 'gob-deck.a3f9c2e1.pptx'), Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.alloc(2048, 1)]));
  await writeFile(path.join(files, 'bracket.a3f9c2e1.stl'), 'solid bracket\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid bracket\n');
  await writeFile(path.join(files, 'logs.a3f9c2e1.zip'), Buffer.concat([Buffer.from('PK\u0005\u0006', 'latin1'), Buffer.alloc(18)]));
  await writeFile(path.join(files, 'throughput.a3f9c2e1.csv'), 'week,boxes\n2026-10-05,412\n2026-10-12,455\n');
  await writeFile(path.join(files, 'rig-sketch.a3f9c2e1.excalidraw'), '{"type":"excalidraw","elements":[]}');
  await writeFile(path.join(files, 'old-format.a3f9c2e1.avi'), Buffer.from('RIFF\u0000\u0000\u0000\u0000AVI LIST', 'latin1'));
  // Still on the Mini: a placeholder with no object here.
  await writeFile(path.join(files, 'board-deck.b7c8d9e0.pdf'), pointer(Buffer.from('a deck that lives on the Mini')));
  await writeFile(path.join(files, 'dock-photo.0badf00d.png'), pointer(Buffer.from('a photo that lives on the Mini')));
  // Moved: linked from 2026-11, kept in 2026-10 with the same hash.
  await writeFile(path.join(older, 'site-photo.c0ffee12.png'), shade(480, 270));

  await writeFile(path.join(assets, 'rig.png'), shade(960, 540));
  await writeFile(path.join(assets, 'bit.png'), ring(400, 300));
  await writeFile(path.join(assets, 'appendix.pdf'), pdf(['Appendix']));

  const movie = await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=duration=3:size=640x360:rate=12', '-vf', 'hue=s=0', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', '-y', path.join(files, 'night-shift.a3f9c2e1.mp4')]);
  if (movie) await ffmpeg(['-i', path.join(files, 'night-shift.a3f9c2e1.mp4'), '-c', 'copy', '-y', path.join(assets, 'rollout.mp4')]);
  const audio = await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-c:a', 'aac', '-b:a', '64k', '-y', path.join(files, 'standup-memo.a3f9c2e1.m4a')]);
  return { movie, audio, files, assets };
}
