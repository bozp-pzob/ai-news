// src/plugins/enrichers/AiImageEnricher.ts

import { EnricherPlugin, ContentItem, AiEnricherConfig, AiProvider } from "../../types";
import { logger } from '../../helpers/cliHelper';

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

    logger.info(`=== AiImageEnricher ===`);
    logger.info(`Input: ${contentItems.length} items`);

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
        logger.info(`--- Processing: ${itemId} ---`);
        logger.info(`Content (${item.text.length} chars):`);
        logger.info(item.text);
      }

      logger.info(`AiImageEnricher: [${itemId}] Generating poster (${item.text.length} chars)`);

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
          logger.info(`AiImageEnricher: [${itemId}] Generated poster`);
        } else {
          logger.info(`AiImageEnricher: [${itemId}] No image returned`);
        }
      } catch (error) {
        logger.error(`AiImageEnricher: [${itemId}] Error`, error);
      }
    }

    logger.info(`AiImageEnricher: Generated ${generated} posters, skipped ${skipped} items`);
    return contentItems;
  }
}
