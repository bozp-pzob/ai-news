// src/plugins/enrichers/WebSearchEnricher.ts

import { extractFieldData } from "../../helpers/generalHelper";
import { EnricherPlugin, ContentItem, AiProvider } from "../../types";

/**
 * Configuration interface for WebSearchEnricher
 */
export interface WebSearchEnricherConfig {
  /** Array of field paths to extract data from (supports nested metadata fields like 'metadata.title') */
  sourceFields: string[];
  /** The metadata field name where search results will be saved */
  saveToField: string;
  /** AI provider for query generation*/
  provider: AiProvider;
  /** AI provider for search */
  searchProvider: AiProvider;
  /** Typescript for the AI Provider to generate as response from search */
  objectTypeString: string;
}

/**
 * Lightweight WebSearchEnricher that generates intelligent queries from multiple ContentItem fields
 * and performs searches using the AI provider's search function.
 */
export class WebSearchEnricher implements EnricherPlugin {
  private provider: AiProvider;
  private searchProvider: AiProvider;
  private queryCount: number = 1;
  private objectTypeString: string;
  private saveToField: string;
  private sourceFields: string[];

  static constructorInterface = {
    parameters: [
      {
        name: 'sourceFields',
        type: 'string[]',
        required: true,
        description: "Array of field paths to extract data from ContentItems (supports nested metadata fields like 'metadata.title')"
      },
      {
        name: 'saveToField',
        type: 'string',
        required: true,
        description: 'The metadata field name where search results will be saved'
      },
      {
        name: 'provider',
        type: 'AiProvider',
        required: true,
        description: 'AI provider for query generation'
      },
      {
        name: 'searchProvider',
        type: 'AiProvider',
        required: true,
        description: 'AI search provider for doing research'
      },
      {
        name: 'objectTypeString',
        type: 'string',
        required: true,
        description: 'Typescript for the AI Provider to generate as response'
      }
    ]
  };

  constructor(config: WebSearchEnricherConfig) {
    this.provider = config.provider;
    this.searchProvider = config.searchProvider;
    this.objectTypeString = config.objectTypeString;
    this.saveToField = config.saveToField;
    this.sourceFields = config.sourceFields;
  }

  /**
   * Enriches content items by generating queries and performing searches
   */
  public async enrich(contentItems: ContentItem[]): Promise<ContentItem[]> {
    const results = await Promise.all(
      contentItems.map(item => this.enrichItem(item))
    );
    return results;
  }

  /**
   * Enriches a single content item
   */
  private async enrichItem(contentItem: ContentItem): Promise<ContentItem> {
    try {
      // Extract data from specified fields
      const extractedData = extractFieldData(contentItem, this.sourceFields);
      
      if (Object.keys(extractedData).length === 0) {
        return contentItem;
      }

      // Generate search queries using AI
      const queries = await this.generateQueries(extractedData);
      
      if (queries.length === 0) {
        return contentItem;
      }

      // Perform searches
      const searchResults = await this.performSearches(queries);

      // Add results to metadata
      return {
        ...contentItem,
        metadata: {
          ...contentItem.metadata,
          [this.saveToField]: {
            sourceData: extractedData,
            queries,
            results: searchResults && searchResults.length > 0 ? searchResults[0] : undefined,
            timestamp: new Date().toISOString()
          }
        }
      };

    } catch (error) {
      console.error(`Error enriching item: ${error}`);
      return contentItem;
    }
  }

  /**
   * Generates search queries using AI based on extracted field data
   */
  private async generateQueries(data: Record<string, any>): Promise<string[]> {
    try {
      const dataText = Object.entries(data)
        .map(([field, value]) => `${field}: ${this.formatValue(value)}`)
        .join('\n');

      const prompt = `Generate ${this.queryCount} web search queries based on this data:

Generate ${dataText} related search queries that would help provide comprehensive information about this topic. The queries should:
1. Explore different aspects of the topic
2. Include current/recent perspectives
3. Cover practical applications or implications
4. Be specific and actionable

Return only the queries, one per line, without numbering or bullets.
      `.trim();

      const response = await this.provider.summarize(prompt);

      return response
        .split('\n')
        .map(q => q.trim())
        .filter(q => q.length > 0)
        .slice(0, this.queryCount!);

    } catch (error) {
      console.error(`Query generation error: ${error}`);
      return this.createFallbackQueries(data);
    }
  }

  /**
   * Formats values for the AI prompt
   */
  private formatValue(value: any): string {
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Performs searches using the AI provider's search function
   */
  private async performSearches(queries: string[]): Promise<any[]> {
    const results = [];

    for (const query of queries) {
      try {
        const queryPrompt = `Search for this query: ${query}

        Typescript Object: ${this.objectTypeString}
        
        Return the analysis in as ONLY a valid JSON format provided that follows the typescript object.`

        const searchResult = await this.searchProvider.search(queryPrompt);
        
        results.push(JSON.parse(searchResult.replace(/```json\n|```/g, "")));

      } catch (error:any) {
        console.error(`Search error for "${query}": ${error}`);
      }
    }

    return results;
  }

  /**
   * Creates simple fallback queries when AI generation fails
   */
  private createFallbackQueries(data: Record<string, any>): string[] {
    const values = Object.values(data)
      .map(v => this.formatValue(v))
      .filter(v => v.length > 2);

    return values.slice(0, this.queryCount!);
  }
}