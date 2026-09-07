import React, { useId, useState } from 'react';
import { Folder } from 'lucide-react';
import { formatBytes } from '@/common/formatBytes';
import type { DiskEntry } from '@/types/disk';
import { ImagePreview } from './ImagePreview';
import { MarkdownPreview } from './MarkdownPreview';
import { MediaPreview } from './MediaPreview';
import { PdfPreview } from './PdfPreview';
import { TextPreview } from './TextPreview';
import { UnsupportedPreview } from './UnsupportedPreview';
import { EntryActions } from '../EntryActions';
import { EmptyState } from '../EmptyState';
import { DetailsPanel } from './DetailsPanel';

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
    case 'markdown':
      return <MarkdownPreview entry={entry} />;
    case 'text':
      return <TextPreview entry={entry} />;
    case 'video':
    case 'audio':
      return <MediaPreview entry={entry} />;
    case 'pdf':
      return <PdfPreview entry={entry} />;
    default:
      return <UnsupportedPreview entry={entry} />;
  }
}

export const DetailPane: React.FC<{ entry: DiskEntry | null }> = ({ entry }) => {
  const tabsId = useId();
  const [activeTab, setActiveTab] = useState<'preview' | 'details'>('preview');

  if (!entry) {
    return (
      <div
        data-testid="detail-empty"
        className="flex h-full"
      >
        <EmptyState
          Icon={Folder}
          title="Select a file"
          description="Choose a file in the current folder to preview it here."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border/60 px-4 py-2">
        <div className="min-w-0">
          <h2 data-testid="detail-title" className="truncate text-sm font-medium" title={entry.name}>
            {entry.name}
          </h2>
          <p data-testid="detail-subtitle" className="text-xs text-muted-foreground">
            {entry.isDirectory ? 'Folder' : formatBytes(entry.size)}
          </p>
        </div>
        <EntryActions entry={entry} />
      </header>

      <div data-disk-shortcuts-ignore="true" role="tablist" aria-label="Item view" className="flex shrink-0 gap-1 border-b border-border/60 px-4 py-1">
        <button
          type="button"
          role="tab"
          id={`${tabsId}-preview-tab`}
          aria-controls={`${tabsId}-preview-panel`}
          aria-selected={activeTab === 'preview'}
          onClick={() => setActiveTab('preview')}
          className="rounded-md px-2 py-1 text-xs aria-selected:bg-muted aria-selected:text-foreground text-muted-foreground"
        >
          Preview
        </button>
        <button
          type="button"
          role="tab"
          id={`${tabsId}-details-tab`}
          aria-controls={`${tabsId}-details-panel`}
          aria-selected={activeTab === 'details'}
          onClick={() => setActiveTab('details')}
          className="rounded-md px-2 py-1 text-xs aria-selected:bg-muted aria-selected:text-foreground text-muted-foreground"
        >
          Details
        </button>
      </div>

      <div
        key={`${entry.path}-${activeTab}`}
        id={`${tabsId}-${activeTab}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${activeTab}-tab`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {activeTab === 'preview'
          ? renderPreview(entry)
          : <DetailsPanel key={entry.path} entry={entry} />}
      </div>
    </div>
  );
};
