import { useCallback, useRef, useEffect } from 'react';

interface UseResizablePaneProps {
  minHeight?: number;
  maxHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  height?: number;
  setHeight?: (height: number) => void;
  width?: number;
  setWidth?: (width: number) => void;
  paneRef: React.RefObject<HTMLDivElement>;
  direction: 'horizontal' | 'vertical';
  initialWidth?: number;
  initialHeight?: number;
}

export const useResizablePane = ({
  minHeight,
  maxHeight,
  minWidth,
  maxWidth,
  height,
  setHeight,
  width,
  setWidth,
  paneRef,
  direction,
  initialWidth,
  initialHeight,
}: UseResizablePaneProps) => {
  const isResizing = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResizing);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing.current || !paneRef.current) return;
    if (direction === 'vertical') {
      const newHeight = window.innerHeight - e.clientY;

      if (newHeight >= (minHeight || 0) && newHeight <= (maxHeight || Infinity)) {
        if (setHeight) setHeight(newHeight);
      }
    } else if (direction === 'horizontal') {
      // Handle horizontal resizing if needed
    }
  }, [minHeight, maxHeight, setHeight, paneRef, direction]);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener('mousemove', resize);
    document.removeEventListener('mouseup', stopResizing);
  }, [resize]);

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  return { startResizing };
};
