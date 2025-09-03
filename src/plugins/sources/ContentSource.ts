/**
 * @fileoverview Defines the base interface for all content sources in the application.
 * Content sources are responsible for fetching data from various platforms and services.
 */

import { ContentItem } from "../../types";

/**
 * Base interface for content sources that fetch data from various platforms
 * @interface ContentSource
 */
export interface ContentSource {
  /** Unique identifier for the content source (e.g., "Twitter", "BBC RSS", "Discord") */
  name: string;

  /**
   * Fetches content items from the source
   * @returns {Promise<ContentItem[]>} Array of content items in a unified format
   */
  fetchItems(): Promise<ContentItem[]>;

  /**
   * Optional method to fetch historical content from a specific date
   * @param {string} date - ISO date string to fetch historical content from
   * @returns {Promise<ContentItem[]>} Array of historical content items
   */
  fetchHistorical?(date:string): Promise<ContentItem[]>;
}