import React, { useCallback, useRef } from 'react';

interface FileHandlerProps {
  onFileDrop: (files: File[]) => void;
  children: React.ReactNode;
}

export const FileHandler: React.FC<FileHandlerProps> = ({ 
  onFileDrop,
  children 
}) => {
  const dropAreaRef = useRef<HTMLDivElement>(null);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dropAreaRef.current) {
      dropAreaRef.current.classList.add('drag-active');
    }
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dropAreaRef.current) {
      dropAreaRef.current.classList.remove('drag-active');
    }
  }, []);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dropAreaRef.current) {
      dropAreaRef.current.classList.remove('drag-active');
    }
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      onFileDrop(files);
    }
  }, [onFileDrop]);
  
  return (
    <div 
      ref={dropAreaRef}
      className="w-full h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}; 