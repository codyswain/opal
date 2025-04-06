import { useCallback, useRef, useEffect, useState } from 'react';

interface UseResizableSidebarProps {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;

  onResize: (width: number) => void;

  side: 'left' | 'right';
}

export const useResizableSidebar = ({
  minWidth,
  maxWidth,
  defaultWidth,

  onResize,

  side,
}: UseResizableSidebarProps) => {
  const [width, setWidth] = useState(defaultWidth);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  const startResizing = useCallback((/* e: React.MouseEvent */) => {
    isResizing.current = true;
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResizing);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing.current) return;
      
      let newWidth;
      if (side === 'left') {
        newWidth = e.clientX;
      } else {
        newWidth = window.innerWidth - e.clientX;
      }
  
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setWidth(newWidth);
        onResize(newWidth);
      }
    },
    [minWidth, maxWidth, onResize, side]
  );

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

  return { width, sidebarRef, startResizing };
};