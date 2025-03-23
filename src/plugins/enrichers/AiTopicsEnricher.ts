// src/plugins/enrichers/AiTopicEnricher.ts

import { EnricherPlugin, ContentItem, AiEnricherConfig, AiProvider } from "../../types";

export class AiTopicsEnricher implements EnricherPlugin {
  private provider: AiProvider;
  private maxTokens?: number;
  private thresholdLength?: number;

  static constructorInterface = {
    parameters: [
      {
        name: 'provider',
        type: 'AiProvider',
        required: true,
        description: 'AI provider to use for topic extraction'
      },
      {
        name: 'maxTokens',
        type: 'number',
        required: false,
        description: 'Maximum number of tokens to use for topic extraction'
      },
      {
        name: 'thresholdLength',
        type: 'number',
        required: false,
        description: 'Minimum text length required for topic extraction (default: 300)'
      }
    ]
  };

  constructor(config: AiEnricherConfig) {
    this.provider = config.provider;
    this.maxTokens = config.maxTokens;
    this.thresholdLength = config.thresholdLength ?? 300; 
  }

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