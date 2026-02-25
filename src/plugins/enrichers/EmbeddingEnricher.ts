// src/plugins/enrichers/EmbeddingEnricher.ts

import { EnricherPlugin, ContentItem, AiProvider } from "../../types";

/**
 * Configuration for the embedding enricher
 */
export interface EmbeddingEnricherConfig {
  /** AI provider to use for generating embeddings (required) */
  provider: AiProvider | string;
  /** Minimum text length to generate embeddings (default: 50) */
  minLength?: number;
  /** Maximum number of items to process in a single batch (default: 50) */
  batchSize?: number;
  /** Whether to skip items that already have embeddings (default: true) */
  skipExisting?: boolean;
  /** Whether to include title in embedding text (default: true) */
  includeTitle?: boolean;
}

/**
 * EmbeddingEnricher adds vector embeddings to content items for semantic search.
 * 
 * This enricher uses an AI provider's embed() method to generate
 * vector embeddings that can be used for:
 * - Semantic search across content
 * - Finding similar content
 * - Clustering and categorization
 * 
 * The embeddings are stored in the `embedding` field of each content item.
 */
export class EmbeddingEnricher implements EnricherPlugin {
  public provider: AiProvider | string;
  private minLength: number;
  private batchSize: number;
  private skipExisting: boolean;
  private includeTitle: boolean;

  static constructorInterface = {
    parameters: [
      {
        name: 'provider',
        type: 'AiProvider',
        required: true,
        description: 'AI provider to use for generating embeddings'
      },
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
   * @param config - Configuration options including the AI provider
   */
  constructor(config: EmbeddingEnricherConfig) {
    this.provider = config.provider;
    this.minLength = Math.max(1, Number(config.minLength) || 50);
    this.batchSize = Math.max(1, Number(config.batchSize) || 50);
    this.skipExisting = config.skipExisting ?? true;
    this.includeTitle = config.includeTitle ?? true;
  }

  /**
   * Check if the provider is properly configured (injected as an AiProvider instance)
   */
  private isProviderReady(): boolean {
    return typeof this.provider !== 'string' && this.provider != null;
  }

  /**
   * Prepare text for embedding by combining title and text
   */
  private prepareText(item: ContentItem): string {
    const parts: string[] = [];

    if (this.includeTitle && item.title) {
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
    if (this.skipExisting && item.embedding && item.embedding.length > 0) {
      return false;
    }

    // Check minimum length
    const text = this.prepareText(item);
    if (text.length < this.minLength) {
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
    // Check if provider is ready (injected by loadProviders)
    if (!this.isProviderReady()) {
      console.warn('[EmbeddingEnricher] AI provider not configured, skipping embeddings');
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

    try {
      // Process in batches using the AI provider
      const texts = itemsToProcess.map(item => item.text);
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += this.batchSize) {
        const batch = texts.slice(i, i + this.batchSize);
        const batchEmbeddings = await (this.provider as AiProvider).embed(batch);
        allEmbeddings.push(...batchEmbeddings);
      }

      // Create result array (copy of original)
      const enrichedItems = [...contentItems];

      // Apply embeddings to the correct items
      for (let i = 0; i < itemsToProcess.length; i++) {
        const { index } = itemsToProcess[i];
        const embedding = allEmbeddings[i];

        if (embedding && embedding.length > 0) {
          enrichedItems[index] = {
            ...enrichedItems[index],
            embedding,
          };
        }
      }

      console.log(`[EmbeddingEnricher] Successfully generated ${allEmbeddings.filter(e => e.length > 0).length} embeddings`);
      
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
    if (!this.isProviderReady()) {
      return null;
    }

    const text = this.prepareText(item);
    if (text.length < this.minLength) {
      return null;
    }

    try {
      const results = await (this.provider as AiProvider).embed([text]);
      return results[0] || null;
    } catch (error) {
      console.error('[EmbeddingEnricher] Error generating single embedding:', error);
      return null;
    }
  }
}

export default EmbeddingEnricher;
