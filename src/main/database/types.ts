export interface Item {
  id: string;
  type: 'folder' | 'file' | 'note';
  path: string;
  parent_path: string | null;
  name: string;
  created_at: string; // Or Date, see note below
  updated_at: string; // Or Date
  size: number | null;
}

export interface Note {
  item_id: string;
  content: string;
}

export interface AIMetadata {
  item_id: string;
  summary: string | null;
  tags: string | null; // Consider string[] if you split tags
  embedding: Buffer | null; // If you store embeddings
} 

export interface ItemWithAIMetadata extends Item {
  summary: string | null;
  tags: string | null;
  embedding: Buffer | null;
}