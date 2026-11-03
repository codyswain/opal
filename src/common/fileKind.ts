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

/** `mdo` is a document: plain Markdown that opens in the document editor. */
export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'markdown', 'mdx', 'mdo']);

export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt', 'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'log',
  'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
  'css', 'scss', 'html', 'xml', 'sh', 'zsh', 'sql',
]);

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v',
]);

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus', 'aif', 'aiff',
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

/**
 * A name's extension as stored and shown: the last one, or two for the
 * compound ones that mean one type (`tar.gz`, `jsonl.gz`, `gcode.3mf`), so
 * a stored copy keeps them whole. Lowercase, without the leading dot.
 */
export function storedExtension(name: string): string {
  const compound = /\.((?:tar|json|jsonl|ndjson|csv|tsv|txt|log|sql|xml)\.(?:gz|bz2|xz|zst)|gcode\.3mf)$/i.exec(name);
  if (compound && compound.index > 0) return compound[1].toLowerCase();
  return extensionOf(name);
}

/**
 * A stored name's stem, hash and extension (lowercase): `q3-report.a3f9c2e1.pdf`
 * is `q3-report`, `a3f9c2e1` and `pdf`. A file with no extension is stored as
 * `<stem>.<hash>`. The hash is null when the name has none.
 */
export function storedParts(name: string): { stem: string; hash: string | null; extension: string } {
  const extension = storedExtension(name);
  const stem = extension ? name.slice(0, -extension.length - 1) : name;
  const hashed = /\.([0-9a-f]{8})$/.exec(stem);
  if (hashed && hashed.index > 0) return { stem: stem.slice(0, hashed.index), hash: hashed[1], extension };
  if (/^[0-9a-f]{8}$/.test(extension)) return { stem, hash: extension, extension: '' };
  return { stem, hash: null, extension };
}

/** A stored file's name without the hash Opal adds: `q3-report.a3f9c2e1.pdf` shows as `q3-report.pdf`. */
export function withoutHash(name: string): string {
  const { stem, hash, extension } = storedParts(name);
  if (!hash) return name;
  return extension ? `${stem}.${name.slice(-extension.length)}` : stem;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A page's name: the file's name without `.md` or `.mdo`. */
export function pageName(path: string): string {
  return baseName(path).replace(/\.mdo?$/i, '');
}

/** Whether the file is a document (`.mdo`) rather than a note (`.md`). */
export function isDocFile(path: string): boolean {
  return extensionOf(baseName(path)) === 'mdo';
}

/** The name the tree, tabs and lists show: a page without `.md` or `.mdo`, anything else in full. */
export function fileTreeLabel(name: string, kind: FileKind): string {
  return kind === 'markdown' ? pageName(name) : name;
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
