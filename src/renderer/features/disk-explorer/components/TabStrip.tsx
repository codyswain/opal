import React from 'react';
import { useFilesNavigation } from '../navigation/FilesNavigationContext';
import { X } from 'lucide-react';
import { useTabsStore } from '../store/tabsStore';

function basename(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}

/**
 * The open-files strip above the detail pane.
 *
 * Each tab's body is the existing DetailPane, so this component owns selection
 * and ordering only — there is no second preview implementation.
 */
export const TabStrip: React.FC = () => {
  const openPaths = useTabsStore((state) => state.openPaths);
  const activePath = useTabsStore((state) => state.activePath);
  const {openFile: activate, closeFile: close} = useFilesNavigation();

  if (openPaths.length === 0) return null;

  return (
    <div
      role="tablist"
      data-testid="tab-strip"
      className="flex shrink-0 items-stretch overflow-x-auto border-b border-border/60 bg-background"
    >
      {openPaths.map((path) => {
        const isActive = path === activePath;


        return (
          <div
            key={path}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            title={path}
            data-testid={`tab-${path}`}
            onClick={() => activate(path)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(path); } }}
            className={
              'group flex min-w-0 max-w-[200px] shrink-0 cursor-default items-center gap-1.5 ' +
              'border-r border-border/60 px-3 py-1.5 text-xs transition-colors duration-100 ' +
              (isActive
                ? 'bg-muted/60 text-foreground'
                : 'text-muted-foreground hover:bg-muted/30')
            }
          >
            <span
              data-testid={`tab-label-${path}`}
              className="truncate"
            >
              {basename(path)}
            </span>
            <button
              type="button"
              aria-label={`Close ${basename(path)}`}
              data-testid={`tab-close-${path}`}
              data-disk-shortcuts-ignore="true"
              onClick={(event) => {
                // Without this the tab's own onClick would activate what is
                // about to be removed.
                event.stopPropagation();
                close(path);
              }}
              className="rounded p-0.5 opacity-0 transition-opacity duration-100 hover:bg-muted group-hover:opacity-100 focus:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
