import React from 'react';
import { Button } from '@/renderer/shared/ui';
import { useDiskStore } from '../store/diskStore';

/** The page before any folder is open: one line and the action that fixes it. */
export const NoFolderOpen: React.FC = () => {
  const openFolder = useDiskStore((state) => state.openFolder);
  return (
    <div
      data-testid="no-folder-open"
      className="flex h-full flex-col items-center justify-center gap-3 p-8"
    >
      <p className="text-ui text-foreground-tertiary">
        Open a folder of Markdown files to start.
      </p>
      <Button variant="outline" size="compact" onClick={() => void openFolder()}>
        Open folder
      </Button>
    </div>
  );
};
