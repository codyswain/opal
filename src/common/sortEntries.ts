import type { DiskEntry } from '@/types/disk';

export type SortField = 'name' | 'modified' | 'size' | 'kind';
export type SortDirection = 'asc' | 'desc';

/**
 * Directories always sort above files, regardless of field or direction.
 *
 * This matches Finder and every file manager users already know. Letting a
 * directory sort into the middle of a size-ordered list is technically
 * consistent and practically useless because folders have no meaningful size.
 */
// A shared collator: localeCompare with options rebuilds one per comparison,
// which dominated sorting a few thousand entries.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

export function sortEntries(
  entries: DiskEntry[],
  field: SortField,
  direction: SortDirection
): DiskEntry[] {
  const sign = direction === 'asc' ? 1 : -1;

  const byName = (a: DiskEntry, b: DiskEntry) => collator.compare(a.name, b.name);

  const compare = (a: DiskEntry, b: DiskEntry): number => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

    switch (field) {
      case 'name':
        return sign * byName(a, b);
      case 'modified':
        return sign * (a.mtimeMs - b.mtimeMs);
      case 'size':
        return sign * (a.size - b.size);
      case 'kind': {
        const byKind = a.kind.localeCompare(b.kind);
        // Within a kind, fall back to name so the order is meaningful rather
        // than arbitrary. The tiebreak is not reversed by direction.
        return byKind !== 0 ? sign * byKind : byName(a, b);
      }
      default: {
        const exhaustiveCheck: never = field;
        return exhaustiveCheck;
      }
    }
  };

  // Array.prototype.sort is stable in modern JS, so equal keys keep their
  // incoming order.
  return [...entries].sort(compare);
}
