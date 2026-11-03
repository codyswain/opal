import { deflateSync } from 'zlib';

/** Byte builders for the headers mediaHeaders.ts reads. Only the parts a reader looks at are real. */

const u16 = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
const u32le = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const u16le = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
const ascii = (text: string) => Buffer.from(text, 'latin1');

/** An ISO box: size, type, body. */
export const box = (type: string, ...body: Buffer[]) => {
  const content = Buffer.concat(body);
  return Buffer.concat([u32(8 + content.length), ascii(type), content]);
};

/**
 * An MP4 or QuickTime movie: ftyp, then moov with mvhd and one video trak
 * (and an audio trak with no size), and an mdat. `indexAtEnd` puts moov
 * after mdat, as a camera writes it. `turned` sets a quarter-turn matrix.
 */
export function movie(options: { seconds: number; scale?: number; width: number; height: number; indexAtEnd?: boolean; turned?: boolean; version1?: boolean }): Buffer {
  const { seconds, scale = 600, width, height, indexAtEnd = false, turned = false, version1 = false } = options;
  const duration = Math.round(seconds * scale);
  const mvhd = version1
    ? box('mvhd', Buffer.from([1, 0, 0, 0]), Buffer.alloc(16), u32(scale), Buffer.from([0, 0, 0, 0]), u32(duration), Buffer.alloc(80))
    : box('mvhd', Buffer.from([0, 0, 0, 0]), Buffer.alloc(8), u32(scale), u32(duration), Buffer.alloc(80));
  const matrix = turned
    ? [0, 0x10000, 0, -0x10000 >>> 0, 0, 0, 0, 0, 0x40000000]
    : [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
  const tkhd = (w: number, h: number) => box('tkhd',
    Buffer.from([0, 0, 0, 3]), Buffer.alloc(20), Buffer.alloc(16),
    Buffer.concat(matrix.map((value) => u32(value >>> 0))), u32(w * 65536), u32(h * 65536));
  const moov = box('moov', mvhd, box('trak', tkhd(0, 0)), box('trak', tkhd(width, height)));
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2mp41'));
  const mdat = box('mdat', Buffer.alloc(4096, 7));
  return Buffer.concat(indexAtEnd ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

/** A WAV of `seconds` of 16-bit stereo at `rate`, data chunk header only plus a little audio. */
export function wav(seconds: number, rate = 44100): Buffer {
  const byteRate = rate * 4;
  const fmt = Buffer.concat([ascii('fmt '), u32le(16), u16le(1), u16le(2), u32le(rate), u32le(byteRate), u16le(4), u16le(16)]);
  const data = Buffer.concat([ascii('data'), u32le(Math.round(seconds * byteRate)), Buffer.alloc(64)]);
  return Buffer.concat([ascii('RIFF'), u32le(36 + seconds * byteRate), ascii('WAVE'), fmt, data]);
}

/** An AIFF whose COMM chunk says `frames` at 44.1 kHz, as an 80-bit float. */
export function aiff(frames: number): Buffer {
  // 44100 as an 80-bit extended float: exponent 0x400E, mantissa 0xAC44 << 48.
  const rate = Buffer.from([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
  const comm = Buffer.concat([ascii('COMM'), u32(18), u16(2), u32(frames), u16(16), rate]);
  return Buffer.concat([ascii('FORM'), u32(4 + comm.length), ascii('AIFF'), comm]);
}

/** A FLAC with a STREAMINFO block for `samples` at `rate`. */
export function flac(samples: number, rate = 48000): Buffer {
  const info = Buffer.alloc(34);
  info[10] = (rate >> 12) & 0xff;
  info[11] = (rate >> 4) & 0xff;
  info[12] = ((rate & 0x0f) << 4) | (1 << 1);
  info[13] = 0x70 | Math.floor(samples / 2 ** 32);
  info.writeUInt32BE(samples % 2 ** 32, 14);
  return Buffer.concat([ascii('fLaC'), Buffer.from([0x80, 0, 0, 34]), info]);
}

/** A constant 128 kbps MPEG-1 Layer III stream of `bytes` bytes after an ID3 tag. */
export function mp3(bytes: number): Buffer {
  const id3 = Buffer.concat([ascii('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 10]), Buffer.alloc(10)]);
  const frame = Buffer.alloc(bytes);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat([id3, frame]);
}

/** An MP3 with a Xing header counting `frames` frames of 1,152 samples at 44.1 kHz. */
export function mp3Xing(frames: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  ascii('Xing').copy(frame, 4 + 32);
  frame.writeUInt32BE(1, 4 + 32 + 4);
  frame.writeUInt32BE(frames, 4 + 32 + 8);
  return Buffer.concat([frame, Buffer.alloc(4096)]);
}

/** A PDF 1.5 whose page tree sits in a compressed object stream, as Word and Chrome write them. */
export function compressedPdf(pages: number): Buffer {
  const inner = `1 0 2 40 << /Type /Catalog /Pages 2 0 R >> << /Type /Pages /Kids [3 0 R] /Count ${pages} >>`;
  const packed = deflateSync(Buffer.from(inner, 'latin1'));
  return Buffer.concat([
    ascii('%PDF-1.5\n5 0 obj\n<< /Type /ObjStm /N 2 /First 8 /Filter /FlateDecode /Length '),
    ascii(`${packed.length} >>\nstream\n`), packed, ascii('\nendstream\nendobj\n'),
    ascii('3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n%%EOF\n'),
  ]);
}

/** A linearized PDF whose first object gives the page count as /N. */
export function linearizedPdf(pages: number): Buffer {
  return ascii(`%PDF-1.7\n1 0 obj\n<< /Linearized 1 /L 9999 /H [ 500 100 ] /O 4 /E 800 /N ${pages} /T 9000 >>\nendobj\n`);
}

/** A WebP of each kind: lossy (VP8), lossless (VP8L) and extended (VP8X). */
export function webp(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Buffer {
  const chunk = Buffer.alloc(30);
  if (kind === 'VP8 ') {
    chunk.set([0x9d, 0x01, 0x2a], 3);
    chunk.writeUInt16LE(width, 6);
    chunk.writeUInt16LE(height, 8);
  } else if (kind === 'VP8L') {
    chunk[0] = 0x2f;
    chunk.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  } else {
    chunk.writeUIntLE(width - 1, 4, 3);
    chunk.writeUIntLE(height - 1, 7, 3);
  }
  return Buffer.concat([ascii('RIFF'), u32le(4 + 8 + chunk.length), ascii('WEBP'), ascii(kind), u32le(chunk.length), chunk]);
}

/** An AVIF or HEIC with a thumbnail and a picture `ispe`, and an `irot` when turned. */
export function heif(brand: 'avif' | 'heic', width: number, height: number, turned = false): Buffer {
  const ispe = (w: number, h: number) => box('ispe', Buffer.alloc(4), u32(w), u32(h));
  const ipco = box('ipco', ispe(256, 192), ispe(width, height), ...(turned ? [box('irot', Buffer.from([1]))] : []));
  const meta = box('meta', Buffer.alloc(4), box('hdlr', Buffer.alloc(24)), box('iprp', ipco));
  return Buffer.concat([box('ftyp', ascii(brand), u32(0), ascii('mif1')), meta]);
}

/** A BMP's file and info headers. */
export function bmp(width: number, height: number): Buffer {
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'latin1');
  header.writeInt32LE(width, 18);
  header.writeInt32LE(-height, 22);
  return header;
}
