// src/plugins/sources/ApiSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import fetch from "node-fetch";

interface ApiSourceConfig {
  name: string;
  endpoint: string;
  apiKey: string;
}

interface ApiResponse {
  articles: Array<{
    title: string;
    url: string;
    publishedAt: string;
    content?: string;
    description?: string;
  }>;
}

export class ApiSource implements ContentSource {
  public name: string;
  private endpoint: string;
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

  constructor(config: ApiSourceConfig) {
    this.name = config.name
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
  }

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