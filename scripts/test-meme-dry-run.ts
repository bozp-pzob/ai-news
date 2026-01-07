#!/usr/bin/env npx ts-node --transpile-only
/**
 * Dry run meme pipeline - see what AI generates before hitting Imgflip
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/test-meme-dry-run.ts
 *   npx ts-node --transpile-only scripts/test-meme-dry-run.ts --generate  # Actually hit Imgflip
 */

import "dotenv/config";
import OpenAI from "openai";
import fs from "fs";
import { automeme, aiMeme } from "../src/helpers/imgflip";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODEL = "x-ai/grok-4.1-fast";
const OUTPUT_FILE = "output/meme-dry-run.md";

// Real content samples - mix of categories
const TEST_CONTENT = [
  {
    category: "issue",
    text: `Issue #1234: Fix memory leak in WebSocket handler (by wtfsayo, open 47 days). The WebSocket connection pool was not properly releasing connections on client disconnect, causing memory to balloon over time. After extensive debugging across 3 different approaches, finally traced it to a missing cleanup in the event listener.`,
  },
  {
    category: "pull_request",
    text: `PR #567: Refactor authentication flow (by parzival, open 23 days). Complete overhaul of the auth system from session-based to JWT. 47 files changed, 2,341 additions, 1,892 deletions. Breaking change requires migration script.`,
  },
  {
    category: "completed_items",
    text: `Shipped: Mass contributor shoutout system. 89 contributors recognized this week. New leaderboard shows top contributors by PR count, review count, and issue closures. Community response overwhelmingly positive.`,
  },
  {
    category: "github_summary",
    text: `Weekly GitHub Activity: 156 PRs merged, 47 issues closed, 23 new contributors. Major focus on stability - zero new features this week, all hands on bug fixes. Technical debt reduced by estimated 15%.`,
  },
  {
    category: "discord",
    text: `Hot discussion in #dev-chat: heated debate about whether to use Rust or TypeScript for the new plugin system. 200+ messages, no consensus reached. Shaw stepped in to break the tie: "ship it in whatever gets it done this week"`,
  },
  {
    category: "issue",
    text: `Issue #999: Users getting logged out randomly (by frustrated_dev, open 3 months). Intermittent session invalidation affecting ~5% of users. No consistent repro steps. 67 comments, 12 different theories proposed. Finally fixed by updating a 2-year-old dependency.`,
  },
];

// Simulated recent meme history to test avoidance
const FAKE_HISTORY = [
  "shipping features vs writing tests",
  "documentation exists / developers ignore it",
  "PR approved after mass changes",
];

async function generateMemeSummary(content: string, history: string[]): Promise<string> {
  const client = new OpenAI({
    baseURL: OPENROUTER_BASE,
    apiKey: process.env.OPENAI_API_KEY,
  });

  const avoidClause = history.length > 0
    ? `\n\nAvoid these angles:\n${history.map(h => `- ${h}`).join("\n")}`
    : "";

  const prompt = `What's the most absurd fact here? 3-8 words, deadpan. No cleverness, just state it.${avoidClause}

${content}`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 50,
  });

  return response.choices[0]?.message?.content?.trim() || "failed to generate";
}

async function main() {
  const shouldGenerate = process.argv.includes("--generate");
  const results: Array<{category: string, input: string, summary: string, words: number, url?: string, template?: string}> = [];

  console.log("=== MEME PIPELINE DRY RUN ===");
  console.log(`Model: ${MODEL}`);
  console.log(`Mode: ${shouldGenerate ? "LIVE (will hit Imgflip)" : "DRY RUN (summaries only)"}\n`);

  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY not set");
    process.exit(1);
  }

  if (shouldGenerate && (!process.env.IMGFLIP_USERNAME || !process.env.IMGFLIP_PASSWORD)) {
    console.error("Error: IMGFLIP credentials not set for --generate mode");
    process.exit(1);
  }

  console.log("Recent meme history (avoiding):");
  FAKE_HISTORY.forEach(h => console.log(`  - "${h}"`));
  console.log("\n" + "=".repeat(60) + "\n");

  for (let i = 0; i < TEST_CONTENT.length; i++) {
    const item = TEST_CONTENT[i];
    console.log(`[${i + 1}/${TEST_CONTENT.length}] Category: ${item.category}`);
    console.log(`Input: "${item.text.slice(0, 100)}..."\n`);

    try {
      const summary = await generateMemeSummary(item.text, FAKE_HISTORY);
      console.log(`>>> MEME SUMMARY: "${summary}"`);

      const wordCount = summary.split(/\s+/).length;
      console.log(`    Words: ${wordCount}`);

      const result: any = { category: item.category, input: item.text, summary, words: wordCount };

      if (shouldGenerate) {
        console.log(`    Generating meme...`);
        // Try automeme first, fall back to ai_meme
        let memeResult = await automeme(summary);
        if (!memeResult.success) {
          console.log(`    automeme failed, trying ai_meme...`);
          memeResult = await aiMeme({ prefixText: summary.slice(0, 64) });
        }
        if (memeResult.success) {
          console.log(`    ✅ ${memeResult.url}`);
          console.log(`    Template: ${memeResult.templateName || "auto"}`);
          result.url = memeResult.url;
          result.template = memeResult.templateName;
        } else {
          console.log(`    ❌ ${memeResult.error}`);
        }
      }

      results.push(result);

    } catch (err) {
      console.error(`    Error: ${err}`);
    }

    console.log("\n" + "-".repeat(60) + "\n");
    await new Promise(r => setTimeout(r, 1000));
  }

  // Write report
  const report = generateReport(results, shouldGenerate);
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, report);
  console.log(`\n📄 Report saved to: ${OUTPUT_FILE}`);
}

function generateReport(results: any[], generated: boolean): string {
  const timestamp = new Date().toISOString();
  let md = `# Meme Dry Run Report\n\n`;
  md += `**Model:** ${MODEL}\n`;
  md += `**Generated:** ${timestamp}\n`;
  md += `**Mode:** ${generated ? "Live (with Imgflip)" : "Dry run (summaries only)"}\n\n`;
  md += `## Results\n\n`;
  md += `| # | Category | Summary | Words | Verdict |\n`;
  md += `|---|----------|---------|-------|--------|\n`;

  results.forEach((r, i) => {
    md += `| ${i + 1} | ${r.category} | ${r.summary} | ${r.words} | |\n`;
  });

  md += `\n## Details\n\n`;
  results.forEach((r, i) => {
    md += `### ${i + 1}. ${r.category}\n\n`;
    md += `**Input:** ${r.input}...\n\n`;
    md += `**Summary:** ${r.summary}\n\n`;
    if (r.url) {
      md += `**Meme:** ![meme](${r.url})\n`;
      md += `**Template:** ${r.template || "auto"}\n\n`;
    }
    md += `---\n\n`;
  });

  md += `## Verdict Scale\n\n`;
  md += `- **dank**: ship it\n`;
  md += `- **mid**: needs work\n`;
  md += `- **cringe**: facebook tier\n`;
  md += `- **cursed**: somehow worse than expected\n`;

  return md;
}

main().catch(console.error);
