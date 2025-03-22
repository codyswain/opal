import { FSEntry, Note } from '@/types';

declare global {
  interface Window {
    fileExplorer: {
      getEntries: () => Promise<{ success: boolean; items: Record<string, FSEntry>; error?: string }>;
      getNote: (id: string) => Promise<{ success: boolean; note: Note; error?: string }>;
      updateNoteContent: (id: string, content: string) => Promise<{ success: boolean; error?: string }>;
      renameItem: (itemPath: string, newName: string) => Promise<{ success: boolean; newPath: string; error?: string }>;
    };
    electron: {
      saveNote: (note: Note, dirPath: string) => Promise<any>;
      deleteNote: (noteId: string, dirPath: string) => Promise<any>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      getNotePath: (noteId: string) => Promise<string>;
      getOpenAIKey: () => Promise<string>;
      setOpenAIKey: (key: string) => Promise<void>;
      createDirectory: (dirPath: string) => Promise<any>;
      deleteDirectory: (dirPath: string) => Promise<any>;
      getTopLevelFolders: () => Promise<string[]>;
      addTopLevelFolder: (folderPath: string) => Promise<any>;
      removeTopLevelFolder: (folderPath: string) => Promise<any>;
      openFolderDialog: () => Promise<string>;
      getDirectoryStructure: (dirPath: string) => Promise<any>;
      loadNote: (notePath: string) => Promise<any>;
      deleteFileNode: (fileNodeType: string, fileNodePath: string) => Promise<any>;
      generateNoteEmbeddings: (note: Note, fileNode: any) => Promise<any>;
      findSimilarNotes: (query: string, directoryStructures: any) => Promise<any>;
      performRAGChat: (conversation: { role: string; content: string }[], directoryStructures: any) => Promise<any>;
      createFolder: (parentPath: string, folderName: string) => Promise<any>;
      createNote: (parentPath: string, noteName: string, initialContent: string) => Promise<any>;
      listItems: (directoryPath: string) => Promise<any>;
      getItemByPath: (itemPath: string) => Promise<any>;
      deleteItem: (itemPath: string) => Promise<any>;
      renameItem: (itemPath: string, newName: string) => Promise<any>;
      moveItem: (oldPath: string, newParentPath: string) => Promise<any>;
      getNoteContent: (notePath: string) => Promise<any>;
      updateNoteContent: (notePath: string, newContent: string) => Promise<any>;
      importFile: (sourceFilePath: string, newPath: string) => Promise<any>;
      addRootFolder: (folderPath: string) => Promise<any>;
    };
    databaseAPI: {
      createFolder: (parentPath: string, folderName: string) => Promise<any>;
      createNote: (parentPath: string, noteName: string, initialContent: string) => Promise<any>;
      getNoteContent: (notePath: string) => Promise<any>;
      updateNoteContent: (notePath: string, newContent: string) => Promise<any>;
      listItems: (directoryPath: string) => Promise<any>;
      getItemByPath: (itemPath: string) => Promise<any>;
      deleteItem: (itemPath: string) => Promise<any>;
      renameItem: (itemPath: string, newName: string) => Promise<any>;
      moveItem: (oldPath: string, newParentPath: string) => Promise<any>;
      addRootFolder: (folderPath: string) => Promise<any>;
      importFile: (sourceFilePath: string, destinationPath: string) => Promise<any>;
      triggerMigration: () => Promise<any>;
      cleanupOldNotes: () => Promise<any>;
      resetDatabase: () => Promise<any>;
    };
  }
}

export {}; 