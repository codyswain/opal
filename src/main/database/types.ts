export interface Item {
  id: string;
  type: 'folder' | 'file' | 'note';
  path: string;
  parent_path: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  size?: number;
  is_mounted?: boolean;
  real_path?: string;
}

export interface ItemWithAIMetadata extends Item {
  summary?: string;
  tags?: string;
}

export interface Note {
  item_id: string;
  content: string;
  created_at?: string;
  updated_at?: string;
}

export interface MountedFolder {
  id: string;
  virtualPath: string;
  realPath: string;
}

export interface AIMetadata {
  item_id: string;
  summary: string | null;
  tags: string | null; // Consider string[] if you split tags
  embedding: Buffer | null; // If you store embeddings
}