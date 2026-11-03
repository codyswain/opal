/** A picture's size in pixels as it shows. */
export interface ImageSize {
  width: number;
  height: number;
  /** Stored at 144 dpi, as macOS saves a screenshot of a Retina screen: two pixels to a point. */
  retina: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (data: DataView, at: number, length: number) =>
  String.fromCharCode(...new Uint8Array(data.buffer, data.byteOffset + at, length));

/**
 * The size of a PNG, JPEG, GIF, WebP, AVIF, HEIC, BMP or SVG, read from its
 * first bytes, or null for any other file or one cut short. A JPEG turned a
 * quarter by its EXIF orientation, and a HEIC or AVIF by its rotation,
 * report their width and height swapped, as they show.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return pngSize(data);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(data);
    if (ascii(data, 0, 4) === 'GIF8') return { width: data.getUint16(6, true), height: data.getUint16(8, true), retina: false };
    if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP') return webpSize(data);
    if (ascii(data, 4, 4) === 'ftyp') return heifSize(data);
    if (ascii(data, 0, 2) === 'BM') return { width: Math.abs(data.getInt32(18, true)), height: Math.abs(data.getInt32(22, true)), retina: false };
    return svgSize(bytes);
  } catch {
    // A header that runs past the bytes.
  }
  return null;
}

/** IHDR holds the size; a pHYs chunk before the image data holds the pixels per meter. */
function pngSize(data: DataView): ImageSize {
  const size = { width: data.getUint32(16), height: data.getUint32(20), retina: false };
  for (let at = 8; at + 8 <= data.byteLength; at += 12 + data.getUint32(at)) {
    const type = ascii(data, at + 4, 4);
    if (type === 'IDAT') break;
    if (type === 'pHYs') size.retina = data.getUint8(at + 16) === 1 && Math.round(data.getUint32(at + 8) * 0.0254) === 144;
  }
  return size;
}

/** Walks the segments to the frame header (SOF), reading the EXIF orientation on the way. */
function jpegSize(data: DataView): ImageSize | null {
  let turned = false;
  for (let at = 2; at + 4 <= data.byteLength;) {
    if (data.getUint8(at) !== 0xff) return null;
    const marker = data.getUint8(at + 1);
    // A fill byte before the marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xe1 && ascii(data, at + 4, 6) === 'Exif\0\0') turned = exifOrientation(data, at + 10) >= 5;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = data.getUint16(at + 5);
      const width = data.getUint16(at + 7);
      return { width: turned ? height : width, height: turned ? width : height, retina: false };
    }
    at += 2 + data.getUint16(at + 2);
  }
  return null;
}

/** The orientation tag in the first directory of the TIFF block at `tiff`; 5 to 8 turn the picture a quarter. */
function exifOrientation(data: DataView, tiff: number): number {
  const little = ascii(data, tiff, 2) === 'II';
  const directory = tiff + data.getUint32(tiff + 4, little);
  for (let entry = 0; entry < data.getUint16(directory, little); entry += 1) {
    const at = directory + 2 + entry * 12;
    if (data.getUint16(at, little) === 0x0112) return data.getUint16(at + 8, little);
  }
  return 1;
}

/** The first chunk says the kind: VP8 (lossy), VP8L (lossless) or VP8X (extended, with the canvas size). */
function webpSize(data: DataView): ImageSize | null {
  const chunk = ascii(data, 12, 4);
  const u24 = (at: number) => data.getUint8(at) | (data.getUint8(at + 1) << 8) | (data.getUint8(at + 2) << 16);
  if (chunk === 'VP8X') return { width: u24(24) + 1, height: u24(27) + 1, retina: false };
  if (chunk === 'VP8L') {
    const bits = data.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, retina: false };
  }
  if (chunk === 'VP8 ') return { width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff, retina: false };
  return null;
}

const CONTAINERS = new Set(['meta', 'iprp', 'ipco']);

/**
 * AVIF and HEIC keep the size in `ispe` boxes under meta/iprp/ipco, one per
 * image (the picture, its thumbnail, an alpha plane), so the largest is the
 * picture. An `irot` of a quarter or three quarters swaps the sides.
 */
function heifSize(data: DataView): ImageSize | null {
  const brand = ascii(data, 8, 4);
  if (!['avif', 'avis', 'heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return null;
  let best: { width: number; height: number } | null = null;
  let turned = false;
  const walk = (from: number, to: number) => {
    for (let at = from; at + 8 <= to;) {
      const size = data.getUint32(at);
      const type = ascii(data, at + 4, 4);
      const end = size === 0 ? to : at + size;
      if (size < 8 && size !== 0) return;
      // meta is a full box: four bytes of version and flags before its children.
      if (CONTAINERS.has(type)) walk(at + 8 + (type === 'meta' ? 4 : 0), Math.min(end, to));
      if (type === 'ispe') {
        const width = data.getUint32(at + 12);
        const height = data.getUint32(at + 16);
        if (!best || width * height > best.width * best.height) best = { width, height };
      }
      if (type === 'irot') turned = (data.getUint8(at + 8) & 0x3) % 2 === 1;
      at = end;
    }
  };
  walk(0, data.byteLength);
  if (!best) return null;
  const { width, height } = best;
  return { width: turned ? height : width, height: turned ? width : height, retina: false };
}

/**
 * An SVG's width and height attributes in pixels, or its viewBox when they
 * are missing or relative. Only the opening tag is read, as text, within
 * the first 64 KB (after any comments and doctype).
 */
function svgSize(bytes: Uint8Array): ImageSize | null {
  const head = new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]?.trim();
  const pixels = (value: string | undefined) => {
    const match = value ? /^([\d.]+)\s*(px)?$/i.exec(value) : null;
    return match ? Number(match[1]) : null;
  };
  let width = pixels(attribute('width'));
  let height = pixels(attribute('height'));
  const box = attribute('viewBox')?.split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    if (width && !height) height = (width * box[3]) / box[2];
    if (height && !width) width = (height * box[2]) / box[3];
    width ??= box[2];
    height ??= box[3];
  }
  if (!width || !height) return null;
  return { width: Math.round(width), height: Math.round(height), retina: false };
}
