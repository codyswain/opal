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
 * The size of a PNG, JPEG or GIF, read from its first bytes, or null for any
 * other file or one cut short. A JPEG turned a quarter by its EXIF
 * orientation reports its width and height swapped, as it shows.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return pngSize(data);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(data);
    if (ascii(data, 0, 4) === 'GIF8') return { width: data.getUint16(6, true), height: data.getUint16(8, true), retina: false };
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

/**
 * The width an embed gets: the picture's width in points, so a Retina
 * screenshot shows at the size it had on screen, no wider than `room` and
 * small enough that its height fits in it. A side of `room` that is not
 * known, at zero, sets no limit.
 */
export function embedWidth(size: ImageSize, room: { width: number; height: number }): number {
  let width = size.retina ? size.width / 2 : size.width;
  if (room.width > 0) width = Math.min(width, room.width);
  if (room.height > 0 && size.height > 0) width = Math.min(width, (room.height * size.width) / size.height);
  return Math.max(1, Math.round(width));
}
