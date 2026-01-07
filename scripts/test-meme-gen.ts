#!/usr/bin/env npx ts-node --transpile-only
/**
 * Test script for Imgflip meme generation
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/test-meme-gen.ts "Your text here"
 *   npx ts-node --transpile-only scripts/test-meme-gen.ts --file output/elizaos/json-cdn/2026-01-05.json
 *   npx ts-node --transpile-only scripts/test-meme-gen.ts --auto  # Uses sample content
 */

import "dotenv/config";
import { automeme, aiMeme, generateMeme } from "../src/helpers/imgflip";
import fs from "fs";

const SAMPLE_CONTENT = [
  "Shipped 10 new features but broke onboarding for 3 days",
  "Documentation says it's simple, took 4 hours to figure out",
  "Finally fixed the bug that's been open for 6 months",
  "Mass contributor shoutout - 47 PRs merged this week",
  "Twitter API rate limits hit again during peak hours",
];

async function main() {
  console.log("=== Imgflip Meme Generation Test ===\n");

  // Check credentials
  if (!process.env.IMGFLIP_USERNAME || !process.env.IMGFLIP_PASSWORD) {
    console.error("Error: IMGFLIP_USERNAME and IMGFLIP_PASSWORD must be set in .env");
    process.exit(1);
  }

  const args = process.argv.slice(2);

  let texts: string[] = [];

  if (args.includes("--auto")) {
    texts = SAMPLE_CONTENT;
    console.log("Using sample content for testing\n");
  } else if (args.includes("--file")) {
    const fileIdx = args.indexOf("--file");
    const filePath = args[fileIdx + 1];
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    // Extract text from categories
    if (data.categories) {
      texts = data.categories
        .flatMap((cat: any) => cat.content?.map((c: any) => c.text) || [])
        .filter((t: string) => t && t.length > 100)
        .slice(0, 3);
    }
    console.log(`Loaded ${texts.length} content items from ${filePath}\n`);
  } else if (args.length > 0 && !args[0].startsWith("--")) {
    texts = [args.join(" ")];
  } else {
    console.log("Usage:");
    console.log('  npx ts-node --transpile-only scripts/test-meme-gen.ts "Your text"');
    console.log("  npx ts-node --transpile-only scripts/test-meme-gen.ts --auto");
    console.log("  npx ts-node --transpile-only scripts/test-meme-gen.ts --file path/to/summary.json");
    process.exit(0);
  }

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    console.log(`\n--- Test ${i + 1}/${texts.length} ---`);
    console.log(`Input: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"\n`);

    try {
      // Test automeme directly with short text
      const shortText = text.slice(0, 60);
      console.log(`Testing automeme with: "${shortText}"`);

      const startTime = Date.now();
      const result = await automeme(shortText);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.success) {
        console.log(`✅ Success (${elapsed}s)`);
        console.log(`   URL: ${result.url}`);
        console.log(`   Template: ${result.templateName || "auto-selected"}`);
      } else {
        console.log(`❌ Failed: ${result.error}`);

        // Try ai_meme as fallback
        console.log("\nTrying ai_meme fallback...");
        const fallbackResult = await aiMeme({ prefixText: shortText.slice(0, 64) });
        if (fallbackResult.success) {
          console.log(`✅ Fallback success`);
          console.log(`   URL: ${fallbackResult.url}`);
          console.log(`   Template: ${fallbackResult.templateName}`);
        } else {
          console.log(`❌ Fallback also failed: ${fallbackResult.error}`);
        }
      }
    } catch (error) {
      console.error(`❌ Error: ${error}`);
    }

    // Rate limit delay
    if (i < texts.length - 1) {
      console.log("\nWaiting 2s...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("\n=== Test Complete ===\n");
}

main().catch(console.error);
