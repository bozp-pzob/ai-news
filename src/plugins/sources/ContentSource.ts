import { ContentItem } from "../../types";

export interface ContentSource {
  name: string;  // e.g. "Twitter", "BBC RSS", "Discord"
  /**
   * Fetch items from this source.
   * Return an array of ContentItems, each describing an item in a unified format.
   */
  fetchItems(): Promise<ContentItem[]>;
  fetchHistorical?(date:string): Promise<ContentItem[]>;
  createToken?(): Promise<string>;
}