// src/plugins/enrichers/AiImageEnricher.ts

import { EnricherPlugin, ContentItem, AiEnricherConfig, AiProvider } from "../../types";

export interface AiImageEnricherConfig extends AiEnricherConfig {
  /** Maximum posters to generate per batch (default: 5) */
  maxPerBatch?: number;
}

/**
 * AiImageEnricher class implements the EnricherPlugin interface to add AI-generated images
 * to content items. This enricher uses an AI provider to generate images based on the
 * content text and adds them to the item's metadata.
 *
 * Uses two-pass approach: distribute posters across category types, not just first N items.
 */
export class AiImageEnricher implements EnricherPlugin {
  private provider: AiProvider;
  private maxTokens?: number;
  private maxPerBatch: number;

  static constructorInterface = {
    parameters: [
      {
        name: 'provider',
        type: 'AiProvider',
        required: true,
        description: 'AI provider to use for image generation'
      },
      {
        name: 'maxTokens',
        type: 'number',
        required: false,
        description: 'Maximum number of tokens to use for image generation'
      },
      {
        name: 'maxPerBatch',
        type: 'number',
        required: false,
        description: 'Maximum posters to generate per batch (default: 5)'
      }
    ]
  };

  /**
   * Creates a new instance of AiImageEnricher.
   * @param config - Configuration object containing the AI provider and optional parameters
   */
  constructor(config: AiImageEnricherConfig) {
    this.provider = config.provider;
    this.maxTokens = config.maxTokens;
    this.maxPerBatch = config.maxPerBatch || 5;
  }

  /**
   * Two-pass approach: distribute posters across category types, not just first N items.
   * Pass 1: Group by type, find best candidate per type (no existing images, longest text)
   * Pass 2: Generate 1 poster per type (up to maxPerBatch types)
   *
   * @param contentItems - Array of content items to enrich
   * @returns Promise<ContentItem[]> Array of enriched content items
   */
  public async enrich(contentItems: ContentItem[]): Promise<ContentItem[]> {
    const DEBUG = process.env.DEBUG_ENRICHERS === 'true';

    // === CONFIG DEBUG ===
    console.log(`\n=== AiImageEnricher ===`);
    console.log(`Config: maxPerBatch=${this.maxPerBatch}`);
    console.log(`Input: ${contentItems.length} items`);

    // === PASS 1: Group items by type and find best candidate per type ===
    const itemsByType = new Map<string, ContentItem[]>();
    const skipReasons: Record<string, number> = {};

    for (const item of contentItems) {
      const type = item.type || "unknown";

      // Basic check: must have some text
      if (!item.text) {
        skipReasons["no text"] = (skipReasons["no text"] || 0) + 1;
        continue;
      }

      const list = itemsByType.get(type) || [];
      list.push(item);
      itemsByType.set(type, list);
    }

    // Log skip reasons
    if (Object.keys(skipReasons).length > 0) {
      console.log(`Skipped items:`);
      for (const [reason, count] of Object.entries(skipReasons)) {
        console.log(`  - ${reason}: ${count}`);
      }
    }

    // Log items by type
    console.log(`Items by type:`);
    for (const [type, items] of itemsByType) {
      console.log(`  - ${type}: ${items.length} items`);
    }

    // Select best candidate per type (prefer items without images, then longest text)
    const candidates = new Map<string, ContentItem>();
    for (const [type, items] of itemsByType) {
      items.sort((a, b) => {
        const aHasImages = (a.metadata?.images?.length || 0) > 0 ? 1 : 0;
        const bHasImages = (b.metadata?.images?.length || 0) > 0 ? 1 : 0;
        if (aHasImages !== bHasImages) return aHasImages - bHasImages; // no images first
        // Tie-breaker: longer text
        return (b.text?.length || 0) - (a.text?.length || 0);
      });
      candidates.set(type, items[0]);
    }

    console.log(`AiImageEnricher: Found ${candidates.size} category types to cover: ${Array.from(candidates.keys()).join(", ") || "(none)"}`);

    // === PASS 2: Generate posters for candidates (1 per type) ===
    let generated = 0;
    for (const [type, item] of candidates) {
      if (generated >= this.maxPerBatch) {
        console.log(`AiImageEnricher: Hit batch limit (${this.maxPerBatch}), stopping`);
        break;
      }

      const itemId = item.title?.substring(0, 30) || type;
      const hasExistingImages = (item.metadata?.images?.length || 0) > 0;

      if (hasExistingImages) {
        console.log(`AiImageEnricher: [${type}] Skipping ${itemId} - already has images`);
        continue;
      }

      // Debug: show full content being processed
      if (DEBUG) {
        console.log(`\n--- [${type}] Processing ---`);
        console.log(`Content text (${item.text?.length || 0} chars):`);
        console.log(item.text!);
      }

      console.log(`AiImageEnricher: [${type}] Generating poster for ${itemId} (${item.text?.length || 0} chars)`);

      try {
        // Pass type as category for prompt template selection (matches promptTemplates keys)
        const existingImages = item.metadata?.images || [];
        const image = await this.provider.image(item.text!, {
          category: item.type || undefined,
          referenceImages: existingImages.length > 0 ? existingImages : undefined,
        });

        if (image && image.length > 0) {
          generated++;
          // Update item metadata in place
          item.metadata = {
            ...item.metadata,
            images: image,
          };
          console.log(`AiImageEnricher: [${type}] ✅ Generated poster for ${itemId}`);
        } else {
          console.log(`AiImageEnricher: [${type}] ❌ No image returned for ${itemId}`);
        }
      } catch (error) {
        console.error(`AiImageEnricher: [${type}] Error for ${itemId}:`, error);
      }
    }

    console.log(`AiImageEnricher: Generated ${generated} posters across ${candidates.size} category types\n`);

    // Return all items (items with posters already have metadata updated in place)
    return contentItems;
  }
}