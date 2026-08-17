import React, { useEffect } from 'react';
import { FolderOpen } from 'lucide-react';
import { useDiskStore } from '../store/diskStore';
import { DiskTreeItem } from './DiskTreeItem';
import type { DiskEntry } from '@/types/disk';

/** A root is displayed as a tree item, so it needs the same shape as a child. */
function rootEntry(rootPath: string): DiskEntry {
  const name = rootPath.split('/').filter(Boolean).pop() ?? rootPath;
  return {
    path: rootPath, name, kind: 'directory', isDirectory: true, size: 0, mtimeMs: 0,
  };
}

export const DiskTree: React.FC = () => {
  const roots = useDiskStore((state) => state.roots);
  const loadRoots = useDiskStore((state) => state.loadRoots);
  const openFolder = useDiskStore((state) => state.openFolder);

  useEffect(() => { void loadRoots(); }, [loadRoots]);

  if (roots.length === 0) {
    return (
      <div
        data-testid="disk-tree-empty"
        className="flex flex-col items-center justify-center gap-3 h-full px-6 text-center"
      >
        <FolderOpen className="h-8 w-8 opacity-30" />
        <p className="text-sm text-muted-foreground">No folder open</p>
        <button
          type="button"
          onClick={() => void openFolder()}
          data-testid="disk-tree-open-folder"
          className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground transition-colors duration-100 hover:opacity-90"
        >
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div role="tree" aria-label="Files on disk" className="py-1 overflow-auto h-full">
      {roots.map((root) => (
        <DiskTreeItem key={root} entry={rootEntry(root)} depth={0} />
      ))}
    </div>
  );
};
