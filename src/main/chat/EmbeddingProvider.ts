import type { OpenAI } from 'openai';
import { CHAT_EMBEDDING_DIMENSIONS, CHAT_EMBEDDING_MODEL } from '@/types/chat';

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

const BATCH = 64;

/** OpenAI embeddings, batched, normalized to unit length so search is a dot product. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = CHAT_EMBEDDING_DIMENSIONS;

  constructor(private client: Pick<OpenAI, 'embeddings'>) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (let offset = 0; offset < texts.length; offset += BATCH) {
      const batch = texts.slice(offset, offset + BATCH);
      const response = await this.client.embeddings.create({
        model: CHAT_EMBEDDING_MODEL,
        input: batch,
        dimensions: CHAT_EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      });
      const ordered = [...response.data].sort((left, right) => left.index - right.index);
      for (const item of ordered) vectors.push(normalize(Float32Array.from(item.embedding)));
    }
    return vectors;
  }
}

export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) sum += vector[i] * vector[i];
  const length = Math.sqrt(sum) || 1;
  const result = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) result[i] = vector[i] / length;
  return result;
}
