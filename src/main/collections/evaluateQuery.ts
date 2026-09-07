import path from 'path';
import { isInsideRoot } from '@/main/fs/paths';
import type { ActivityKind, ActivityRecord } from '@/types/activity';
import type { CollectionFilter, CollectionQuery, CollectionRow } from '@/types/collectionQuery';
import type { IndexedItem } from './CollectionIndex';

export interface EvaluationInput {
  items: readonly IndexedItem[];
  activity: (target: string) => ActivityRecord | null;
  touchedOf: (record: ActivityRecord) => { at: number; kind: ActivityKind };
  allowedRoots: readonly string[];
  query: CollectionQuery;
  now: number;
}

export interface Evaluation {
  rows: CollectionRow[];
  /** Items excluded because a predicate needed metadata that could not be read. */
  excludedUnknown: number;
}

type Verdict = true | false | 'unknown';

function activityStamp(row: CollectionRow, field: 'touched' | 'opened' | 'modified'): number | null {
  if (field === 'touched') return row.touchedAt;
  if (field === 'opened') return row.openedAt;
  return row.entry.mtimeMs;
}

function evaluateFilter(row: CollectionRow, filter: CollectionFilter, now: number): Verdict {
  switch (filter.field) {
    case 'name': {
      const matches = row.entry.name.toLowerCase().includes(filter.value.toLowerCase());
      return filter.op === 'contains' ? matches : !matches;
    }
    case 'kind': {
      const listed = filter.values.includes(row.entry.kind);
      return filter.op === 'in' ? listed : !listed;
    }
    case 'tags': {
      if (row.tags === null) return 'unknown';
      const tags = new Set(row.tags);
      if (filter.op === 'is-empty') return tags.size === 0;
      if (filter.op === 'has-any') return filter.values.some((tag) => tags.has(tag));
      if (filter.op === 'has-all') return filter.values.every((tag) => tags.has(tag));
      return !filter.values.some((tag) => tags.has(tag));
    }
    case 'description': {
      if (row.descriptionEmpty === null) return 'unknown';
      return filter.op === 'is-empty' ? row.descriptionEmpty : !row.descriptionEmpty;
    }
    case 'touched':
    case 'opened':
    case 'modified': {
      const at = activityStamp(row, filter.field);
      if (filter.op === 'never') return at === null;
      if (at === null) return false;
      if (filter.op === 'within') return at >= now - filter.durationMs && at <= now;
      if (filter.op === 'before') return at < filter.at;
      return at >= filter.at;
    }
    default:
      return false;
  }
}

function inScope(item: IndexedItem, query: CollectionQuery, allowedRoots: readonly string[]): boolean {
  if (!allowedRoots.some((root) => isInsideRoot(root, item.path))) return false;
  if (query.scope.kind === 'all-roots') {
    // Roots are containers, not results; overlapping roots yield one row per item.
    return !allowedRoots.includes(item.path);
  }
  const folders = query.scope.folders;
  if (folders.includes(item.path)) return false;
  if (query.scope.includeDescendants) return folders.some((folder) => isInsideRoot(folder, item.path));
  return folders.includes(path.dirname(item.path));
}

function compareRows(query: CollectionQuery): (a: CollectionRow, b: CollectionRow) => number {
  const sign = query.sort.direction === 'asc' ? 1 : -1;
  const byName = (a: CollectionRow, b: CollectionRow) =>
    a.entry.name.localeCompare(b.entry.name, undefined, { sensitivity: 'base' }) ||
    (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0);
  if (query.sort.field === 'name') return (a, b) => sign * byName(a, b);
  const field = query.sort.field;
  return (a, b) => {
    const left = activityStamp(a, field);
    const right = activityStamp(b, field);
    // Missing timestamps sort last in both directions; ties fall back to name.
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return sign * (left - right) || byName(a, b);
  };
}

export function evaluateCollectionQuery(input: EvaluationInput): Evaluation {
  const { query, now } = input;
  const rows: CollectionRow[] = [];
  let excludedUnknown = 0;
  for (const item of input.items) {
    if (!inScope(item, query, input.allowedRoots)) continue;
    const record = input.activity(item.path);
    const touched = record ? input.touchedOf(record) : null;
    const row: CollectionRow = {
      entry: { path: item.path, name: item.name, kind: item.kind, isDirectory: item.isDirectory, size: item.size, mtimeMs: item.mtimeMs },
      tags: item.tags,
      descriptionEmpty: item.descriptionEmpty,
      touchedAt: touched && touched.at > 0 ? touched.at : null,
      touchedKind: touched && touched.at > 0 ? touched.kind : null,
      openedAt: record?.openedAt ?? null,
    };
    let verdict: Verdict = true;
    for (const filter of query.filters) {
      const result = evaluateFilter(row, filter, now);
      if (result === false) { verdict = false; break; }
      if (result === 'unknown') verdict = 'unknown';
    }
    if (verdict === true) rows.push(row);
    else if (verdict === 'unknown') excludedUnknown++;
  }
  rows.sort(compareRows(query));
  return { rows, excludedUnknown };
}
