import React from 'react';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import type { DiskEntry } from '@/types/disk';

/**
 * Electron ships Chromium's PDF viewer, so an <embed> is the entire
 * implementation. No pdf.js, no extra dependency.
 */
export const PdfPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => (
  <div className="flex-1 min-h-0">
    <embed
      key={entry.path}
      src={toOpalFileUrl(entry.path)}
      type="application/pdf"
      data-testid="pdf-preview"
      className="w-full h-full"
    />
  </div>
);
