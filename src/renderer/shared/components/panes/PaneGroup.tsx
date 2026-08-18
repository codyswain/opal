import React from 'react';
import { PanelGroup } from 'react-resizable-panels';

interface PaneGroupProps {
  /** Stable identifier for this layout. Must match the usePaneLayout key. */
  layoutKey: string;
  /** From usePaneLayout. Persists the layout, debounced. */
  onLayout: (sizes: number[]) => void;
  direction?: 'horizontal' | 'vertical';
  className?: string;
  children: React.ReactNode;
}

/**
 * A PanelGroup wired for persistence.
 *
 * The caller owns the usePaneLayout hook rather than this component, because
 * each child Pane needs the restored size for its own defaultSize — and a
 * component cannot hand values to its own children's props. So the caller
 * calls the hook once, spends `sizes` on the Panes, and passes `onLayout` here.
 *
 * react-resizable-panels' own autoSaveId is deliberately unused: it writes
 * unversioned values under its own key, bypassing the fallback behaviour in
 * prefs.ts that stops a changed pane count from producing a broken layout.
 */
export const PaneGroup: React.FC<PaneGroupProps> = ({
  layoutKey,
  onLayout,
  direction = 'horizontal',
  className,
  children,
}) => (
  <PanelGroup
    direction={direction}
    onLayout={onLayout}
    className={className}
    id={`pane-group-${layoutKey}`}
    data-testid={`pane-group-${layoutKey}`}
  >
    {children}
  </PanelGroup>
);
