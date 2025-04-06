import React from 'react';
import NoteEditor from '@/renderer/features/file-explorer-v2/components/NoteEditor';
import Notes from './components/Notes';
import RelatedNotes from './components/right-sidebar/RelatedNotes';

const NotesFeature: React.FC<{ 
  isLeftSidebarOpen: boolean; 
  setIsLeftSidebarOpen: (isOpen: boolean) => void; 
  isRightSidebarOpen: boolean; 
  setIsRightSidebarOpen: (isOpen: boolean) => void; 
}> = (props) => {
  return (
    <Notes {...props} />
  );
};

export default NotesFeature;

export {
  Notes,
  NoteEditor,
  RelatedNotes,
};