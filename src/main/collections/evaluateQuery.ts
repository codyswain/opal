import { DAILY_FOLDER, dailyFileDate, dailyTreeLabel } from '@/common/dailyTree';
import { TRANSCRIPTS_FOLDER } from '@/common/stackModel';
import type { ActivityRecord } from '@/types/activity';
import type { CollectionFilter, CollectionQuery, CollectionRow } from '@/types/collectionQuery';
import type { IndexedItem } from './CollectionIndex';
import { matchTier, type MatchTarget } from './matchFile';

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

const TRANSCRIPTS = `Library/recordings/${TRANSCRIPTS_FOLDER}/`;

interface SortableRow {
  row: CollectionRow;
  name: string;
  path: string;
  /** The worst tier among the `matches` filters; 0 without one. */
  tier: number;
  /** A recording's transcript, which its summary's recording page shows too. */
  transcript: boolean;
}

function matches(row: CollectionRow, filter: CollectionFilter): boolean {
  switch (filter.field) {
    case 'name': {
      if (filter.op === 'matches') return true; // Checked with its tier in evaluateCollectionQuery.
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
  if (query.sort.field === 'match') {
    // Best first when descending: the tier, then Markdown above attachments,
    // then a recording's summary above its transcript, then the latest
    // touch, then the latest change on disk.
    const best = (a: SortableRow, b: SortableRow) =>
      a.tier - b.tier ||
      Number(b.row.entry.kind === 'markdown') - Number(a.row.entry.kind === 'markdown') ||
      Number(a.transcript) - Number(b.transcript) ||
      (b.row.touchedAt ?? 0) - (a.row.touchedAt ?? 0) ||
      b.row.entry.mtimeMs - a.row.entry.mtimeMs ||
      byName(a, b);
    return (a, b) => (sign < 0 ? best(a, b) : best(b, a));
  }
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

/** The worst tier over every `matches` text, or null when one of them does not match. */
function worstTier(searches: readonly string[], target: MatchTarget): number | null {
  let worst = 0;
  for (const search of searches) {
    const tier = matchTier(search, target);
    if (tier === null) return null;
    worst = Math.max(worst, tier);
  }
  return worst;
}

/**
 * The innermost opened root holding the item, which its path is matched
 * from. Compares as isInsideRoot does but without normalizing: roots and
 * indexed paths are normalized already, and normalizing both on every item
 * took most of each keystroke's search.
 */
function rootOf(allowedRoots: readonly string[], target: string): string | null {
  let found: string | null = null;
  for (const root of allowedRoots) {
    const inside = target === root || target.startsWith(root === '/' ? '/' : `${root}/`);
    if (inside && (found === null || root.length > found.length)) found = root;
  }
  return found;
}

export function evaluateCollectionQuery(input: EvaluationInput): CollectionRow[] {
  const { query, allowedRoots } = input;
  const searches = query.filters.flatMap((filter) => (filter.field === 'name' && filter.op === 'matches' ? [filter.value] : []));
  const rows: SortableRow[] = [];
  for (const item of input.items) {
    // Roots are containers, not results; overlapping roots yield one row per item.
    if (allowedRoots.includes(item.path)) continue;
    const root = rootOf(allowedRoots, item.path);
    if (root === null) continue;
    // A record whose identity no longer matches the item belongs to a
    // replaced file; its history is not inherited, matching Recent.
    const stored = input.activity(item.path);
    const record = stored && stored.id !== null && item.id !== null && stored.id !== item.id ? null : stored;
    const touchedAt = record ? input.touchedAt(record) : 0;
    const row: CollectionRow = {
      entry: { path: item.path, name: item.name, kind: item.kind, isDirectory: item.isDirectory, size: item.size, mtimeMs: item.mtimeMs },
      touchedAt: touchedAt > 0 ? touchedAt : null,
    };
    if (!query.filters.every((filter) => matches(row, filter))) continue;
    const relativePath = item.path.slice(root === '/' ? 1 : root.length + 1);
    let tier = 0;
    if (searches.length > 0) {
      // A daily page goes by "10-30 Fri" in the tree, so that matches it too.
      const date = relativePath === `${DAILY_FOLDER}/${item.name}` ? dailyFileDate(item.name) : null;
      const found = worstTier(searches, { name: item.name, relativePath, title: item.title, label: date && dailyTreeLabel(date) });
      if (found === null) continue;
      tier = found;
    }
    rows.push({ row, name: item.name, path: item.path, tier, transcript: relativePath.startsWith(TRANSCRIPTS) });
  }
  rows.sort(compareRows(query));
  return rows.map((sortable) => sortable.row);
}
