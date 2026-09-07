import type { FileKind } from '@/common/fileKind';

export interface ItemProperties {
  tags: string[];
  description: string;
}

export interface AuthoredLink {
  id: string;
  targetId: string;
  pathHint: string;
}

export interface RelatedItem {
  edgeId: string;
  ownerId: string;
  ownerPath: string;
  direction: 'outgoing' | 'incoming';
  targetId: string;
  /** Null for missing or ambiguous identities; never navigate using the hint. */
  targetPath: string | null;
  targetName: string;
  targetKind: FileKind | null;
  pathHint: string;
  status: 'available' | 'missing' | 'ambiguous';
}

export interface ItemMetadata {
  path: string;
  id: string | null;
  properties: ItemProperties;
  revision: string;
  related: RelatedItem[];
  warnings: string[];
  incomplete: boolean;
}
