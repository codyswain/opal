import React from 'react';
import { toast } from 'sonner';
import { usePaletteStore } from '@/renderer/features/commands/store/paletteStore';
import { openToday } from '@/renderer/features/shell/utils/openToday';
import { Button } from '@/renderer/shared/ui';
import { useTabsStore } from '../store/tabsStore';

/** What the page shows once every tab is closed, as Obsidian's empty tab does. */
export const NoPageOpen: React.FC = () => {
  const goToToday = () => {
    void openToday((intent) => useTabsStore.getState().open(intent.location))
      .then((opened) => {
        if (!opened) toast.error('Open your vault folder first.');
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Could not open today's page.")
      );
  };

  return (
    <div
      data-testid="no-page-open"
      className="flex h-full flex-col items-center justify-center gap-3 p-8"
    >
      <p className="text-ui text-foreground-tertiary">No page is open</p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="compact" onClick={goToToday}>
          Open Today
        </Button>
        <Button
          variant="ghost"
          size="compact"
          onClick={() => usePaletteStore.getState().show()}
        >
          Search
          <kbd className="font-sans text-metadata text-foreground-tertiary">⌘K</kbd>
        </Button>
      </div>
    </div>
  );
};
