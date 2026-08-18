import React from 'react';

/**
 * A shaped placeholder rather than the word "Loading".
 *
 * It communicates what is arriving and how much, so the layout does not jump
 * when content lands - the difference between an app that feels fast and one
 * that merely is.
 */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div data-testid="skeleton" className={`animate-pulse rounded-md bg-muted/60 ${className}`} />
);

export const GallerySkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 p-4">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="flex flex-col gap-2">
        <Skeleton className="aspect-square" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    ))}
  </div>
);
