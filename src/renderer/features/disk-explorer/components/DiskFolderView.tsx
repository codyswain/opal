import React, { useEffect, useMemo, useRef } from 'react';
import { FolderOpen } from 'lucide-react';
import { filterEntries } from '@/common/filterEntries';
import { sortEntries } from '@/common/sortEntries';
import { useDiskStore } from '../store/diskStore';
import { directoryCollection } from '../navigation/filesLocation';
import { CollectionView, type CollectionViewMode } from './CollectionView';
import { EmptyState } from './EmptyState';
import { GallerySkeleton } from './Skeleton';

interface DiskFolderViewProps {
  dirPath: string;
}

/** A folder's immediate children, rendered through the shared CollectionView. */
export const DiskFolderView: React.FC<DiskFolderViewProps> = ({ dirPath }) => {
  const entries = useDiskStore((state) => state.listings[dirPath]);
  const loadDirectory = useDiskStore((state) => state.loadDirectory);
  const sort = useDiskStore((state) => state.sort);
  const filter = useDiskStore((state) => state.filter);
  const setFilter = useDiskStore((state) => state.setFilter);
  const hasMountedRef = useRef(false);

  useEffect(() => { void loadDirectory(dirPath); }, [dirPath, loadDirectory]);
  // A filter carried into a new folder makes it look empty for no visible
  // reason. Clear it whenever the folder changes.
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    setFilter('');
  }, [dirPath, setFilter]);

  // A folder that is mostly pictures wants to be looked at, not listed. The
  // user's explicit choice always wins once they make one.
  const suggestedMode: CollectionViewMode = useMemo(() => {
    if (!entries || entries.length === 0) return 'list';
    const images = entries.filter((entry) => entry.kind === 'image').length;
    return images > 0 && images >= entries.length / 2 ? 'gallery' : 'list';
  }, [entries]);

  const visibleEntries = useMemo(() => {
    if (!entries) return [];
    return sortEntries(filterEntries(entries, filter), sort.field, sort.direction);
  }, [entries, filter, sort.field, sort.direction]);

  if (!entries) {
    return <GallerySkeleton />;
  }

  return (
    <CollectionView
      location={{ mode: 'browse', collection: directoryCollection(dirPath) }}
      entries={visibleEntries}
      suggestedMode={suggestedMode}
      filter={filter}
      onClearFilter={() => setFilter('')}
      emptyState={(
        <EmptyState
          Icon={FolderOpen}
          title="This folder is empty"
          description="Add files here or open a different folder to keep browsing."
        />
      )}
    />
  );
};
