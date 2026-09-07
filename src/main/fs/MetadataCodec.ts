import { createHash } from 'crypto';
import { constants } from 'fs';
import { lstat, open, realpath } from 'fs/promises';
import path from 'path';
import { Document, isMap, isAlias, isNode, parseDocument, visit } from 'yaml';
import { classifyFile, type FileKind } from '@/common/fileKind';
import { normalizePath } from './paths';
import type { RootRegistry } from './RootRegistry';
import type { AuthoredLink, ItemProperties } from '@/types/metadata';

export const METADATA_LIMIT = 64 * 1024;
export const MARKDOWN_WRITE_LIMIT = 16 * 1024 * 1024;
export const SIDECAR_SUFFIX = '.opal.yaml';

/** Safe, user-facing errors; the IPC layer may show these messages verbatim. */
export class MetadataError extends Error {
  constructor(message: string) { super(message); this.name = 'MetadataError'; }
}
export class MetadataConflictError extends MetadataError {
  constructor() { super('This item changed on disk. Reload Details before saving.'); this.name = 'MetadataConflictError'; }
}

export interface MetadataState {
  path: string;
  carrier: string;
  kind: FileKind;
  markdown: boolean;
  exists: boolean;
  id: string | null;
  links: AuthoredLink[];
  properties: ItemProperties;
  revision: string;
  document: Document;
  mode: number;
  bom: Buffer;
  newline: string;
  /** Loaded only for writes. Bytes after the original closing delimiter. */
  body: Buffer;
}

export async function assertNoSymlinks(registry: RootRegistry, target: string): Promise<string> {
  const resolved = await registry.assertAllowed(target);
  // Walk the supplied spelling up to a registered root, so /var -> /private/var
  // system aliases above the opened folder are fine, but item aliases are not.
  let cursor = path.resolve(target);
  while (cursor) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new MetadataError(`Symlink traversal is not supported for metadata: ${cursor}`);
    if (registry.list().includes(normalizePath(await realpath(cursor)))) return resolved;
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new MetadataError('Could not establish the metadata root.');
    cursor = parent;
  }
  throw new MetadataError('Could not establish the metadata root.');
}

export function validateProperties(properties: ItemProperties): void {
  if (!properties || !Array.isArray(properties.tags) || properties.tags.length > 32 ||
      properties.tags.some((tag) => typeof tag !== 'string' || [...tag].length > 64)) {
    throw new MetadataError('Tags must be a list of at most 32 strings, with at most 64 characters each.');
  }
  if (typeof properties.description !== 'string' || Buffer.byteLength(properties.description) > 8192) {
    throw new MetadataError('Description exceeds the 8 KiB limit or is not text.');
  }
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parse(raw: string, required: boolean): { document: Document; id: string | null; links: AuthoredLink[]; properties: ItemProperties } {
  if (Buffer.byteLength(raw) > METADATA_LIMIT) throw new MetadataError('Metadata exceeds the 64 KiB limit.');
  const document = raw.trim() ? parseDocument(raw, { uniqueKeys: true, strict: true }) : new Document({});
  if (document.contents === null && !required) document.contents = document.createNode({});
  if (document.errors.length || document.warnings.length || !isMap(document.contents)) {
    throw new MetadataError('Malformed or unsupported YAML metadata; the existing content was preserved.');
  }
  visit(document, (_key, node) => {
    if (isAlias(node)) throw new MetadataError('YAML aliases are not supported in metadata.');
    if (isNode(node) && node.tag && !/^tag:yaml.org,2002:(str|int|float|bool|null|map|seq)$/.test(node.tag)) {
      throw new MetadataError('Custom YAML tags are not supported in metadata.');
    }
  });
  const data = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  const properties = { tags: data.tags === undefined ? [] : data.tags, description: data.annotation === undefined ? '' : data.annotation } as ItemProperties;
  validateProperties(properties);
  const identity = required ? data : data.opal;
  let id: string | null = null;
  let links: AuthoredLink[] = [];
  if (required || identity !== undefined) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw new MetadataError('Invalid metadata schema or sidecar collision.');
    const fields = identity as Record<string, unknown>;
    if (fields.schema !== 1 || !uuid(fields.id)) throw new MetadataError('Unsupported metadata schema or sidecar collision: expected schema 1 and a UUID.');
    id = fields.id.toLowerCase();
    if (fields.links !== undefined && !Array.isArray(fields.links)) throw new MetadataError('Metadata links must be a list.');
    links = (fields.links ?? []) as AuthoredLink[];
    const seen = new Set<string>();
    links = links.map((link) => {
      if (!link || !uuid(link.id) || !uuid(link.targetId) || typeof link.pathHint !== 'string' || seen.has(link.id.toLowerCase())) {
        throw new MetadataError('Malformed or duplicate metadata connection.');
      }
      seen.add(link.id.toLowerCase());
      return { id: link.id.toLowerCase(), targetId: link.targetId.toLowerCase(), pathHint: link.pathHint };
    });
  }
  return { document, id, links, properties };
}

/** A bounded byte splitter; the body is never decoded and re-encoded. */
function splitMarkdown(bytes: Buffer): { raw: string; bodyOffset: number; bom: Buffer; newline: string } {
  const hasBom = bytes.subarray(0, 3).equals(Buffer.from('\ufeff'));
  const start = hasBom ? 3 : 0;
  const bom = bytes.subarray(0, start);
  const text = bytes.subarray(start).toString('utf8');
  const opener = /^(---)(\r?\n)/.exec(text);
  const newline = opener?.[2] ?? (text.includes('\r\n') ? '\r\n' : '\n');
  if (!opener) return { raw: '', bodyOffset: start, bom, newline };
  // Delimiter positions are ASCII byte offsets, independent of body encoding.
  let cursor = start + Buffer.byteLength(opener[0]);
  const metadataStart = cursor;
  while (cursor <= bytes.length) {
    const end = bytes.indexOf(10, cursor);
    const lineEnd = end === -1 ? bytes.length : end;
    const line = bytes.subarray(cursor, lineEnd).toString('utf8').replace(/\r$/, '');
    if (line === '---' || line === '...') {
      const rawBytes = bytes.subarray(metadataStart, cursor);
      if (rawBytes.length > METADATA_LIMIT) throw new MetadataError('Frontmatter exceeds the 64 KiB limit.');
      return { raw: decodeYaml(rawBytes), bodyOffset: end === -1 ? lineEnd : end + 1, bom, newline };
    }
    if (end === -1 || cursor - metadataStart > METADATA_LIMIT) break;
    cursor = end + 1;
  }
  throw new MetadataError('Unclosed or oversized YAML frontmatter (64 KiB limit).');
}

export async function readMetadata(registry: RootRegistry, target: string, writable = false): Promise<MetadataState> {
  const resolved = await assertNoSymlinks(registry, target);
  const info = await lstat(resolved);
  if (!info.isFile() && !info.isDirectory()) throw new MetadataError('Metadata supports regular files and folders only.');
  const kind = info.isDirectory() ? 'directory' : classifyFile(path.basename(resolved));
  const markdown = kind === 'markdown';
  const carrier = markdown ? resolved : kind === 'directory' ? path.join(resolved, SIDECAR_SUFFIX) : `${resolved}${SIDECAR_SUFFIX}`;
  let carrierInfo;
  try { carrierInfo = await lstat(carrier); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (carrierInfo && (carrierInfo.isSymbolicLink() || !carrierInfo.isFile())) throw new MetadataError(`Metadata carrier is a symlink or collision: ${carrier}`);
  if (!markdown && carrierInfo && carrierInfo.size > METADATA_LIMIT) throw new MetadataError('Metadata exceeds the 64 KiB limit.');
  if (markdown && writable && info.size > MARKDOWN_WRITE_LIMIT) throw new MetadataError('Markdown is too large to update (16 MiB limit).');
  let bytes = Buffer.alloc(0);
  if (carrierInfo) {
    const handle = await open(carrier, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const limit = markdown && writable ? MARKDOWN_WRITE_LIMIT : METADATA_LIMIT + 16;
      bytes = Buffer.alloc(Math.min(carrierInfo.size, limit));
      const result = await handle.read(bytes, 0, bytes.length, 0);
      bytes = bytes.subarray(0, result.bytesRead);
    } finally { await handle.close(); }
  }
  const split = markdown ? splitMarkdown(bytes) : { raw: decodeYaml(bytes), bodyOffset: 0, bom: Buffer.alloc(0), newline: '\n' };
  const parsed = parse(split.raw, !markdown && !!carrierInfo);
  const stamp = carrierInfo ? `${carrierInfo.dev}:${carrierInfo.ino}:${carrierInfo.size}:${carrierInfo.mtimeMs}:${carrierInfo.ctimeMs}` : 'absent';
  const revision = createHash('sha256').update(stamp).update(split.raw).digest('hex');
  return { path: resolved, carrier, kind, markdown, exists: !!carrierInfo, ...parsed, revision,
    mode: carrierInfo?.mode ?? 0o600, bom: Buffer.from(split.bom), newline: split.newline,
    body: writable && markdown ? bytes.subarray(split.bodyOffset) : Buffer.alloc(0) };
}

export function serializeMetadata(state: MetadataState): Buffer {
  // Validate the resulting document as well as the input before replacement.
  const raw = state.document.toString({ lineWidth: 0 });
  parse(raw, !state.markdown);
  const yaml = raw.replace(/\r?\n/g, state.newline);
  if (Buffer.byteLength(yaml) > METADATA_LIMIT) throw new MetadataError('Metadata exceeds the 64 KiB limit.');
  if (!state.markdown) return Buffer.from(yaml);
  const result = Buffer.concat([state.bom, Buffer.from(`---${state.newline}${yaml}---${state.newline}`), state.body]);
  if (result.length > MARKDOWN_WRITE_LIMIT) throw new MetadataError('Markdown is too large to update (16 MiB limit).');
  return result;
}

/** Only recognized adjacent carriers are folded. Malformed/colliding files stay visible. */
export async function isValidAdjacentCarrier(registry: RootRegistry, candidate: string): Promise<boolean> {
  if (!candidate.endsWith(SIDECAR_SUFFIX) || path.basename(candidate) === SIDECAR_SUFFIX) return false;
  const primary = candidate.slice(0, -SIDECAR_SUFFIX.length);
  try {
    const state = await readMetadata(registry, primary);
    return state.kind !== 'directory' && !state.markdown && state.carrier === candidate && state.exists;
  } catch { return false; }
}

function decodeYaml(bytes: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new MetadataError('Metadata must use valid UTF-8 encoding; the existing bytes were preserved.');
  }
}
