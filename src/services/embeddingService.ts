// src/services/embeddingService.ts

import OpenAI from 'openai';

/**
 * Configuration for the embedding service
 */
export interface EmbeddingConfig {
  model?: string;
  maxTokens?: number;
  batchSize?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<EmbeddingConfig> = {
  model: 'text-embedding-3-small',
  maxTokens: 8191,  // Model's max input tokens
  batchSize: 100,   // Max texts per batch request
};

/**
 * Embedding dimensions by model
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * OpenAI client singleton
 */
let openaiClient: OpenAI | null = null;

/**
 * Get or create OpenAI client
 */
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Truncate text to fit within token limit
 * Uses a rough estimate of 4 characters per token
 */
function truncateText(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;  // Rough estimate
  
  if (text.length <= maxChars) {
    return text;
  }
  
  // Truncate and add ellipsis
  return text.substring(0, maxChars - 3) + '...';
}

/**
 * Clean and prepare text for embedding
 */
function prepareText(text: string): string {
  return text
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();
}

/**
 * Generate embedding for a single text
 */
export async function embed(
  text: string,
  config: EmbeddingConfig = {}
): Promise<number[]> {
  const { model, maxTokens } = { ...DEFAULT_CONFIG, ...config };
  
  const client = getOpenAIClient();
  const preparedText = prepareText(truncateText(text, maxTokens));
  
  if (!preparedText) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const response = await client.embeddings.create({
    model,
    input: preparedText,
  });

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function embedBatch(
  texts: string[],
  config: EmbeddingConfig = {}
): Promise<number[][]> {
  const { model, maxTokens, batchSize } = { ...DEFAULT_CONFIG, ...config };
  
  if (texts.length === 0) {
    return [];
  }

  const client = getOpenAIClient();
  const results: number[][] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    const preparedBatch = batch
      .map(text => prepareText(truncateText(text, maxTokens)))
      .filter(text => text.length > 0);
    
    if (preparedBatch.length === 0) {
      // Add empty embeddings for filtered texts
      results.push(...batch.map(() => []));
      continue;
    }

    const response = await client.embeddings.create({
      model,
      input: preparedBatch,
    });

    // Map embeddings back to original batch order
    let responseIndex = 0;
    for (const originalText of batch) {
      const prepared = prepareText(truncateText(originalText, maxTokens));
      if (prepared.length > 0) {
        results.push(response.data[responseIndex].embedding);
        responseIndex++;
      } else {
        results.push([]);
      }
    }
  }

  return results;
}

/**
 * Generate embedding for a content item
 * Combines title and text for richer semantic representation
 */
export async function embedContentItem(
  item: { title?: string; text?: string },
  config: EmbeddingConfig = {}
): Promise<number[]> {
  const parts: string[] = [];
  
  if (item.title) {
    parts.push(item.title);
  }
  
  if (item.text) {
    parts.push(item.text);
  }

  if (parts.length === 0) {
    throw new Error('Content item must have title or text');
  }

  return embed(parts.join('\n\n'), config);
}

/**
 * Generate embeddings for multiple content items
 */
export async function embedContentItems(
  items: Array<{ title?: string; text?: string }>,
  config: EmbeddingConfig = {}
): Promise<number[][]> {
  const texts = items.map(item => {
    const parts: string[] = [];
    if (item.title) parts.push(item.title);
    if (item.text) parts.push(item.text);
    return parts.join('\n\n');
  });

  return embedBatch(texts, config);
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Get embedding dimensions for a model
 */
export function getEmbeddingDimensions(model?: string): number {
  const modelName = model || DEFAULT_CONFIG.model;
  return MODEL_DIMENSIONS[modelName] || 1536;
}

/**
 * Check if embedding service is properly configured
 */
export function isConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Embedding service interface
 */
export const embeddingService = {
  embed,
  embedBatch,
  embedContentItem,
  embedContentItems,
  cosineSimilarity,
  getEmbeddingDimensions,
  isConfigured,
};
