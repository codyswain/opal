type FSEntryType = 'folder' | 'file' | 'note';

export interface FSEntry {
  id: string;
  name: string;
  type: FSEntryType;
  path: string;
  parentId: string | null;
  children: string[]; // empty for files and notes
  metadata: {
    createdAt: string;
    updatedAt: string;
    size: number;
  };
  isMounted?: boolean; // Whether this is a mounted folder
  realPath?: string; // The real filesystem path for mounted folders
}

export interface Note {
  id: string;
  content: string;
}

export interface AIMetadata {
  summary: string | null;
  tags: string[] | null;
}