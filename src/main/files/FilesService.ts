import path from 'path';
import { isInsideRoot } from '@/main/fs/paths';
import type { RootRegistry } from '@/main/fs/RootRegistry';
import type { FileStatus, ImportedFile } from '@/types/files';
import type { FileStore, ImportSource, StoreDependencies } from './FileStore';
import { readFilesSettings } from './filesSettings';
import { FolderStore } from './FolderStore';
import { GitLfsStore } from './GitLfsStore';

export interface FilesServiceDependencies extends Omit<StoreDependencies, 'root' | 'folder'> {
  registry: RootRegistry;
}

/** Finds the store for a path from its opened folder's `.opal/files.json`, read again on every call so a pull's change applies at once. */
export class FilesService {
  constructor(private deps: FilesServiceDependencies) {}

  /** Copies a file into the files folder of the vault that holds `page`. */
  async import(page: string, source: ImportSource): Promise<ImportedFile> {
    const { root, store } = await this.storeFor(await this.deps.registry.assertAllowed(page));
    const vaultPath = await store.import(source);
    return {
      path: path.join(root, ...vaultPath.split('/')),
      vaultPath,
      name: 'path' in source ? path.basename(source.path) : source.name,
    };
  }

  async status(target: string): Promise<FileStatus> {
    const resolved = await this.deps.registry.assertAllowed(target);
    return (await this.storeFor(resolved)).store.status(resolved);
  }

  async fetch(target: string): Promise<FileStatus> {
    const resolved = await this.deps.registry.assertAllowed(target);
    return (await this.storeFor(resolved)).store.fetch(resolved);
  }

  /**
   * The outermost opened folder that holds `resolved`, since a vault keeps
   * its settings at its top even when one of its folders is opened too, and
   * the store its settings name.
   */
  private async storeFor(resolved: string): Promise<{ root: string; store: FileStore }> {
    const root = this.deps.registry.list().filter((candidate) => isInsideRoot(candidate, resolved)).sort((a, b) => a.length - b.length)[0];
    const { folder, store } = await readFilesSettings(root);
    const Store = store === 'git-lfs' ? GitLfsStore : FolderStore;
    return { root, store: new Store({ ...this.deps, root, folder }) };
  }
}
