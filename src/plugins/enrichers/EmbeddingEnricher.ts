// src/plugins/enrichers/EmbeddingEnricher.ts

import { EnricherPlugin, ContentItem } from "../../types";
import { embeddingService, EmbeddingConfig } from "../../services/embeddingService";

/**
 * Configuration for the embedding enricher
 */
export interface EmbeddingEnricherConfig {
  /** Minimum text length to generate embeddings (default: 50) */
  minLength?: number;
  /** Maximum number of items to process in a single batch (default: 50) */
  batchSize?: number;
  /** OpenAI model to use for embeddings */
  model?: string;
  /** Whether to skip items that already have embeddings (default: true) */
  skipExisting?: boolean;
  /** Whether to include title in embedding text (default: true) */
  includeTitle?: boolean;
}

/**
 * EmbeddingEnricher adds vector embeddings to content items for semantic search.
 * 
 * This enricher uses OpenAI's text-embedding-3-small model to generate
 * 1536-dimensional embeddings that can be used for:
 * - Semantic search across content
 * - Finding similar content
 * - Clustering and categorization
 * 
 * The embeddings are stored in the `embedding` field of each content item.
 */
export class EmbeddingEnricher implements EnricherPlugin {
  private config: Required<EmbeddingEnricherConfig>;

  static constructorInterface = {
    parameters: [
      {
        name: 'minLength',
        type: 'number',
        required: false,
        description: 'Minimum text length to generate embeddings (default: 50)'
      },
      {
        name: 'batchSize',
        type: 'number',
        required: false,
        description: 'Maximum items per batch (default: 50)'
      },
      {
        name: 'model',
        type: 'string',
        required: false,
        description: 'OpenAI embedding model (default: text-embedding-3-small)'
      },
      {
        name: 'skipExisting',
        type: 'boolean',
        required: false,
        description: 'Skip items that already have embeddings (default: true)'
      },
      {
        name: 'includeTitle',
        type: 'boolean',
        required: false,
        description: 'Include title in embedding text (default: true)'
      }
    ]
  };

  /**
   * Creates a new EmbeddingEnricher instance.
   * @param config - Configuration options
   */
  constructor(config: EmbeddingEnricherConfig = {}) {
    this.config = {
      minLength: config.minLength ?? 50,
      batchSize: config.batchSize ?? 50,
      model: config.model ?? 'text-embedding-3-small',
      skipExisting: config.skipExisting ?? true,
      includeTitle: config.includeTitle ?? true,
    };
  }

  /**
   * Check if the embedding service is properly configured
   */
  private isServiceConfigured(): boolean {
    return embeddingService.isConfigured();
  }

  /**
   * Prepare text for embedding by combining title and text
   */
  private prepareText(item: ContentItem): string {
    const parts: string[] = [];

    if (this.config.includeTitle && item.title) {
      parts.push(item.title);
    }

    if (item.text) {
      parts.push(item.text);
    }

    return parts.join('\n\n');
  }

  /**
   * Check if an item should be processed for embedding
   */
  private shouldProcess(item: ContentItem): boolean {
    // Skip if already has embedding and skipExisting is true
    if (this.config.skipExisting && item.embedding && item.embedding.length > 0) {
      return false;
    }

    // Check minimum length
    const text = this.prepareText(item);
    if (text.length < this.config.minLength) {
      return false;
    }

    return true;
  }

  /**
   * Enriches content items by generating vector embeddings.
   * 
   * @param contentItems - Array of content items to enrich
   * @returns Promise<ContentItem[]> - Array of enriched content items with embeddings
   */
  public async enrich(contentItems: ContentItem[]): Promise<ContentItem[]> {
    // Check if service is configured
    if (!this.isServiceConfigured()) {
      console.warn('[EmbeddingEnricher] OPENAI_API_KEY not set, skipping embeddings');
      return contentItems;
    }

    if (contentItems.length === 0) {
      return contentItems;
    }

    // Create a map to track original indices
    const itemsToProcess: { index: number; text: string }[] = [];
    
    for (let i = 0; i < contentItems.length; i++) {
      const item = contentItems[i];
      if (this.shouldProcess(item)) {
        itemsToProcess.push({
          index: i,
          text: this.prepareText(item),
        });
      }
    }

    if (itemsToProcess.length === 0) {
      console.log('[EmbeddingEnricher] No items need embedding');
      return contentItems;
    }

    console.log(`[EmbeddingEnricher] Generating embeddings for ${itemsToProcess.length} items`);

    // Process in batches
    const embeddingConfig: EmbeddingConfig = {
      model: this.config.model,
      batchSize: this.config.batchSize,
    };

    try {
      // Generate embeddings in batches
      const texts = itemsToProcess.map(item => item.text);
      const embeddings = await embeddingService.embedBatch(texts, embeddingConfig);

      // Create result array (copy of original)
      const enrichedItems = [...contentItems];

      // Apply embeddings to the correct items
      for (let i = 0; i < itemsToProcess.length; i++) {
        const { index } = itemsToProcess[i];
        const embedding = embeddings[i];

        if (embedding && embedding.length > 0) {
          enrichedItems[index] = {
            ...enrichedItems[index],
            embedding,
          };
        }
      }

      console.log(`[EmbeddingEnricher] Successfully generated ${embeddings.filter(e => e.length > 0).length} embeddings`);
      
      return enrichedItems;
    } catch (error) {
      console.error('[EmbeddingEnricher] Error generating embeddings:', error);
      // Return original items without embeddings rather than failing
      return contentItems;
    }
  }

  /**
   * Generate embedding for a single item (utility method)
   */
  public async embedSingle(item: ContentItem): Promise<number[] | null> {
    if (!this.isServiceConfigured()) {
      return null;
    }

    const text = this.prepareText(item);
    if (text.length < this.config.minLength) {
      return null;
    }

    try {
      return await embeddingService.embed(text, { model: this.config.model });
    } catch (error) {
      console.error('[EmbeddingEnricher] Error generating single embedding:', error);
      return null;
    }
  }
}

export default EmbeddingEnricher;
