// src/plugins/enrichers/AiTopicEnricher.ts

import { EnricherPlugin, ContentItem, AiEnricherConfig, AiProvider } from "../../types";

/**
 * AiImageEnricher class implements the EnricherPlugin interface to add AI-generated images
 * to content items. This enricher uses an AI provider to generate images based on the
 * content text and adds them to the item's metadata.
 */
export class AiImageEnricher implements EnricherPlugin {
  private provider: AiProvider;
  private maxTokens?: number;
  private thresholdLength?: number;

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
        name: 'thresholdLength',
        type: 'number',
        required: false,
        description: 'Minimum text length required for image generation (default: 300)'
      }
    ]
  };

  /**
   * Creates a new instance of AiImageEnricher.
   * @param config - Configuration object containing the AI provider and optional parameters
   */
  constructor(config: AiEnricherConfig) {
    this.provider = config.provider;
    this.maxTokens = config.maxTokens;
  }

  /**
   * Enriches content items by generating and adding AI-created images.
   * Only processes items that meet the length threshold and don't already have images.
   * @param contentItems - Array of content items to enrich
   * @returns Promise<ContentItem[]> Array of enriched content items
   */
  public async enrich(contentItems: ContentItem[]): Promise<ContentItem[]> {
    const enrichedContent: ContentItem[] = [];
    const thresholdLength = this.thresholdLength || 300;

    for (const contentItem of contentItems) {
      let images = contentItem?.metadata?.images || [];
      const itemId = contentItem?.title?.substring(0, 30) || contentItem?.type || "unknown";

      if (!contentItem || !contentItem.text) {
        console.log(`AiImageEnricher: [skip] ${itemId} - no text`);
        enrichedContent.push(contentItem);
        continue;
      }

      if (images.length > 0) {
        console.log(`AiImageEnricher: [skip] ${itemId} - already has ${images.length} image(s)`);
        enrichedContent.push(contentItem);
        continue;
      }

      if (contentItem.text.length < thresholdLength) {
        console.log(`AiImageEnricher: [skip] ${itemId} - text too short (${contentItem.text.length}/${thresholdLength})`);
        enrichedContent.push(contentItem);
        continue;
      }

      console.log(`AiImageEnricher: [generate] ${itemId} (${contentItem.text.length} chars)`);

      try {
        // Pass type as category for prompt template selection (matches promptTemplates keys)
        // e.g., "discordRawData" -> "discordrawdata", "githubIssue" -> "issue"
        const existingImages = contentItem.metadata?.images || [];
        const image = await this.provider.image(contentItem.text, {
          category: contentItem.type || undefined,
          referenceImages: existingImages.length > 0 ? existingImages : undefined,
        });

        if (image && image.length > 0) {
          console.log(`AiImageEnricher: [success] ${itemId} - generated ${image.length} image(s)`);
          enrichedContent.push({
            ...contentItem,
            metadata: {
              ...contentItem.metadata,
              images: image,
            }
          });
        } else {
          console.log(`AiImageEnricher: [failed] ${itemId} - no image returned`);
          enrichedContent.push(contentItem);
        }
      } catch (error) {
        console.error(`AiImageEnricher: [error] ${itemId} - ${error}`);
        enrichedContent.push(contentItem);
      }
    }

    return enrichedContent;
  }
}