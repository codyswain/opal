import React from 'react';
import { FileQuestion } from 'lucide-react';
import { formatBytes } from '@/common/formatBytes';
import type { DiskEntry } from '@/types/disk';

/**
 * The honest fallback. Naming the extension and offering the OS as an escape
 * hatch beats a blank pane; Task 6 wires the button up.
 */
export const UnsupportedPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => (
  <div
    data-testid="detail-unsupported"
    className="grid flex-1 place-items-center p-8 text-center"
  >
    <div className="flex max-w-xs flex-col items-center gap-2">
      <FileQuestion className="h-10 w-10 opacity-30" />
      <p className="text-sm text-muted-foreground">
        No preview available for this file type.
      </p>
      <p className="text-xs text-muted-foreground/70">{formatBytes(entry.size)}</p>
    </div>
  </div>
);
