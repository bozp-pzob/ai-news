// src/plugins/enrichers/WebSearchEnricher.ts

import { extractFieldData } from "../../helpers/generalHelper";
import { getPageHTML } from "../../helpers/patchrightHelper";
import { cleanHTML } from "../../helpers/promptHelper";
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
  /** Typescript for the AI Provider to generate as response*/
  objectTypeString: string;
}

/**
 * Lightweight WebPageEnricher that generates formatted data fields based on page content
 * and provided typescript object.
 */
export class WebPageEnricher implements EnricherPlugin {
  private provider: AiProvider;
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
        name: 'objectTypeString',
        type: 'string',
        required: true,
        description: 'Typescript for the AI Provider to generate as response'
      }
    ]
  };

  constructor(config: WebSearchEnricherConfig) {
    this.provider = config.provider;
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
      const pageItems : any[] = [];

      // Extract data from specified fields, should be a url
      const extractedData = extractFieldData(contentItem, this.sourceFields, true);
      
      if (Object.keys(extractedData).length === 0) {
        return contentItem;
      }

      for (const [key, value] of Object.entries(extractedData)) {
        const pageHtml = await getPageHTML(value);

        const cleanedHtml = cleanHTML(pageHtml);

        const prompt = this.formatStructuredPrompt(cleanedHtml, this.objectTypeString);
        const summary = await this.provider?.summarize(prompt)
        if (summary) {
          const item = JSON.parse(summary.replace(/```json\n|```/g, "")) as any;

          pageItems.push(item);
        }
      }

      return {
        ...contentItem,
        metadata: {
          ...contentItem.metadata,
          [this.saveToField]: pageItems,
        }
      };

    } catch (error) {
      console.error(`Error enriching item: ${error}`);
      return contentItem;
    }
  }

  private formatStructuredPrompt(transcript: string, objectTypeString: string, excludeTopics: string = ""): string {
    return `Analyze this HTML Page restructured as MD and provide a succinct analysis on the available data points:

Typescript Type:
${objectTypeString}

HTML Transcript:
${transcript}

##
IF there is important data points, that don't fit the structured typescript interface, add
a field under misc and store it in there. Exclude these topics: ${excludeTopics}

Return the analysis in as valid JSON format provided.`;
  }
}