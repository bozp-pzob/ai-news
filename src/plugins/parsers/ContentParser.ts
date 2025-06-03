import { ContentItem } from "../../types";

export interface ContentParser {
  name: string;
  parseDetails(url: string, title: string, type: string, objectString: string, excludeTopics: string): Promise<ContentItem | undefined>;
}