// src/plugins/enrichers/AiImageEnricher.ts

import { EnricherPlugin, ContentItem, AiEnricherConfig, AiProvider } from "../../types";

export interface AiImageEnricherConfig extends AiEnricherConfig {}

/**
 * AiImageEnricher - Generates AI images (posters) for content items.
 *
 * Simple approach: try to generate 1 poster per item. If it fails, continue.
 */
export class AiImageEnricher implements EnricherPlugin {
  private provider: AiProvider;

  static constructorInterface = {
    parameters: [
      {
        name: 'provider',
        type: 'AiProvider',
        required: true,
        description: 'AI provider to use for image generation'
      }
    ]
  };

  constructor(config: AiImageEnricherConfig) {
    this.provider = config.provider;
  }

  /**
   * Simple approach: try to generate 1 poster per item.
   * Skip items that already have images or have no text.
   */
  public async enrich(contentItems: ContentItem[]): Promise<ContentItem[]> {
    const DEBUG = process.env.DEBUG_ENRICHERS === 'true';

    console.log(`\n=== AiImageEnricher ===`);
    console.log(`Input: ${contentItems.length} items`);

    let generated = 0;
    let skipped = 0;

    for (const item of contentItems) {
      const itemId = item.title?.substring(0, 40) || item.type || "unknown";

      // Skip if already has images
      if (item.metadata?.images?.length > 0) {
        skipped++;
        continue;
      }

      // Skip if no text
      if (!item.text) {
        skipped++;
        continue;
      }

      if (DEBUG) {
        console.log(`\n--- Processing: ${itemId} ---`);
        console.log(`Content (${item.text.length} chars):`);
        console.log(item.text);
      }

      console.log(`AiImageEnricher: [${itemId}] Generating poster (${item.text.length} chars)`);

      try {
        const image = await this.provider.image(item.text, {
          category: item.type || undefined,
        });

        if (image && image.length > 0) {
          generated++;
          item.metadata = {
            ...item.metadata,
            images: image,
          };
          console.log(`AiImageEnricher: [${itemId}] ✅ Generated poster`);
        } else {
          console.log(`AiImageEnricher: [${itemId}] ❌ No image returned`);
        }
      } catch (error) {
        console.error(`AiImageEnricher: [${itemId}] Error:`, error);
      }
    }

    console.log(`AiImageEnricher: Generated ${generated} posters, skipped ${skipped} items\n`);
    return contentItems;
  }
}
