import { useCallback, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DiskEntry } from '@/types/disk';
import { useDiskStore } from '../store/diskStore';

interface GridNavigationOptions {
  /** The visible, sorted, filtered list - arrowing must follow what the eye sees. */
  entries: DiskEntry[];
  /** 1 in list mode; the measured column count in gallery mode. */
  columns: number;
}

/** How long consecutive keystrokes accumulate into one type-to-select prefix. */
const TYPE_AHEAD_RESET_MS = 800;

export function useGridNavigation({ entries, columns }: GridNavigationOptions) {
  const typeAhead = useRef<{ prefix: string; at: number }>({ prefix: '', at: 0 });

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (entries.length === 0) return;

      // Let application shortcuts (Cmd+F, Cmd+Up, ...) through untouched.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const selectedPath = useDiskStore.getState().selectedPath;
      const current = entries.findIndex((candidate) => candidate.path === selectedPath);
      const clamp = (index: number) => Math.min(entries.length - 1, Math.max(0, index));

      const moveTo = (index: number) => {
        event.preventDefault();
        useDiskStore.getState().select(entries[clamp(index)].path);
      };

      // With nothing selected, any arrow lands on the first entry.
      const from = current === -1 ? 0 : current;
      if (current === -1 && event.key.startsWith('Arrow')) {
        moveTo(0);
        return;
      }

      switch (event.key) {
        case 'ArrowRight':
          moveTo(from + 1);
          return;
        case 'ArrowLeft':
          moveTo(from - 1);
          return;
        case 'ArrowDown':
          moveTo(from + columns);
          return;
        case 'ArrowUp':
          moveTo(from - columns);
          return;
        case 'Home':
          moveTo(0);
          return;
        case 'End':
          moveTo(entries.length - 1);
          return;
        default:
          break;
      }

      // Enter is deliberately not handled: DiskExplorer binds it to rename,
      // and Cmd+Down to open, matching Finder.

      // Type-to-select. Single printable characters only, so this cannot
      // swallow Tab, Escape, Space, or function keys.
      if (event.key.length !== 1 || event.key === ' ') return;

      const now = event.timeStamp;
      const isContinuation = now - typeAhead.current.at < TYPE_AHEAD_RESET_MS;
      const prefix = (isContinuation ? typeAhead.current.prefix : '') + event.key.toLowerCase();
      typeAhead.current = { prefix, at: now };

      const match = entries.findIndex((candidate) =>
        candidate.name.toLowerCase().startsWith(prefix)
      );
      if (match !== -1) moveTo(match);
    },
    [columns, entries]
  );

  return { onKeyDown };
}
