import { ContentItem } from "../../types";

export interface ContentParser {
  name: string;
  parseDetails(url: string, headers: any, title: string): Promise<ContentItem | undefined>;
}