import { useCallback, useRef, useEffect } from 'react';

interface UseResizablePaneProps {
  minHeight?: number;
  maxHeight?: number;
  // minWidth?: number; // Unused
  // maxWidth?: number; // Unused
  // height?: number; // Unused
  setHeight?: (height: number) => void;
  // width?: number; // Unused
  // setWidth?: (width: number) => void; // Unused
  paneRef: React.RefObject<HTMLDivElement>;
  direction: 'horizontal' | 'vertical';
  // initialWidth?: number; // Unused
  // initialHeight?: number; // Unused
}

export const useResizablePane = ({
  minHeight,
  maxHeight,
  // minWidth, // Unused
  // maxWidth, // Unused
  // height, // Unused
  setHeight,
  // width, // Unused
  // setWidth, // Unused
  paneRef,
  direction,
  // initialWidth, // Unused
  // initialHeight, // Unused
}: UseResizablePaneProps) => {
  const isResizing = useRef(false);

  const startResizing = useCallback(() => {
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
