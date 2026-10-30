import * as React from 'react';
import { extensionOf } from '@/common/fileKind';
import type { DayDocument } from '@/types/day';
import { openTitle } from '../dayLinks';
import { RowTime, rowStyles } from './DayCard';
import { useDaySidebarContext, vaultRelative } from './daySidebarContext';

/**
 * A file the day's log links to. The time is the latest line that does. A
 * file that is not Markdown shows its extension, since it opens outside the
 * editor.
 */
export function DocumentRow({ document }: { document: DayDocument }) {
  const { openPath, root } = useDaySidebarContext();
  const extension = extensionOf(document.path);
  return (
    <button
      type="button"
      title={openTitle(vaultRelative(root, document.path))}
      onClick={(event) => openPath(document.path, event)}
      onAuxClick={(event) => event.button === 1 && openPath(document.path, event)}
      className={rowStyles}
    >
      <RowTime>{document.last}</RowTime>
      <span className="min-w-0 flex-1 truncate">{document.label}</span>
      {extension && extension !== 'md' ? (
        <span className="flex-none text-2xs text-foreground-tertiary">{extension}</span>
      ) : null}
    </button>
  );
}
