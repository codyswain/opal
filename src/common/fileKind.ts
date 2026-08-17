/**
 * Extension-based file classification. Deliberately cheap: no magic-byte
 * sniffing, no I/O. A wrong guess costs a suboptimal preview, never
 * correctness, so the cost of being wrong does not justify reading bytes.
 */

export type FileKind =
  | 'directory'
  | 'image'
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'other';

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'avif', 'svg', 'ico',
]);

export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'markdown', 'mdx']);

export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt', 'json', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'log',
  'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
  'css', 'scss', 'html', 'xml', 'sh', 'zsh', 'sql',
]);

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v',
]);

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus',
]);

/**
 * Returns the lowercased extension without the dot, or '' when the name has
 * none. A leading dot marks a hidden file, not an extension: '.gitignore' has
 * no extension.
 */
export function extensionOf(name: string): string {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return name.slice(lastDot + 1).toLowerCase();
}

export function classifyFile(name: string): FileKind {
  const ext = extensionOf(name);
  if (!ext) return 'other';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}
