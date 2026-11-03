import type { ImageSize } from '@/common/imageSize';

/** Read from a file's first bytes; the main process reads them for an embed's width (files:info). */
export { imageSize, type ImageSize } from '@/common/imageSize';

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
