import * as React from 'react';
import { cn } from '@/renderer/shared/utils';

interface SidebarResizeHandleProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Double-click goes back to it. */
  defaultValue: number;
  /** The sidebar edge the handle sits on: "end" for the left sidebar, "start" for the right one. */
  edge?: 'start' | 'end';
  onChange: (width: number) => void;
  /** Called on a double-click instead of going to `defaultValue`. */
  onReset?: () => void;
}

/** A 4px strip on a sidebar's inner edge that drags its width; arrow keys move it 8px. */
export function SidebarResizeHandle({
  defaultValue,
  edge = 'end',
  label,
  max,
  min,
  onChange,
  onReset,
  value,
}: SidebarResizeHandleProps) {
  // Dragging toward the page widens a sidebar, which is right for the left one and left for the right one.
  const direction = edge === 'end' ? 1 : -1;
  const clamp = (width: number) => Math.min(max, Math.max(min, width));

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = value;
    const onPointerMove = (moveEvent: PointerEvent) => {
      onChange(clamp(startWidth + direction * (moveEvent.clientX - startX)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    onChange(clamp(value + direction * step * 8));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onDoubleClick={() => (onReset ? onReset() : onChange(defaultValue))}
      onKeyDown={onKeyDown}
      onPointerDown={beginResize}
      className={cn(
        'no-drag absolute inset-y-0 z-10 w-1 cursor-col-resize bg-transparent outline-none transition-hover hover:bg-focus/40 focus-visible:bg-focus',
        edge === 'end' ? 'right-[-2px]' : 'left-[-2px]',
      )}
    />
  );
}

export type { SidebarResizeHandleProps };
