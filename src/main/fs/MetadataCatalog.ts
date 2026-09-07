import { readdir } from 'fs/promises';
import path from 'path';
import { isInsideRoot } from './paths';
import { readMetadata, isValidAdjacentCarrier, assertNoSymlinks, type MetadataState } from './MetadataCodec';
import type { RootRegistry } from './RootRegistry';

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
    const walk = async (directory: string) => {
      try {
        await assertNoSymlinks(this.registry, directory);
        await record(directory);
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(target);
          else if (entry.isFile() && !(await isValidAdjacentCarrier(this.registry, target))) await record(target);
        }
      } catch (error) {
        result.warnings.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    // An ancestor covers an opened root only when its ordinary traversal can
    // reach it. Hidden path components must not erase an explicit root.
    const scanRoots = roots.filter((candidate) => !roots.some((other) =>
      other !== candidate && isInsideRoot(other, candidate) &&
      !path.relative(other, candidate).split(path.sep).some((segment) => segment.startsWith('.'))));
    for (const root of scanRoots) {
      await walk(root);
    }
    // A watcher event during the scan means the next explicit request rebuilds.
    if (generation === this.generation && rootKey === JSON.stringify(this.registry.list().sort())) this.snapshot = result;
    return result;
  }
}
