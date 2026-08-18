import React from 'react';
import { PanelResizeHandle } from 'react-resizable-panels';

/**
 * A 1px visual line inside a 9px grab target.
 *
 * The two are separated deliberately: a 1px hit area is close to unusable with
 * a trackpad, while a 9px visible divider looks like a gutter. The inner span
 * is what you see; the outer handle is what you can grab.
 */
export const PaneHandle: React.FC<{ direction?: 'horizontal' | 'vertical' }> = ({
  direction = 'horizontal',
}) => (
  <PanelResizeHandle
    data-testid="pane-handle"
    className={
      direction === 'horizontal'
        ? 'group relative flex w-[9px] -mx-1 items-stretch justify-center cursor-col-resize'
        : 'group relative flex h-[9px] -my-1 items-stretch justify-center cursor-row-resize'
    }
  >
    <span
      aria-hidden="true"
      className={
        (direction === 'horizontal' ? 'w-px h-full' : 'h-px w-full') +
        ' bg-border transition-colors duration-100' +
        ' group-hover:bg-[hsl(var(--primary)/0.7)]' +
        ' group-data-[resize-handle-state=drag]:bg-[hsl(var(--primary))]'
      }
    />
  </PanelResizeHandle>
);
