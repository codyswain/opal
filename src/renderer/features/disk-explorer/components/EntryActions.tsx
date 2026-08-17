import React, { useCallback } from 'react';
import { ExternalLink, FolderSearch } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';

export const EntryActions: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const setError = useCallback((message: string) => {
    useDiskStore.setState({ loading: { isLoading: false, error: message } });
  }, []);

  const reveal = useCallback(async () => {
    const result = await window.diskAPI.reveal(entry.path);
    if (!result.success) setError(result.error);
  }, [entry.path, setError]);

  const openExternal = useCallback(async () => {
    const result = await window.diskAPI.openExternal(entry.path);
    if (!result.success) setError(result.error);
  }, [entry.path, setError]);

  return (
    <div className="flex items-center gap-1">
      <ActionButton
        onClick={reveal}
        label="Reveal in Finder"
        testId="entry-reveal"
        Icon={FolderSearch}
      />
      <ActionButton
        onClick={openExternal}
        label="Open in default app"
        testId="entry-open-external"
        Icon={ExternalLink}
      />
    </div>
  );
};

interface ActionButtonProps {
  onClick: () => void | Promise<void>;
  label: string;
  testId: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, label, testId, Icon }) => (
  <button
    type="button"
    onClick={() => void onClick()}
    aria-label={label}
    title={label}
    data-testid={testId}
    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
  >
    <Icon className="h-4 w-4" />
  </button>
);
