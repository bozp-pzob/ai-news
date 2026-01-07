/**
 * MemeEnricher - Generates contextual memes for content items using Imgflip API.
 *
 * Uses AI provider to create meme-worthy summaries, then Imgflip's automeme
 * for template selection and generation. Tracks recent memes to avoid repetition.
 */

import { EnricherPlugin, ContentItem, AiProvider } from "../../types";
import { generateMeme, MemeResult } from "../../helpers/imgflip";
import fs from "fs";
import path from "path";

const MEME_HISTORY_FILE = "data/meme-history.json";
const HISTORY_RETENTION_DAYS = 14;

interface MemeHistoryEntry {
  date: string;
  summary: string;
  template?: string;
}

function loadMemeHistory(): MemeHistoryEntry[] {
  try {
    if (fs.existsSync(MEME_HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEME_HISTORY_FILE, "utf-8"));
      const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      // Filter to recent entries only
      return data.filter((e: MemeHistoryEntry) => new Date(e.date).getTime() > cutoff);
    }
  } catch {
    // Ignore errors, return empty
  }
  return [];
}

function saveMemeHistory(history: MemeHistoryEntry[]): void {
  try {
    const dir = path.dirname(MEME_HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEME_HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error("MemeEnricher: Failed to save history:", err);
  }
}

export interface MemeEnricherConfig {
  provider: AiProvider;
  /** Categories to generate memes for (empty = all) */
  categories?: string[];
  /** Minimum text length to consider for meme generation */
  thresholdLength?: number;
  /** Maximum memes to generate per batch (rate limit awareness) */
  maxPerBatch?: number;
}

export class MemeEnricher implements EnricherPlugin {
  private provider: AiProvider;
  private categories: Set<string>;
  private thresholdLength: number;
  private maxPerBatch: number;
  private generated: number = 0;

  static constructorInterface = {
    parameters: [
      { name: "provider", type: "AiProvider", required: true, description: "AI provider for summarization" },
      { name: "categories", type: "string[]", required: false, description: "Categories to meme (empty = all)" },
      { name: "thresholdLength", type: "number", required: false, description: "Min text length (default: 200)" },
      { name: "maxPerBatch", type: "number", required: false, description: "Max memes per run (default: 3)" },
    ],
  };

  constructor(config: MemeEnricherConfig) {
    this.provider = config.provider;
    this.categories = new Set(config.categories || []);
    this.thresholdLength = config.thresholdLength || 200;
    this.maxPerBatch = config.maxPerBatch || 3;
  }

  private async createMemeSummary(text: string, recentMemes: MemeHistoryEntry[]): Promise<string> {
    const avoidList = recentMemes.slice(-10).map(m => `- ${m.summary}`).join("\n");
    const avoidClause = avoidList ? `\n\nAvoid these angles:\n${avoidList}` : "";

    const prompt = `What's the most absurd fact here? 3-8 words, deadpan. No cleverness, just state it.${avoidClause}

${text.slice(0, 1000)}`;

    try {
      const summary = await this.provider.summarize(prompt);
      return summary.trim().slice(0, 80);
    } catch {
      const firstSentence = text.split(/[.!?]/)[0];
      return firstSentence.slice(0, 80);
    }
  }

  /**
   * Check if an item meets basic criteria for meme generation (excluding rate limit).
   */
  private meetsBasicCriteria(item: ContentItem): boolean {
    // Skip if already has memes
    if (item.metadata?.memes?.length > 0) return false;

    // Skip if text too short
    if (!item.text || item.text.length < this.thresholdLength) return false;

    // Skip if category filter set and item doesn't match
    if (this.categories.size > 0 && item.type && !this.categories.has(item.type)) {
      return false;
    }

    return true;
  }

  /**
   * Two-pass approach: distribute memes across category types, not just first N items.
   * Pass 1: Group by type, find best candidate per type (least existing media)
   * Pass 2: Generate 1 meme per type (up to maxPerBatch types)
   */
  public async enrich(contentItems: ContentItem[]): Promise<ContentItem[]> {
    // Check if credentials are available
    if (!process.env.IMGFLIP_USERNAME || !process.env.IMGFLIP_PASSWORD) {
      console.log("MemeEnricher: Skipping - IMGFLIP credentials not set");
      return contentItems;
    }

    // Load recent meme history to avoid repetition
    const memeHistory = loadMemeHistory();
    const newEntries: MemeHistoryEntry[] = [];
    this.generated = 0;

    // === PASS 1: Group items by type and find best candidate per type ===
    const itemsByType = new Map<string, ContentItem[]>();
    for (const item of contentItems) {
      if (!this.meetsBasicCriteria(item)) continue;
      const type = item.type || "unknown";
      const list = itemsByType.get(type) || [];
      list.push(item);
      itemsByType.set(type, list);
    }

    // Select best candidate per type (prefer items with least existing media)
    const candidates = new Map<string, ContentItem>();
    for (const [type, items] of itemsByType) {
      items.sort((a, b) => {
        const aMedia = (a.metadata?.images?.length || 0) + (a.metadata?.videos?.length || 0);
        const bMedia = (b.metadata?.images?.length || 0) + (b.metadata?.videos?.length || 0);
        if (aMedia !== bMedia) return aMedia - bMedia; // least media first
        // Tie-breaker: longer text
        return (b.text?.length || 0) - (a.text?.length || 0);
      });
      candidates.set(type, items[0]);
    }

    console.log(`MemeEnricher: Found ${candidates.size} category types to cover: ${Array.from(candidates.keys()).join(", ")}`);

    // === PASS 2: Generate memes for candidates (1 per type) ===
    const itemsWithMemes = new Set<ContentItem>();
    for (const [type, item] of candidates) {
      if (this.generated >= this.maxPerBatch) {
        console.log(`MemeEnricher: Hit batch limit (${this.maxPerBatch}), stopping`);
        break;
      }

      try {
        const memeSummary = await this.createMemeSummary(item.text!, [...memeHistory, ...newEntries]);
        console.log(`MemeEnricher: [${type}] Generating meme for "${memeSummary}"`);

        const result: MemeResult = await generateMeme(memeSummary);

        if (result.success && result.url) {
          this.generated++;

          // Track for history
          newEntries.push({
            date: new Date().toISOString(),
            summary: memeSummary,
            template: result.templateName,
          });

          // Mark this item as having a meme
          item.metadata = {
            ...item.metadata,
            memes: [
              {
                url: result.url,
                template: result.templateName,
                summary: memeSummary,
              },
            ],
          };
          itemsWithMemes.add(item);
          console.log(`MemeEnricher: [${type}] Generated meme using "${result.templateName}"`);
        } else {
          console.log(`MemeEnricher: [${type}] Failed - ${result.error}`);
        }
      } catch (error) {
        console.error(`MemeEnricher: [${type}] Error:`, error);
      }
    }

    // Save updated history
    if (newEntries.length > 0) {
      saveMemeHistory([...memeHistory, ...newEntries]);
    }

    console.log(`MemeEnricher: Generated ${this.generated} memes across ${candidates.size} category types`);

    // Return all items (items with memes already have metadata updated in place)
    return contentItems;
  }
}
