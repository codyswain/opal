import React from 'react';
import { Folder } from 'lucide-react';
import { formatBytes } from '@/common/formatBytes';
import type { DiskEntry } from '@/types/disk';
import { ImagePreview } from './ImagePreview';
import { UnsupportedPreview } from './UnsupportedPreview';

/**
 * Dispatches on file kind. Later tasks in Phase A add cases here; the default
 * branch is deliberately a real component rather than null, so an unhandled
 * kind degrades to something legible instead of an empty pane.
 */
function renderPreview(entry: DiskEntry): React.ReactNode {
  if (entry.isDirectory) {
    return (
      <div data-testid="detail-directory" className="grid flex-1 place-items-center p-8">
        <div className="flex flex-col items-center gap-2">
          <Folder className="h-10 w-10 opacity-30" />
          <p className="text-sm text-muted-foreground">Folder</p>
        </div>
      </div>
    );
  }

  switch (entry.kind) {
    case 'image':
      return <ImagePreview entry={entry} />;
    default:
      return <UnsupportedPreview entry={entry} />;
  }
}

export const DetailPane: React.FC<{ entry: DiskEntry | null }> = ({ entry }) => {
  if (!entry) {
    return (
      <div
        data-testid="detail-empty"
        className="grid h-full place-items-center text-sm text-muted-foreground"
      >
        Select a file to preview it
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="min-w-0 shrink-0 border-b border-border/60 px-4 py-2">
        <h2 data-testid="detail-title" className="truncate text-sm font-medium" title={entry.name}>
          {entry.name}
        </h2>
        <p data-testid="detail-subtitle" className="text-xs text-muted-foreground">
          {entry.isDirectory ? 'Folder' : formatBytes(entry.size)}
        </p>
      </header>

      {renderPreview(entry)}
    </div>
  );
};
