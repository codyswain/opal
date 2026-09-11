import { readMetadata, type MetadataState } from './MetadataCodec';
import type { RootRegistry } from './RootRegistry';
import { scanRootsFor, walkRoot } from './rootTraversal';

export type CatalogItem = Pick<MetadataState, 'path' | 'id' | 'kind' | 'links' | 'revision'>;

export interface CatalogSnapshot {
  items: CatalogItem[];
  byId: Map<string, CatalogItem[]>;
  warnings: string[];
}

/** Disposable index, built only when Details or a metadata mutation requests it. */
export class MetadataCatalog {
  private snapshot: CatalogSnapshot | null = null;
  private rootKey = '';
  private generation = 0;

  constructor(private registry: RootRegistry) {}

  invalidate(): void { this.snapshot = null; this.generation++; }

  async get(): Promise<CatalogSnapshot> {
    const roots = this.registry.list().sort();
    const rootKey = JSON.stringify(roots);
    if (this.rootKey !== rootKey) { this.rootKey = rootKey; this.invalidate(); }
    if (this.snapshot) return this.snapshot;
    const generation = this.generation;
    const result: CatalogSnapshot = { items: [], byId: new Map(), warnings: [] };
    const visitedItems = new Set<string>();
    const record = async (target: string) => {
      try {
        const item = await readMetadata(this.registry, target);
        if (visitedItems.has(item.path)) return;
        visitedItems.add(item.path);
        if (item.id) {
          const summary: CatalogItem = { path: item.path, id: item.id, kind: item.kind, links: item.links, revision: item.revision };
          result.items.push(summary);
          const matches = result.byId.get(item.id) ?? [];
          matches.push(summary);
          result.byId.set(item.id, matches);
        }
      } catch (error) {
        result.warnings.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    for (const root of scanRootsFor(roots)) {
      await walkRoot(this.registry, root, {
        onDirectory: record,
        onFile: record,
        onError: (target, error) => {
          result.warnings.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
        },
      });
    }
    // A watcher event during the scan means the next explicit request rebuilds.
    if (generation === this.generation && rootKey === JSON.stringify(this.registry.list().sort())) this.snapshot = result;
    return result;
  }
}
