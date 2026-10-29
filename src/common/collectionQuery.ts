import type { FileKind } from './fileKind';
import type {
  CollectionFilter,
  CollectionPage,
  CollectionQuery,
  CollectionScope,
  CollectionSort,
} from '@/types/collectionQuery';
import { COLLECTION_PAGE_DEFAULT, COLLECTION_PAGE_MAX } from '@/types/collectionQuery';

export class CollectionQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectionQueryError';
  }
}

export const MAX_FILTERS = 16;
export const MAX_NAME_LENGTH = 256;

export const FILE_KINDS: readonly FileKind[] = [
  'directory', 'markdown', 'text', 'pdf', 'image', 'audio', 'video', 'other',
];

const SORT_FIELDS = new Set(['touched', 'name']);

function fail(message: string): never {
  throw new CollectionQueryError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateFilter(value: unknown): CollectionFilter {
  if (!isRecord(value) || typeof value.field !== 'string' || typeof value.op !== 'string') {
    fail('Each filter needs a field and an operation.');
  }
  const { field, op } = value;
  switch (field) {
    case 'name': {
      if (op !== 'contains' && op !== 'not-contains') fail('Name filters support contains and does not contain.');
      if (typeof value.value !== 'string') fail('Name filters need text.');
      const text = value.value.trim();
      if (text.length === 0) fail('Name filters need text.');
      if (text.length > MAX_NAME_LENGTH) fail(`Name text is at most ${MAX_NAME_LENGTH} characters.`);
      return { field, op, value: text };
    }
    case 'kind': {
      if (op !== 'in' && op !== 'not-in') fail('Kind filters support is one of and is not one of.');
      if (!Array.isArray(value.values) || value.values.length === 0) fail('Choose at least one kind.');
      const kinds = [...new Set(value.values)];
      if (kinds.some((kind) => !FILE_KINDS.includes(kind as FileKind))) fail('Unknown kind in filter.');
      return { field, op, values: kinds as FileKind[] };
    }
    default:
      return fail(`Unknown filter field: ${String(field)}`);
  }
}

function validateScope(value: unknown): CollectionScope {
  if (!isRecord(value)) fail('A query needs a scope.');
  if (value.kind !== 'all-roots') fail('Unknown scope.');
  return { kind: 'all-roots' };
}

function validateSort(value: unknown): CollectionSort {
  if (!isRecord(value) || typeof value.field !== 'string' || !SORT_FIELDS.has(value.field)) fail('Unknown sort field.');
  if (value.direction !== 'asc' && value.direction !== 'desc') fail('Sort direction must be asc or desc.');
  return { field: value.field as CollectionSort['field'], direction: value.direction };
}

/** Accepts a query from any source and returns a normalized copy, or throws a plain error. */
export function validateCollectionQuery(value: unknown): CollectionQuery {
  if (!isRecord(value)) fail('A query must be an object.');
  if (value.version !== 1) fail('Unsupported query version.');
  if (!Array.isArray(value.filters)) fail('Filters must be a list.');
  if (value.filters.length > MAX_FILTERS) fail(`At most ${MAX_FILTERS} filters.`);
  return {
    version: 1,
    scope: validateScope(value.scope),
    filters: value.filters.map(validateFilter),
    sort: validateSort(value.sort),
  };
}

export function validateCollectionPage(value: unknown): CollectionPage {
  if (value === undefined || value === null) return { offset: 0, limit: COLLECTION_PAGE_DEFAULT };
  if (!isRecord(value)) fail('Page must be an object.');
  const offset = value.offset === undefined ? 0 : value.offset;
  const limit = value.limit === undefined ? COLLECTION_PAGE_DEFAULT : value.limit;
  if (!isFiniteNumber(offset) || offset < 0 || !isFiniteNumber(limit) || limit < 1) fail('Invalid page.');
  return { offset: Math.floor(offset), limit: Math.min(COLLECTION_PAGE_MAX, Math.floor(limit)) };
}
