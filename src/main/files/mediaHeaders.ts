import { inflateSync } from 'zlib';
import { classifyFile, extensionOf } from '@/common/fileKind';
import { imageSize } from '@/common/imageSize';

/** What a file's own headers say about it. Every field is missing when they don't say. */
export interface MediaHeaders {
  pages?: number;
  /** Seconds. */
  duration?: number;
  /** Pixels, as the picture or video shows (turned by its orientation). */
  width?: number;
  height?: number;
  retina?: boolean;
}

/** Reads up to `length` bytes at `position`; fewer at the end of the file. */
export type ReadAt = (position: number, length: number) => Promise<Uint8Array>;

/** Width detection reads this much of an image, not all of it. */
export const IMAGE_HEAD = 64 * 1024;
/** A movie's index larger than this is left to Spotlight. */
const WHOLE_LIMIT = 64 * 1024 * 1024;
/**
 * A PDF up to this size is read whole. A larger one is read at both ends,
 * where writers put the page tree's root, and Spotlight answers when it is
 * in neither.
 */
export const PDF_WHOLE = 32 * 1024 * 1024;
const PDF_END = 8 * 1024 * 1024;

const MP4 = new Set(['mp4', 'm4v', 'mov', 'm4a', '3gp', 'qt']);
/** WebM and MKV keep Info and Tracks before the first cluster, near the start. */
const MATROSKA_HEAD = 512 * 1024;
/** An Ogg file's first page names the codec and rate; its last page, within this much of the end, the length. */
const OGG_END = 64 * 1024;

/**
 * Page count, duration and size from the bytes alone: PDF `/Count`, MP4 and
 * QuickTime `mvhd` and `tkhd`, WAV, AIFF, FLAC and MP3 headers, and image
 * headers. Spotlight leaves new files blank for seconds, so these come
 * first and mdls is the fallback. A file it can't read gives `{}`.
 */
export async function readMediaHeaders(name: string, size: number, read: ReadAt): Promise<MediaHeaders> {
  const extension = extensionOf(name);
  try {
    if (extension === 'pdf') {
      if (size <= PDF_WHOLE) return pdfHeaders(await read(0, size));
      return pdfHeaders(Buffer.concat([await read(0, PDF_END), Buffer.from('\n'), await read(size - PDF_END, PDF_END)]));
    }
    if (MP4.has(extension)) return await mp4Headers(size, read);
    if (extension === 'webm' || extension === 'mkv') return matroskaHeaders(await read(0, MATROSKA_HEAD));
    if (extension === 'ogg' || extension === 'opus') return oggHeaders(await read(0, OGG_END), await read(Math.max(0, size - OGG_END), OGG_END));
    if (extension === 'wav') return wavHeaders(await read(0, IMAGE_HEAD));
    if (extension === 'aif' || extension === 'aiff') return aiffHeaders(await read(0, IMAGE_HEAD));
    if (extension === 'flac') return flacHeaders(await read(0, 64));
    if (extension === 'mp3') return mp3Headers(size, await read(0, IMAGE_HEAD), read);
    if (classifyFile(name) !== 'image') return {};
    const head = await read(0, IMAGE_HEAD);
    const image = imageSize(head);
    return image ? { width: image.width, height: image.height, retina: image.retina } : {};
  } catch {
    return {};
  }
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');

/** The `<< … >>` dictionary around `index` in PDF text, or '' when it has none. */
function dictAround(text: string, index: number): string {
  let depth = 0;
  let open = -1;
  for (let at = index; at > 1; at -= 1) {
    if (text[at] === '>' && text[at - 1] === '>') { depth += 1; at -= 1; continue; }
    if (text[at] === '<' && text[at - 1] === '<') {
      if (depth === 0) { open = at - 1; break; }
      depth -= 1;
      at -= 1;
    }
  }
  if (open === -1) return '';
  depth = 0;
  for (let at = open; at < text.length - 1; at += 1) {
    if (text[at] === '<' && text[at + 1] === '<') { depth += 1; at += 1; continue; }
    if (text[at] === '>' && text[at + 1] === '>') {
      depth -= 1;
      at += 1;
      if (depth === 0) return text.slice(open, at + 1);
    }
  }
  return '';
}

/**
 * The largest `/Count` of a `/Type /Pages` node. The page tree's root
 * counts every page and every other node counts some of them, so the
 * largest is the root's, wherever it sits.
 */
function pagesIn(text: string): number | null {
  let best: number | null = null;
  for (const match of text.matchAll(/\/Type\s*\/Pages\b/g)) {
    const count = /\/Count\s+(\d+)/.exec(dictAround(text, match.index ?? 0))?.[1];
    if (count !== undefined) best = Math.max(best ?? 0, Number(count));
  }
  return best;
}

/**
 * A PDF's page count. A linearized file says it in its first object (`/N`).
 * Otherwise the page tree's root, the largest count in plain objects and,
 * since PDF 1.5, inside compressed object streams.
 */
export function pdfHeaders(bytes: Uint8Array): MediaHeaders {
  const text = latin1(bytes);
  const linearized = /\/Linearized\b[^>]*?\/N\s+(\d+)/.exec(text.slice(0, 2048))?.[1];
  if (linearized) return { pages: Number(linearized) };
  // The root may sit in an object stream while the nodes under it are plain objects, so both are searched.
  let best = pagesIn(text);
  for (const match of text.matchAll(/\/Type\s*\/ObjStm\b/g)) {
    const start = text.indexOf('stream', match.index);
    if (start === -1) continue;
    const dataStart = start + 6 + (text[start + 6] === '\r' ? 2 : 1);
    const end = text.indexOf('endstream', dataStart);
    if (end === -1) continue;
    try {
      const inflated = inflateSync(bytes.subarray(dataStart, end)).toString('latin1');
      const pages = pagesIn(inflated);
      if (pages) best = Math.max(best ?? 0, pages);
    } catch {
      // Not Flate, or cut short.
    }
  }
  return best ? { pages: best } : {};
}

interface Box { type: string; start: number; header: number; end: number }

/** The boxes in `data` from `from` to `to`. */
function boxes(data: DataView, from: number, to: number): Box[] {
  const found: Box[] = [];
  for (let at = from; at + 8 <= to;) {
    let size = data.getUint32(at);
    let header = 8;
    if (size === 1) { size = Number(data.getBigUint64(at + 8)); header = 16; }
    if (size === 0) size = to - at;
    if (size < header) break;
    found.push({ type: ascii(data, at + 4, 4), start: at, header, end: Math.min(at + size, to) });
    at += size;
  }
  return found;
}

const ascii = (data: DataView, at: number, length: number) =>
  String.fromCharCode(...new Uint8Array(data.buffer, data.byteOffset + at, length));

/**
 * Duration from `mvhd`, and the video track's size from its `tkhd`, turned
 * by the track's matrix as an iPhone's portrait video is. The `moov` box
 * may sit after the media (a movie whose index is at its end), so the top
 * level is walked by box headers and only `moov` is read whole.
 */
async function mp4Headers(size: number, read: ReadAt): Promise<MediaHeaders> {
  let moov: Uint8Array | null = null;
  for (let at = 0; at + 8 <= size;) {
    const head = await read(at, 16);
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let boxSize = view.getUint32(0);
    if (boxSize === 1 && head.byteLength >= 16) boxSize = Number(view.getBigUint64(8));
    if (boxSize === 0) boxSize = size - at;
    if (boxSize < 8) break;
    if (ascii(view, 4, 4) === 'moov') {
      if (boxSize > WHOLE_LIMIT) return {};
      moov = await read(at, boxSize);
      break;
    }
    at += boxSize;
  }
  if (!moov) return {};
  const data = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const result: MediaHeaders = {};
  const [root] = boxes(data, 0, data.byteLength);
  for (const box of boxes(data, root.start + root.header, root.end)) {
    const body = box.start + box.header;
    if (box.type === 'mvhd') {
      const version = data.getUint8(body);
      const scale = data.getUint32(body + (version === 1 ? 20 : 12));
      const duration = version === 1 ? Number(data.getBigUint64(body + 24)) : data.getUint32(body + 16);
      if (scale > 0 && duration > 0 && duration !== 0xffffffff) result.duration = duration / scale;
    }
    if (box.type === 'trak' && result.width === undefined) {
      const tkhd = boxes(data, body, box.end).find((child) => child.type === 'tkhd');
      if (!tkhd) continue;
      const at = tkhd.start + tkhd.header;
      const shift = data.getUint8(at) === 1 ? 12 : 0;
      const width = data.getUint32(at + 76 + shift) / 65536;
      const height = data.getUint32(at + 80 + shift) / 65536;
      if (width > 0 && height > 0) {
        // The matrix's first value is 0 for a quarter turn either way.
        const turned = data.getInt32(at + 40 + shift) === 0;
        result.width = Math.round(turned ? height : width);
        result.height = Math.round(turned ? width : height);
      }
    }
  }
  return result;
}

/** Duration from the format chunk's byte rate and the data chunk's size. */
export function wavHeaders(bytes: Uint8Array): MediaHeaders {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(data, 0, 4) !== 'RIFF' || ascii(data, 8, 4) !== 'WAVE') return {};
  let byteRate = 0;
  for (let at = 12; at + 8 <= data.byteLength;) {
    const type = ascii(data, at, 4);
    const size = data.getUint32(at + 4, true);
    if (type === 'fmt ') byteRate = data.getUint32(at + 16, true);
    if (type === 'data') return byteRate > 0 ? { duration: size / byteRate } : {};
    at += 8 + size + (size % 2);
  }
  return {};
}

/** Duration from the COMM chunk: frames over the sample rate, an 80-bit float. */
export function aiffHeaders(bytes: Uint8Array): MediaHeaders {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(data, 0, 4) !== 'FORM' || !['AIFF', 'AIFC'].includes(ascii(data, 8, 4))) return {};
  for (let at = 12; at + 8 <= data.byteLength;) {
    const type = ascii(data, at, 4);
    const size = data.getUint32(at + 4);
    if (type === 'COMM') {
      const frames = data.getUint32(at + 10);
      const exponent = data.getUint16(at + 16) & 0x7fff;
      const mantissa = Number(data.getBigUint64(at + 18));
      const rate = mantissa * 2 ** (exponent - 16383 - 63);
      return rate > 0 ? { duration: frames / rate } : {};
    }
    at += 8 + size + (size % 2);
  }
  return {};
}

/** Duration from STREAMINFO, the first metadata block: total samples over the sample rate. */
export function flacHeaders(bytes: Uint8Array): MediaHeaders {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(data, 0, 4) !== 'fLaC') return {};
  const info = 8;
  const rate = (data.getUint8(info + 10) << 12) | (data.getUint8(info + 11) << 4) | (data.getUint8(info + 12) >> 4);
  const samples = (data.getUint8(info + 13) & 0x0f) * 2 ** 32 + data.getUint32(info + 14);
  return rate > 0 && samples > 0 ? { duration: samples / rate } : {};
}

const MP3_BITRATES = {
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as Record<number, number[]>;

/**
 * An MP3's duration from its Xing, Info or VBRI frame count, or from its
 * bit rate when it has none (a constant-rate file).
 */
async function mp3Headers(size: number, head: Uint8Array, read: ReadAt): Promise<MediaHeaders> {
  let start = 0;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    start = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]) + (head[5] & 0x10 ? 10 : 0);
  }
  const bytes = start + 4096 <= head.byteLength ? head.subarray(start) : await read(start, 4096);
  for (let at = 0; at + 4 <= bytes.byteLength; at += 1) {
    if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[at + 1] >> 3) & 0x3;
    const layer = (bytes[at + 1] >> 1) & 0x3;
    const bitrateIndex = bytes[at + 2] >> 4;
    const rateIndex = (bytes[at + 2] >> 2) & 0x3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;
    const rate = MP3_RATES[version][rateIndex];
    const mono = (bytes[at + 3] >> 6) === 3;
    const samplesPerFrame = version === 3 ? 1152 : 576;
    const sideInfo = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = at + 4 + sideInfo;
    if (tag + 12 <= bytes.byteLength && ['Xing', 'Info'].includes(ascii(view, tag, 4)) && view.getUint32(tag + 4) & 0x1) {
      return { duration: (view.getUint32(tag + 8) * samplesPerFrame) / rate };
    }
    if (at + 36 + 18 <= bytes.byteLength && ascii(view, at + 36, 4) === 'VBRI') {
      return { duration: (view.getUint32(at + 36 + 14) * samplesPerFrame) / rate };
    }
    const kbps = (version === 3 ? MP3_BITRATES.v1l3 : MP3_BITRATES.v2l3)[bitrateIndex];
    return { duration: ((size - start - at) * 8) / (kbps * 1000) };
  }
  return {};
}

/** An EBML variable-length number at `at`: its length, and its value with the marker bit kept (an ID) or removed (a size). */
function vint(data: DataView, at: number, keepMarker: boolean): { length: number; value: number; unknown: boolean } | null {
  const first = data.getUint8(at);
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || at + length > data.byteLength) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let ones = value === (0xff >> length);
  for (let index = 1; index < length; index += 1) {
    const byte = data.getUint8(at + index);
    value = value * 256 + byte;
    ones &&= byte === 0xff;
  }
  return { length, value, unknown: !keepMarker && ones };
}

const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const VIDEO = 0xe0;

/** The elements from `from` to `to`, each with its ID and where its body starts and ends. */
function elements(data: DataView, from: number, to: number): { id: number; body: number; end: number }[] {
  const found: { id: number; body: number; end: number }[] = [];
  for (let at = from; at < to;) {
    const id = vint(data, at, true);
    if (!id) break;
    const size = vint(data, at + id.length, false);
    if (!size) break;
    const body = at + id.length + size.length;
    const end = size.unknown ? to : Math.min(body + size.value, to);
    found.push({ id: id.value, body, end });
    if (id.value === CLUSTER) break;
    at = end;
  }
  return found;
}

const uint = (data: DataView, from: number, to: number) => {
  let value = 0;
  for (let at = from; at < to; at += 1) value = value * 256 + data.getUint8(at);
  return value;
};

/**
 * Duration from Info (Duration in TimecodeScale units, nanoseconds each by
 * default) and the first video track's PixelWidth and PixelHeight. A file
 * recorded live may have no Duration; then Spotlight answers.
 */
export function matroskaHeaders(bytes: Uint8Array): MediaHeaders {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const segment = elements(data, 0, data.byteLength).find((element) => element.id === SEGMENT);
  if (!segment) return {};
  const result: MediaHeaders = {};
  for (const element of elements(data, segment.body, segment.end)) {
    if (element.id === INFO) {
      let scale = 1_000_000;
      let duration: number | null = null;
      for (const field of elements(data, element.body, element.end)) {
        if (field.id === 0x2ad7b1) scale = uint(data, field.body, field.end);
        if (field.id === 0x4489) duration = field.end - field.body === 4 ? data.getFloat32(field.body) : data.getFloat64(field.body);
      }
      if (duration && duration > 0) result.duration = (duration * scale) / 1e9;
    }
    if (element.id === TRACKS && result.width === undefined) {
      for (const entry of elements(data, element.body, element.end).filter((child) => child.id === TRACK_ENTRY)) {
        const video = elements(data, entry.body, entry.end).find((child) => child.id === VIDEO);
        if (!video) continue;
        const fields = elements(data, video.body, video.end);
        const width = fields.find((field) => field.id === 0xb0);
        const height = fields.find((field) => field.id === 0xba);
        if (width && height) {
          result.width = uint(data, width.body, width.end);
          result.height = uint(data, height.body, height.end);
          break;
        }
      }
    }
  }
  return result;
}

/**
 * An Ogg file's duration: the last page's granule position, in samples,
 * over the sample rate. Opus always counts at 48 kHz and starts after its
 * pre-skip; Vorbis names its rate in the identification header.
 */
export function oggHeaders(head: Uint8Array, tail: Uint8Array): MediaHeaders {
  const first = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  const last = Buffer.from(tail.buffer, tail.byteOffset, tail.byteLength);
  if (first.toString('latin1', 0, 4) !== 'OggS') return {};
  const body = 27 + first[26];
  let rate = 0;
  let skip = 0;
  if (first.toString('latin1', body, body + 8) === 'OpusHead') {
    rate = 48000;
    skip = first.readUInt16LE(body + 10);
  } else if (first.toString('latin1', body + 1, body + 7) === 'vorbis') {
    rate = first.readUInt32LE(body + 12);
  }
  const page = last.lastIndexOf('OggS');
  if (!rate || page === -1 || page + 14 > last.length) return {};
  const granule = Number(last.readBigUInt64LE(page + 6));
  return granule > skip ? { duration: (granule - skip) / rate } : {};
}
