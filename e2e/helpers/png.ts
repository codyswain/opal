import { inflateSync } from 'zlib';

/**
 * Reads the grey level of each pixel of an 8-bit, non-interlaced PNG, as
 * Playwright's screenshots are: enough to tell whether a strip is blank.
 */
export function pngGreys(png: Buffer): { width: number; height: number; grey: (x: number, y: number) => number } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || chunk[12] !== 0) throw new Error('Only 8-bit, non-interlaced PNGs are read.');
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[chunk[9]] ?? 4;
    }
    if (type === 'IDAT') data.push(chunk);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - corner)];
        predicted = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      pixels[y * stride + x] = (value + predicted) & 255;
    }
  }
  return { width, height, grey: (x, y) => pixels[y * stride + x * channels] };
}

/** The difference between the lightest and darkest pixel: 0 for a blank strip. */
export function greySpread(png: Buffer): number {
  const image = pngGreys(png);
  let low = 255;
  let high = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const value = image.grey(x, y);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  return high - low;
}
