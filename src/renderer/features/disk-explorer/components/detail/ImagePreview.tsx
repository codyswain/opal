import React, { useCallback, useEffect, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import type { DiskEntry } from '@/types/disk';

/** `null` means fit-to-window; a number is an explicit scale factor. */
type Zoom = number | null;

const ZOOM_STEP = 0.2;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export const ImagePreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const [zoom, setZoom] = useState<Zoom>(null);

  // A new file starts fit-to-window; carrying the previous zoom across files
  // means opening a photo at an arbitrary crop.
  useEffect(() => {
    setZoom(null);
  }, [entry.path]);

  const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  const zoomIn = useCallback(() => {
    setZoom((currentZoom) => clamp((currentZoom ?? 1) + ZOOM_STEP));
  }, []);
  const zoomOut = useCallback(() => {
    setZoom((currentZoom) => clamp((currentZoom ?? 1) - ZOOM_STEP));
  }, []);
  const zoomFit = useCallback(() => {
    setZoom(null);
  }, []);

  const label = zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-muted/20 p-4">
        <img
          src={toOpalFileUrl(entry.path)}
          alt={entry.name}
          decoding="async"
          data-testid="image-preview"
          className={zoom === null ? 'max-h-full max-w-full object-contain' : 'max-w-none'}
          style={zoom === null ? undefined : { width: `${zoom * 100}%` }}
        />
      </div>

      <div className="flex shrink-0 items-center justify-center gap-1 border-t border-border/60 py-1.5">
        <ZoomButton onClick={zoomOut} label="Zoom out" testId="image-zoom-out" Icon={ZoomOut} />
        <span
          data-testid="image-zoom-level"
          className="w-12 text-center text-xs tabular-nums text-muted-foreground"
        >
          {label}
        </span>
        <ZoomButton onClick={zoomIn} label="Zoom in" testId="image-zoom-in" Icon={ZoomIn} />
        <ZoomButton
          onClick={zoomFit}
          label="Fit to window"
          testId="image-zoom-fit"
          Icon={Maximize2}
        />
      </div>
    </div>
  );
};

interface ZoomButtonProps {
  onClick: () => void;
  label: string;
  testId: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const ZoomButton: React.FC<ZoomButtonProps> = ({ onClick, label, testId, Icon }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    data-testid={testId}
    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
  >
    <Icon className="h-4 w-4" />
  </button>
);
