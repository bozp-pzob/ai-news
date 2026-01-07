/**
 * SummaryEnricher - Enriches generated JSON summaries with memes and posters.
 *
 * This runs AFTER generators produce summaries, enriching the category content
 * with contextually relevant memes and AI-generated images.
 *
 * Pipeline: Fetch → Store → Generate → Enrich (this) → CDN upload
 */

import fs from "fs";
import path from "path";
import { ContentItem, EnricherPlugin } from "../../types";

interface ContentMessage {
  text: string;
  sources: string[];
  images: string[];
  videos: string[];
  posters?: string[];
  memes?: Array<{ url: string; template?: string; summary?: string }>;
}

interface CategoryContent {
  title: string;
  topic?: string;
  content: ContentMessage[];
}

interface SummaryJson {
  type: string;
  title: string;
  date: number;
  categories: CategoryContent[];
}

export interface SummaryEnricherConfig {
  /** Enricher plugins (MemeEnricher, AiImageEnricher) */
  enrichers: EnricherPlugin[];
  /** Output directory for JSON files */
  outputPath: string;
}

export class SummaryEnricher {
  private enrichers: EnricherPlugin[];
  private outputPath: string;

  constructor(config: SummaryEnricherConfig) {
    this.enrichers = config.enrichers;
    this.outputPath = config.outputPath;
  }

  /**
   * Enrich a summary JSON file with memes and posters.
   *
   * @param dateStr - Date string (YYYY-MM-DD) for the summary
   * @param jsonSubpath - Subpath within outputPath (e.g., "elizaos/json")
   */
  public async enrichSummary(dateStr: string, jsonSubpath: string): Promise<void> {
    const jsonPath = path.join(this.outputPath, jsonSubpath, `${dateStr}.json`);

    if (!fs.existsSync(jsonPath)) {
      console.log(`SummaryEnricher: No JSON file found at ${jsonPath}`);
      return;
    }

    console.log(`\n=== SummaryEnricher ===`);
    console.log(`Enriching: ${jsonPath}`);

    try {
      const jsonContent = fs.readFileSync(jsonPath, "utf-8");
      const summary: SummaryJson = JSON.parse(jsonContent);

      if (!summary.categories || summary.categories.length === 0) {
        console.log(`SummaryEnricher: No categories in summary`);
        return;
      }

      let totalEnriched = 0;

      // Process each category
      for (const category of summary.categories) {
        if (!category.content || category.content.length === 0) continue;

        const categoryTopic = category.topic || category.title || "unknown";
        console.log(`SummaryEnricher: Processing category "${categoryTopic}" with ${category.content.length} content items`);

        // Process each content item in the category
        for (let i = 0; i < category.content.length; i++) {
          const contentItem = category.content[i];

          // Skip if already has memes and posters
          if (contentItem.memes?.length && contentItem.posters?.length) {
            continue;
          }

          // Skip if no text
          if (!contentItem.text || contentItem.text.trim().length === 0) {
            continue;
          }

          // Convert to ContentItem format for enrichers
          const fakeContentItem: ContentItem = {
            cid: `summary-${dateStr}-${categoryTopic}-${i}`,
            source: "summary",
            type: this.topicToSourceType(categoryTopic),
            title: category.title,
            text: contentItem.text,
            date: new Date(dateStr).getTime() / 1000,
            metadata: {
              images: contentItem.images || [],
              videos: contentItem.videos || [],
              memes: contentItem.memes || [],
            },
          };

          // Run enrichers
          let enrichedItems = [fakeContentItem];
          for (const enricher of this.enrichers) {
            enrichedItems = await enricher.enrich(enrichedItems);
          }

          const enriched = enrichedItems[0];

          // Extract generated media back to category content
          if (enriched.metadata?.memes?.length) {
            contentItem.memes = enriched.metadata.memes;
            totalEnriched++;
          }

          if (enriched.metadata?.images?.length) {
            // Add new AI-generated images as posters (don't replace existing images)
            const newPosters = enriched.metadata.images.filter(
              (img: string) => !contentItem.images?.includes(img)
            );
            if (newPosters.length > 0) {
              contentItem.posters = [...(contentItem.posters || []), ...newPosters];
              totalEnriched++;
            }
          }
        }
      }

      // Write updated JSON back
      fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
      console.log(`SummaryEnricher: Enriched ${totalEnriched} content items, saved to ${jsonPath}\n`);

    } catch (error) {
      console.error(`SummaryEnricher: Error enriching ${jsonPath}:`, error);
    }
  }

  /**
   * Map category topics back to source types for enricher compatibility.
   */
  private topicToSourceType(topic: string): string {
    const mapping: Record<string, string> = {
      discordrawdata: "discordRawData",
      discord: "discordRawData",
      issue: "githubIssue",
      issues: "githubIssue",
      pull_request: "githubPullRequest",
      pull_requests: "githubPullRequest",
      github_summary: "githubStatsSummary",
      contributors: "githubTopContributors",
      completed_items: "githubCompletedItem",
    };
    return mapping[topic.toLowerCase()] || topic;
  }
}
