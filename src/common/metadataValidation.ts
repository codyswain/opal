import { Document, isAlias, isMap, isNode, parseDocument, visit } from 'yaml';
import type { AuthoredLink, ItemProperties } from '@/types/metadata';

export const METADATA_LIMIT = 64 * 1024;

/** Renderer-safe validation failure. Main translates this to its public MetadataError. */
export class MetadataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataValidationError';
  }
}

export interface ParsedMetadataDocument {
  document: Document;
  id: string | null;
  links: AuthoredLink[];
  properties: ItemProperties;
}

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export function validateMetadataProperties(properties: ItemProperties): void {
  if (!properties || !Array.isArray(properties.tags) || properties.tags.length > 32 ||
      properties.tags.some((tag) => typeof tag !== 'string' || [...tag].length > 64)) {
    throw new MetadataValidationError('Tags must be a list of at most 32 strings, with at most 64 characters each.');
  }
  if (typeof properties.description !== 'string' || byteLength(properties.description) > 8192) {
    throw new MetadataValidationError('Description exceeds the 8 KiB limit or is not text.');
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Parses YAML and enforces the complete authored-metadata schema used on disk. */
export function parseMetadataDocument(raw: string, requiredIdentity: boolean): ParsedMetadataDocument {
  if (byteLength(raw) > METADATA_LIMIT) {
    throw new MetadataValidationError('Metadata exceeds the 64 KiB limit.');
  }
  const document = raw.trim() ? parseDocument(raw, { uniqueKeys: true, strict: true }) : new Document({});
  if (document.contents === null && !requiredIdentity) document.contents = document.createNode({});
  if (document.errors.length || document.warnings.length || !isMap(document.contents)) {
    throw new MetadataValidationError('Malformed or unsupported YAML metadata; the existing content was preserved.');
  }
  visit(document, (_key, node) => {
    if (isAlias(node)) throw new MetadataValidationError('YAML aliases are not supported in metadata.');
    if (isNode(node) && node.tag && !/^tag:yaml.org,2002:(str|int|float|bool|null|map|seq)$/.test(node.tag)) {
      throw new MetadataValidationError('Custom YAML tags are not supported in metadata.');
    }
  });
  const data = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  const properties = {
    tags: data.tags === undefined ? [] : data.tags,
    description: data.annotation === undefined ? '' : data.annotation,
  } as ItemProperties;
  validateMetadataProperties(properties);
  const identity = requiredIdentity ? data : data.opal;
  let id: string | null = null;
  let links: AuthoredLink[] = [];
  if (requiredIdentity || identity !== undefined) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
      throw new MetadataValidationError('Invalid metadata schema or sidecar collision.');
    }
    const fields = identity as Record<string, unknown>;
    if (fields.schema !== 1 || !isUuid(fields.id)) {
      throw new MetadataValidationError('Unsupported metadata schema or sidecar collision: expected schema 1 and a UUID.');
    }
    id = fields.id.toLowerCase();
    if (fields.links !== undefined && !Array.isArray(fields.links)) {
      throw new MetadataValidationError('Metadata links must be a list.');
    }
    const seen = new Set<string>();
    links = ((fields.links ?? []) as unknown[]).map((candidate) => {
      const link = candidate as Partial<AuthoredLink> | null;
      if (!link || !isUuid(link.id) || !isUuid(link.targetId) ||
          typeof link.pathHint !== 'string' || seen.has(link.id.toLowerCase())) {
        throw new MetadataValidationError('Malformed or duplicate metadata connection.');
      }
      seen.add(link.id.toLowerCase());
      return { id: link.id.toLowerCase(), targetId: link.targetId.toLowerCase(), pathHint: link.pathHint };
    });
  }
  return { document, id, links, properties };
}
