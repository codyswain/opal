// src/shared/types/index.ts

import OpenAI from "openai";

export interface NoteMetadata {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface NoteContent {
  content?: string;
}

export interface Note extends NoteMetadata, NoteContent {}

export interface FileNode {
  id: string;
  name: string;
  type: 'directory' | 'note';
  parentId: string | null;
  noteMetadata?: NoteMetadata;
  fullPath: string;
  childIds?: string[];
}

export interface FileNodeMap {
  [id: string]: FileNode;
}

export interface DirectoryStructures {
  rootIds: string[];
  nodes: FileNodeMap;
}

export interface SimilarNote extends Note {
  score: number;
}

export interface TabInfo {
  id: string;
  title: string;
}

export type Embedding = OpenAI.Embeddings.CreateEmbeddingResponse;

export interface Config {
  openaiApiKey?: string;
}

export interface DirectoryEntry {
  name: string;
  type: "directory" | "note";
  noteMetadata?: NoteMetadata;
  fullPath: string;
  children?: DirectoryEntry[];
}