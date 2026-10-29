import { isInsideRoot } from '@/main/fs/paths';
import type { ActivityRecord } from '@/types/activity';
import type { CollectionFilter, CollectionQuery, CollectionRow } from '@/types/collectionQuery';
import type { IndexedItem } from './CollectionIndex';

export interface EvaluationInput {
  items: readonly IndexedItem[];
  activity: (target: string) => ActivityRecord | null;
  touchedAt: (record: ActivityRecord) => number;
  allowedRoots: readonly string[];
  query: CollectionQuery;
}

// One collator for the whole sort: localeCompare with options rebuilds the
// collator on every comparison, which dominated a 10,000-row name sort.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

interface SortableRow {
  row: CollectionRow;
  name: string;
  path: string;
}

function matches(row: CollectionRow, filter: CollectionFilter): boolean {
  switch (filter.field) {
    case 'name': {
      const found = row.entry.name.toLowerCase().includes(filter.value.toLowerCase());
      return filter.op === 'contains' ? found : !found;
    }
    case 'kind': {
      const listed = filter.values.includes(row.entry.kind);
      return filter.op === 'in' ? listed : !listed;
    }
    default:
      return false;
  }
}

function compareRows(query: CollectionQuery): (a: SortableRow, b: SortableRow) => number {
  const sign = query.sort.direction === 'asc' ? 1 : -1;
  const byName = (a: SortableRow, b: SortableRow) =>
    collator.compare(a.name, b.name) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (query.sort.field === 'name') return (a, b) => sign * byName(a, b);
  return (a, b) => {
    const left = a.row.touchedAt;
    const right = b.row.touchedAt;
    // Missing timestamps sort last in both directions; ties fall back to name.
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return sign * (left - right) || byName(a, b);
  };
}

export function evaluateCollectionQuery(input: EvaluationInput): CollectionRow[] {
  const { query, allowedRoots } = input;
  const rows: SortableRow[] = [];
  for (const item of input.items) {
    // Roots are containers, not results; overlapping roots yield one row per item.
    if (allowedRoots.includes(item.path) || !allowedRoots.some((root) => isInsideRoot(root, item.path))) continue;
    // A record whose identity no longer matches the item belongs to a
    // replaced file; its history is not inherited, matching Recent.
    const stored = input.activity(item.path);
    const record = stored && stored.id !== null && item.id !== null && stored.id !== item.id ? null : stored;
    const touchedAt = record ? input.touchedAt(record) : 0;
    const row: CollectionRow = {
      entry: { path: item.path, name: item.name, kind: item.kind, isDirectory: item.isDirectory, size: item.size, mtimeMs: item.mtimeMs },
      touchedAt: touchedAt > 0 ? touchedAt : null,
    };
    if (query.filters.every((filter) => matches(row, filter))) {
      rows.push({ row, name: item.name, path: item.path });
    }
  }
  rows.sort(compareRows(query));
  return rows.map((sortable) => sortable.row);
}
