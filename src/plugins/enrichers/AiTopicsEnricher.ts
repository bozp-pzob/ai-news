// src/plugins/enrichers/AiTopicEnricher.ts

import { EnricherPlugin, ContentItem, AiEnricherConfig, AiProvider } from "../../types";

/**
 * AiTopicsEnricher class implements the EnricherPlugin interface to add AI-generated topics
 * to content items. This enricher uses an AI provider to extract relevant topics from the
 * content text and adds them to the item's metadata.
 */
export class AiTopicsEnricher implements EnricherPlugin {
  private provider: AiProvider;
  private maxTokens?: number;
  private thresholdLength?: number;

  /**
   * Creates a new instance of AiTopicsEnricher.
   * @param config - Configuration object containing the AI provider and optional parameters
   */
  constructor(config: AiEnricherConfig) {
    this.provider = config.provider;
    this.maxTokens = config.maxTokens;
    this.thresholdLength = config.thresholdLength ?? 300; 
  }

  /**
   * Enriches content items by generating and adding AI-extracted topics.
   * Only processes items that meet the length threshold.
   * @param contentItems - Array of content items to enrich
   * @returns Promise<ContentItem[]> Array of enriched content items with topics
   */
  public async enrich(contentItems: ContentItem[]): Promise<ContentItem[]> {
    const enrichedContent: ContentItem[] = [];
    const thresholdLength = this.thresholdLength || 300;

    for (const contentItem of contentItems) {
      if (!contentItem || !contentItem.text) {
        enrichedContent.push(contentItem);
        continue;
      }

      if (contentItem.text.length < thresholdLength) {
        enrichedContent.push(contentItem);
        continue;
      }

      try {
        const topics = await this.provider.topics(contentItem.text);
        
        enrichedContent.push({
          ...contentItem,
          topics,
        });
      } catch (error) {
        console.error("Error creating topics: ", error);
        enrichedContent.push(contentItem);
      }
    }

    return enrichedContent;
  }
}