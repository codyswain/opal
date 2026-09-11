import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';
import { DetailPane } from './detail/DetailPane';

export const QuickLook: React.FC<{ entry: DiskEntry | null }> = ({ entry }) => {
  const isOpen = useDiskStore((state) => state.isQuickLookOpen);
  const close = useDiskStore((state) => state.closeQuickLook);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // A modal opened from inside Quick Look owns Escape. The event reaches
        // this capture listener before Radix can close that nested dialog.
        if (document.querySelector('[data-related-chooser="true"]')) return;
        event.preventDefault();
        close();
      }
    };

    // Capture phase so the overlay wins over the grid's own key handling,
    // which Task 10 adds.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, close]);

  if (!isOpen || !entry) return null;

  return (
    <div data-testid="quick-look" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-end p-4">
      <div
        data-testid="quick-look-backdrop"
        onClick={close}
        className="pointer-events-none absolute inset-0"
      />

      <div
        role="dialog"
        aria-modal="false"
        aria-label={entry.name}
        className="pointer-events-auto relative flex h-[min(85vh,800px)] w-[min(70vw,700px)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close preview"
          data-testid="quick-look-close"
          className="absolute right-2 top-2 z-10 rounded-md p-2 text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <DetailPane entry={entry} />
      </div>
    </div>
  );
};
