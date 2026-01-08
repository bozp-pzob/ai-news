/**
 * MemeEnricher - Generates contextual memes for content items using Imgflip API.
 *
 * Simple approach: try to generate 1 meme per item. If it fails, continue.
 * Tracks recent memes to avoid repetition.
 */

import { EnricherPlugin, ContentItem, AiProvider } from "../../types";
import { generateMeme, MemeResult } from "../../helpers/imgflip";
import { downloadAndUploadToCDN, getDefaultCDNConfig } from "../../helpers/cdnUploader";
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
}

export class MemeEnricher implements EnricherPlugin {
  private provider: AiProvider;

  static constructorInterface = {
    parameters: [
      { name: "provider", type: "AiProvider", required: true, description: "AI provider for summarization" },
    ],
  };

  constructor(config: MemeEnricherConfig) {
    this.provider = config.provider;
  }

  private async createMemeSummary(text: string, recentMemes: MemeHistoryEntry[]): Promise<string> {
    const DEBUG = process.env.DEBUG_ENRICHERS === 'true';
    const avoidList = recentMemes.slice(-10).map(m => `- ${m.summary}`).join("\n");
    const avoidClause = avoidList ? `\n\nAvoid these angles:\n${avoidList}` : "";

    const prompt = `What's the most absurd fact here? 3-8 words, deadpan. No cleverness, just state it.${avoidClause}

${text.slice(0, 1000)}`;

    if (DEBUG) {
      console.log(`\nMeme Summary Prompt:`);
      console.log(prompt);
    }

    try {
      const summary = await this.provider.summarize(prompt);
      return summary.trim().slice(0, 80);
    } catch {
      const firstSentence = text.split(/[.!?]/)[0];
      return firstSentence.slice(0, 80);
    }
  }

  /**
   * Simple approach: try to generate 1 meme per item.
   * Skip items that already have memes or have no text.
   */
  public async enrich(contentItems: ContentItem[]): Promise<ContentItem[]> {
    const DEBUG = process.env.DEBUG_ENRICHERS === 'true';

    console.log(`\n=== MemeEnricher ===`);
    console.log(`Input: ${contentItems.length} items`);

    // Check if credentials are available
    if (!process.env.IMGFLIP_USERNAME || !process.env.IMGFLIP_PASSWORD) {
      console.log("MemeEnricher: Skipping - IMGFLIP credentials not set");
      return contentItems;
    }

    const memeHistory = loadMemeHistory();
    const newEntries: MemeHistoryEntry[] = [];
    let generated = 0;
    let skipped = 0;

    for (const item of contentItems) {
      const itemId = item.title?.substring(0, 40) || item.type || "unknown";

      // Skip if already has memes
      if (item.metadata?.memes?.length > 0) {
        skipped++;
        continue;
      }

      // Skip if no text
      if (!item.text) {
        skipped++;
        continue;
      }

      if (DEBUG) {
        console.log(`\n--- Processing: ${itemId} ---`);
        console.log(`Content (${item.text.length} chars):`);
        console.log(item.text);
      }

      try {
        const memeSummary = await this.createMemeSummary(item.text, [...memeHistory, ...newEntries]);
        console.log(`MemeEnricher: [${itemId}] Summary: "${memeSummary}"`);

        const result: MemeResult = await generateMeme(memeSummary);

        if (result.success && result.url) {
          // Upload to CDN immediately (CDN-first approach)
          let finalUrl = result.url;
          const cdnConfig = getDefaultCDNConfig();

          if (cdnConfig.storageZone && cdnConfig.password) {
            console.log(`MemeEnricher: [${itemId}] Uploading to CDN...`);
            const cdnResult = await downloadAndUploadToCDN(result.url, "imgflip", cdnConfig);

            if (cdnResult.success && cdnResult.cdnUrl) {
              finalUrl = cdnResult.cdnUrl;
              console.log(`MemeEnricher: [${itemId}] ✅ Mirrored to CDN: ${finalUrl}`);
            } else {
              console.log(`MemeEnricher: [${itemId}] ⚠️ CDN upload failed, keeping Imgflip URL: ${cdnResult.message}`);
            }
          }

          generated++;
          newEntries.push({
            date: new Date().toISOString(),
            summary: memeSummary,
            template: result.templateName,
          });

          item.metadata = {
            ...item.metadata,
            memes: [{
              url: finalUrl,
              template: result.templateName,
              summary: memeSummary,
            }],
          };
          const templateInfo = result.templateName ? ` using "${result.templateName}"` : '';
          console.log(`MemeEnricher: [${itemId}] ✅ Generated meme${templateInfo}`);
          console.log(`  URL: ${finalUrl}`);
        } else {
          console.log(`MemeEnricher: [${itemId}] ❌ Failed - ${result.error}`);
        }
      } catch (error) {
        console.error(`MemeEnricher: [${itemId}] Error:`, error);
      }
    }

    if (newEntries.length > 0) {
      saveMemeHistory([...memeHistory, ...newEntries]);
    }

    console.log(`MemeEnricher: Generated ${generated} memes, skipped ${skipped} items\n`);
    return contentItems;
  }
}
