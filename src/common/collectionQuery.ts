import { isAbsoluteFsPath, normalizeFsPath } from './fsPaths';
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
export const MAX_TAG_VALUES = 32;
export const MAX_TAG_LENGTH = 64;
export const MAX_SCOPE_FOLDERS = 32;
export const MIN_DURATION_MS = 60_000;
export const MAX_DURATION_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const DURATION_PRESETS: ReadonlyArray<{ id: string; label: string; ms: number }> = [
  { id: '1h', label: 'past hour', ms: HOUR },
  { id: '24h', label: 'past 24 hours', ms: DAY },
  { id: '7d', label: 'past 7 days', ms: 7 * DAY },
  { id: '30d', label: 'past 30 days', ms: 30 * DAY },
  { id: '90d', label: 'past 90 days', ms: 90 * DAY },
];

export const FILE_KINDS: readonly FileKind[] = [
  'directory', 'markdown', 'text', 'pdf', 'image', 'audio', 'video', 'other',
];

export const KIND_LABELS: Record<FileKind, string> = {
  directory: 'Folder',
  markdown: 'Note',
  text: 'Text',
  pdf: 'PDF',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  other: 'Other',
};

const SORT_FIELDS = new Set(['touched', 'opened', 'modified', 'name']);

function fail(message: string): never {
  throw new CollectionQueryError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Blank tags are never meaningful values; they are dropped, never rewritten on disk. */
export function meaningfulTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => tag.trim().length > 0);
}

function validateTagValues(values: unknown): string[] {
  if (!Array.isArray(values) || values.some((tag) => typeof tag !== 'string')) {
    fail('Tag values must be a list of text.');
  }
  const tags = meaningfulTags(values as string[]);
  if (tags.length === 0) fail('Choose at least one tag.');
  if (tags.length > MAX_TAG_VALUES) fail(`At most ${MAX_TAG_VALUES} tags per filter.`);
  if (tags.some((tag) => [...tag].length > MAX_TAG_LENGTH)) fail(`Tags are at most ${MAX_TAG_LENGTH} characters.`);
  return [...new Set(tags)];
}

function validateDuration(value: unknown): number {
  if (!isFiniteNumber(value) || value < MIN_DURATION_MS || value > MAX_DURATION_MS) {
    fail('Durations must be between one minute and ten years.');
  }
  return Math.floor(value);
}

function validateInstant(value: unknown): number {
  if (!isFiniteNumber(value)) fail('Dates must be a finite timestamp.');
  return Math.floor(value);
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
    case 'tags': {
      if (op === 'is-empty') return { field, op };
      if (op !== 'has-any' && op !== 'has-all' && op !== 'has-none') fail('Unsupported tag operation.');
      return { field, op, values: validateTagValues(value.values) };
    }
    case 'description': {
      if (op !== 'is-empty' && op !== 'is-not-empty') fail('Description filters support is empty and is not empty.');
      return { field, op };
    }
    case 'touched':
    case 'opened': {
      if (op === 'never') return { field, op };
      if (op === 'within') return { field, op, durationMs: validateDuration(value.durationMs) };
      if (op === 'before' || op === 'after') return { field, op, at: validateInstant(value.at) };
      fail('Unsupported activity operation.');
    }
    // falls through only via fail()
    case 'modified': {
      if (op === 'within') return { field, op, durationMs: validateDuration(value.durationMs) };
      if (op === 'before' || op === 'after') return { field, op, at: validateInstant(value.at) };
      fail('Modified filters support within, before and after.');
    }
    // falls through only via fail()
    default:
      return fail(`Unknown filter field: ${String(field)}`);
  }
}

function validateScope(value: unknown): CollectionScope {
  if (!isRecord(value)) fail('A query needs a scope.');
  if (value.kind === 'all-roots') return { kind: 'all-roots' };
  if (value.kind !== 'folders') fail('Unknown scope.');
  if (!Array.isArray(value.folders) || value.folders.length === 0) fail('Choose at least one folder.');
  if (value.folders.length > MAX_SCOPE_FOLDERS) fail(`At most ${MAX_SCOPE_FOLDERS} scope folders.`);
  const folders = [...new Set((value.folders as unknown[]).map((folder) => {
    if (typeof folder !== 'string' || !isAbsoluteFsPath(folder)) fail('Scope folders must be absolute paths.');
    return normalizeFsPath(folder);
  }))];
  return { kind: 'folders', folders, includeDescendants: value.includeDescendants === true };
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

export function emptyQuery(scope: CollectionScope = { kind: 'all-roots' }): CollectionQuery {
  return { version: 1, scope, filters: [], sort: { field: 'name', direction: 'asc' } };
}

export function folderScope(folder: string, includeDescendants = true): CollectionScope {
  return { kind: 'folders', folders: [normalizeFsPath(folder)], includeDescendants };
}

/** Local midnight for a `YYYY-MM-DD` day, as epoch ms. */
export function startOfLocalDay(dayIso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayIso);
  if (!match) fail('Dates must use YYYY-MM-DD.');
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) fail('Invalid date.');
  return date.getTime();
}

/**
 * `before day` excludes the whole day; `after day` starts at the next
 * midnight. Both are exclusive of the chosen day, giving exact boundaries.
 */
export function dayBoundary(op: 'before' | 'after', dayIso: string): number {
  const start = startOfLocalDay(dayIso);
  if (op === 'before') return start;
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function localDayOf(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const FIELD_LABELS: Record<CollectionFilter['field'], string> = {
  name: 'Name',
  kind: 'Kind',
  tags: 'Tags',
  description: 'Description',
  touched: 'Last touched',
  opened: 'Last opened',
  modified: 'Modified',
};

function durationLabel(ms: number): string {
  const preset = DURATION_PRESETS.find((candidate) => candidate.ms === ms);
  if (preset) return preset.label;
  if (ms % DAY === 0) return `past ${ms / DAY} days`;
  if (ms % HOUR === 0) return `past ${ms / HOUR} hours`;
  return `past ${Math.round(ms / 60_000)} minutes`;
}

/** Readable chip text such as "Kind is one of PDF, Image". */
export function describeFilter(filter: CollectionFilter): string {
  const label = FIELD_LABELS[filter.field];
  switch (filter.field) {
    case 'name':
      return `${label} ${filter.op === 'contains' ? 'contains' : 'does not contain'} “${filter.value}”`;
    case 'kind':
      return `${label} ${filter.op === 'in' ? 'is one of' : 'is not one of'} ${filter.values.map((kind) => KIND_LABELS[kind]).join(', ')}`;
    case 'tags':
      if (filter.op === 'is-empty') return `${label} is empty`;
      return `${label} ${filter.op === 'has-any' ? 'has any of' : filter.op === 'has-all' ? 'has all of' : 'has none of'} ${filter.values.join(', ')}`;
    case 'description':
      return `${label} ${filter.op === 'is-empty' ? 'is empty' : 'is not empty'}`;
    case 'touched':
    case 'opened':
    case 'modified':
      if (filter.op === 'never') return `${label} never`;
      if (filter.op === 'within') return `${label} ${durationLabel(filter.durationMs)}`;
      return `${label} ${filter.op} ${localDayOf(filter.at)}`;
    default:
      return label;
  }
}

export function sameQuery(a: CollectionQuery, b: CollectionQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
