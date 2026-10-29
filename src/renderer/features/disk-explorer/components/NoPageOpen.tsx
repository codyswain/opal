import React from 'react';

/** What the page shows once every tab is closed. */
export const NoPageOpen: React.FC = () => (
  <div
    data-testid="no-page-open"
    className="flex h-full items-center justify-center p-8"
  >
    <p className="text-ui text-foreground-tertiary">
      No file is open. Choose one in the sidebar or press ⌘K to search.
    </p>
  </div>
);
