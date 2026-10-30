import * as React from 'react';
import { extensionOf } from '@/common/fileKind';
import type { DayFile } from '@/types/day';
import { openTitle } from '../dayLinks';
import { RowTime, rowStyles } from './DayCard';
import { useDaySidebarContext, vaultRelative } from './daySidebarContext';

/**
 * A document or a person the day touched, at its latest mention. A file that
 * is not Markdown shows its extension, since it opens outside the editor.
 */
export function FileRow({ file }: { file: DayFile }) {
  const { openPath, root } = useDaySidebarContext();
  const extension = extensionOf(file.path);
  return (
    <button
      type="button"
      title={openTitle(vaultRelative(root, file.path))}
      onClick={(event) => openPath(file.path, event)}
      onAuxClick={(event) => event.button === 1 && openPath(file.path, event)}
      className={rowStyles}
    >
      <RowTime>{file.last}</RowTime>
      <span className="min-w-0 flex-1 truncate">{file.label}</span>
      {extension && extension !== 'md' ? (
        <span className="flex-none text-2xs text-foreground-tertiary">{extension}</span>
      ) : null}
    </button>
  );
}
