// src/features/notes/context/notesContext.tsx

import React, { createContext, useContext, ReactNode } from 'react';
import { useNotes } from '../hooks/useNotes';

const NotesContext = createContext<ReturnType<typeof useNotes> | undefined>(undefined);

export const NotesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const notesData = useNotes();
  
  return (
    <NotesContext.Provider value={notesData}>
      {children}
    </NotesContext.Provider>
  );
};

export const useNotesContext = () => {
  const context = useContext(NotesContext);
  if (context === undefined) {
    throw new Error('useNotesContext must be used within a NotesProvider');
  }
  return context;
};
