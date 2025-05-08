/**
 * @fileoverview ApiSource implementation for fetching content from external APIs
 * This source type handles API-based content retrieval with authentication
 */

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import fetch from "node-fetch";

/**
 * Configuration interface for ApiSource
 * @interface ApiSourceConfig
 * @property {string} name - The name identifier for this API source
 * @property {string} endpoint - The API endpoint URL to fetch content from
 * @property {string} apiKey - The API key for authentication
 */
interface ApiSourceConfig {
  name: string;
  endpoint: string;
  apiKey: string;
}

/**
 * Expected response structure from the API
 * @interface ApiResponse
 * @property {Array<{title: string, url: string, publishedAt: string, content?: string, description?: string}>} articles - Array of articles from the API
 */
interface ApiResponse {
  articles: Array<{
    title: string;
    url: string;
    publishedAt: string;
    content?: string;
    description?: string;
  }>;
}

/**
 * ApiSource class that implements ContentSource interface for API-based content retrieval
 * Handles authentication and data fetching from external APIs
 * @implements {ContentSource}
 */
export class ApiSource implements ContentSource {
  /** Name identifier for this API source */
  public name: string;
  /** API endpoint URL */
  private endpoint: string;
  /** API authentication key */
  private apiKey: string;

  static constructorInterface = {
    parameters: [
      {
        name: 'name',
        type: 'string',
        required: true,
        description: 'Name of the API source'
      },
      {
        name: 'endpoint',
        type: 'string',
        required: true,
        description: 'API endpoint URL'
      },
      {
        name: 'apiKey',
        type: 'string',
        required: true,
        description: 'API key for authentication'
      }
    ]
  };

  /**
   * Creates a new ApiSource instance
   * @param {ApiSourceConfig} config - Configuration object for the API source
   */
  constructor(config: ApiSourceConfig) {
    this.name = config.name
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
  }

  /**
   * Fetches content items from the configured API endpoint
   * @returns {Promise<ContentItem[]>} Promise resolving to an array of content items
   * @throws {Error} If the API request fails
   */
  public async fetchItems(): Promise<ContentItem[]> {
    console.log(`Fetching data from API endpoint: ${this.endpoint}`);

    const url = `${this.endpoint}&apiKey=${this.apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    const jsonData = (await response.json()) as ApiResponse;
    
    const articles: ContentItem[] = []
    // jsonData.articles.map(item => ({
    //   source: this.name,
    //   title: item.title,
    //   link: item.url,
    //   date: item.publishedAt ? new Date(item.publishedAt) : null,
    //   content: item.content,
    //   description: item.description,
    // }));

    return articles;
  }
}