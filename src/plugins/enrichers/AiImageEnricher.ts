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

      if (!contentItem || !contentItem.text || images.length > 0) {
        enrichedContent.push(contentItem);
        continue;
      }

      if (contentItem.text.length < thresholdLength) {
        enrichedContent.push(contentItem);
        continue;
      }

      try {
        // Pass source as category for prompt template selection
        // Existing images in metadata can be used as references
        const existingImages = contentItem.metadata?.images || [];
        const image = await this.provider.image(contentItem.text, {
          category: contentItem.source || undefined,
          referenceImages: existingImages.length > 0 ? existingImages : undefined,
        });

        enrichedContent.push({
          ...contentItem,
          metadata: {
            ...contentItem.metadata,
            images: image,
          }
        });
      } catch (error) {
        console.error("Error generating image: ", error);
        enrichedContent.push(contentItem);
      }
    }

    return enrichedContent;
  }
}