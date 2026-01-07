/**
 * Test script for OpenRouter image generation using real summary data
 * Loads imageConfig from the same config files as production.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/test-image-gen.ts [options] [json-file]
 *
 * Options:
 *   --config=<file>     Config file to load imageConfig from (default: config/elizaos.json)
 *   --provider=<name>   Name of AI provider with imageConfig (default: imageProvider)
 *   --ref=<path|url>    Add reference image (can use multiple times)
 *   --aspect=<ratio>    Override aspect ratio
 *   --size=<1K|2K|4K>   Override image size
 *   --category=<name>   Override category for all items
 *   --limit=<n>         Only process first n categories
 *
 * Examples:
 *   npx ts-node --transpile-only scripts/test-image-gen.ts
 *   npx ts-node --transpile-only scripts/test-image-gen.ts output/elizaos/json-cdn/2026-01-05.json
 *   npx ts-node --transpile-only scripts/test-image-gen.ts --config=config/elizaos.json --ref=./style/anime.png
 */

import "dotenv/config";
import { OpenAIProvider } from "../src/plugins/ai/OpenAIProvider";
import { ImageGenerationConfig } from "../src/types";
import fs from "fs";
import path from "path";

// Default paths
const DEFAULT_JSON = "output/elizaos/json-cdn/2026-01-01.json";
const DEFAULT_CONFIG = "config/elizaos.json";
const DEFAULT_PROVIDER = "imageProvider";

interface ConfigFile {
  ai: Array<{
    type: string;
    name: string;
    params: {
      apiKey: string;
      model?: string;
      useOpenRouter?: boolean;
      siteUrl?: string;
      siteName?: string;
      imageConfig?: ImageGenerationConfig;
    };
  }>;
}

// Parse CLI arguments
function parseArgs(): {
  jsonFile: string;
  configFile: string;
  providerName: string;
  referenceImages: string[];
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
  categoryOverride?: string;
  limit?: number;
} {
  const args = process.argv.slice(2);
  const referenceImages: string[] = [];
  let jsonFile = DEFAULT_JSON;
  let configFile = DEFAULT_CONFIG;
  let providerName = DEFAULT_PROVIDER;
  let aspectRatio: string | undefined;
  let imageSize: '1K' | '2K' | '4K' | undefined;
  let categoryOverride: string | undefined;
  let limit: number | undefined;

  for (const arg of args) {
    if (arg.startsWith("--config=")) {
      configFile = arg.slice(9);
    } else if (arg.startsWith("--provider=")) {
      providerName = arg.slice(11);
    } else if (arg.startsWith("--ref=")) {
      const refPath = arg.slice(6);
      // If it's a local file, read and convert to base64
      if (!refPath.startsWith("http") && !refPath.startsWith("data:")) {
        if (fs.existsSync(refPath)) {
          const ext = path.extname(refPath).slice(1).toLowerCase();
          const mimeType = ext === "jpg" ? "jpeg" : ext;
          const data = fs.readFileSync(refPath);
          referenceImages.push(`data:image/${mimeType};base64,${data.toString("base64")}`);
          console.log(`Loaded reference: ${refPath} (${(data.length / 1024).toFixed(1)} KB)`);
        } else {
          console.error(`Warning: Reference file not found: ${refPath}`);
        }
      } else {
        referenceImages.push(refPath);
        console.log(`Using reference URL: ${refPath.substring(0, 60)}...`);
      }
    } else if (arg.startsWith("--aspect=")) {
      aspectRatio = arg.slice(9);
    } else if (arg.startsWith("--size=")) {
      imageSize = arg.slice(7) as '1K' | '2K' | '4K';
    } else if (arg.startsWith("--category=")) {
      categoryOverride = arg.slice(11);
    } else if (arg.startsWith("--limit=")) {
      limit = parseInt(arg.slice(8), 10);
    } else if (!arg.startsWith("--")) {
      jsonFile = arg;
    }
  }

  return { jsonFile, configFile, providerName, referenceImages, aspectRatio, imageSize, categoryOverride, limit };
}

// Load imageConfig from config file
function loadImageConfig(configFile: string, providerName: string): {
  imageConfig: ImageGenerationConfig;
  providerParams: any;
} {
  if (!fs.existsSync(configFile)) {
    console.error(`Error: Config file not found: ${configFile}`);
    process.exit(1);
  }

  const configRaw = fs.readFileSync(configFile, "utf-8");
  // Handle process.env references in JSON
  const configText = configRaw.replace(/\"process\.env\.(\w+)\"/g, (_, key) => {
    return JSON.stringify(process.env[key] || "");
  });
  const config: ConfigFile = JSON.parse(configText);

  // Find the provider
  const providerConfig = config.ai.find(p => p.name === providerName);
  if (!providerConfig) {
    console.error(`Error: Provider '${providerName}' not found in config`);
    console.log(`Available providers: ${config.ai.map(p => p.name).join(", ")}`);
    process.exit(1);
  }

  if (!providerConfig.params.imageConfig) {
    console.error(`Error: Provider '${providerName}' has no imageConfig`);
    process.exit(1);
  }

  return {
    imageConfig: providerConfig.params.imageConfig,
    providerParams: providerConfig.params
  };
}

interface ContentSection {
  text: string;
  sources: string | string[];
  images: string[];
  videos: string[];
}

interface Category {
  title: string;
  content: ContentSection[];
  topic: string;
}

interface DailySummary {
  type: string;
  title: string;
  categories: Category[];
  date: number;
}

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, maxLen)
    .replace(/-+$/, '');
}

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().split('T')[0];
}

async function testImageGeneration() {
  console.log("=== Nano Banana Pro Image Generation Test ===\n");

  // Parse CLI arguments
  const {
    jsonFile,
    configFile,
    providerName,
    referenceImages: cliReferenceImages,
    aspectRatio: cliAspectRatio,
    imageSize: cliImageSize,
    categoryOverride,
    limit
  } = parseArgs();

  // Load config
  console.log(`Loading config: ${configFile}`);
  const { imageConfig, providerParams } = loadImageConfig(configFile, providerName);

  // Apply CLI overrides
  const aspectRatio = cliAspectRatio || imageConfig.aspectRatio || "16:9";
  const imageSize = cliImageSize || imageConfig.imageSize || "1K";

  if (!fs.existsSync(jsonFile)) {
    console.error(`Error: JSON file not found: ${jsonFile}`);
    console.log(`\nUsage: npx ts-node --transpile-only scripts/test-image-gen.ts [options] [json-file]`);
    console.log(`\nOptions:`);
    console.log(`  --config=<file>     Config file (default: config/elizaos.json)`);
    console.log(`  --provider=<name>   Provider name (default: imageProvider)`);
    console.log(`  --ref=<path|url>    Add reference image (can use multiple times)`);
    console.log(`  --aspect=<ratio>    Override aspect ratio`);
    console.log(`  --size=<1K|2K|4K>   Override image size`);
    console.log(`  --category=<name>   Override category for all items`);
    console.log(`  --limit=<n>         Only process first n categories`);
    process.exit(1);
  }

  console.log(`Provider: ${providerName}`);
  console.log(`Image Model: ${imageConfig.model}`);
  console.log(`Aspect Ratio: ${aspectRatio}`);
  console.log(`Image Size: ${imageSize}`);
  console.log(`Prompt Templates: ${Object.keys(imageConfig.promptTemplates || {}).length} categories`);
  if (cliReferenceImages.length > 0) {
    console.log(`CLI Reference Images: ${cliReferenceImages.length}`);
  }
  if (categoryOverride) {
    console.log(`Category Override: ${categoryOverride}`);
  }
  if (limit) {
    console.log(`Limit: ${limit} categories`);
  }

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("\nError: OPENAI_API_KEY environment variable not set");
    process.exit(1);
  }

  const useOpenRouter = providerParams.useOpenRouter !== false;
  if (!useOpenRouter) {
    console.error("\nError: Image generation requires OpenRouter (useOpenRouter: true)");
    process.exit(1);
  }

  // Load the JSON file
  console.log(`\nLoading: ${jsonFile}`);
  const data: DailySummary = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  const dateStr = formatDate(data.date);

  console.log(`Title: ${data.title}`);
  console.log(`Date: ${dateStr}`);
  console.log(`Categories: ${data.categories.length}`);

  // Create provider using loaded config
  const provider = new OpenAIProvider({
    name: "test-provider",
    apiKey: process.env.OPENAI_API_KEY,
    useOpenRouter: useOpenRouter,
    model: providerParams.model || "openai/gpt-4o-mini",
    siteUrl: providerParams.siteUrl,
    siteName: providerParams.siteName,
    imageConfig: imageConfig
  });

  console.log("\n" + "=".repeat(60) + "\n");

  // Create output directory
  const outputDir = `./output/test-images/${dateStr}`;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Test each category (with optional limit)
  const categoriesToProcess = limit ? data.categories.slice(0, limit) : data.categories;

  for (let i = 0; i < categoriesToProcess.length; i++) {
    const category = categoriesToProcess[i];
    const originalTopic = category.topic;
    const topic = categoryOverride || originalTopic;
    const title = category.title;

    console.log(`\n--- [${i}] Category: ${title} ---`);
    console.log(`Topic: ${originalTopic}${categoryOverride ? ` (using templates for: ${topic})` : ''}`);

    // Get first content item for testing
    const content = category.content[0];
    if (!content) {
      console.log("No content in this category, skipping.\n");
      continue;
    }

    console.log(`\nContent Text:\n${content.text}\n`);

    // Show which template pool will be used
    const templates = imageConfig.promptTemplates?.[topic] || imageConfig.defaultPrompts || [];
    console.log(`Template Pool (${templates.length} options):`);
    templates.forEach((t, i) => console.log(`  ${i + 1}. "${t}"`));
    console.log("");

    // Combine CLI reference images with content images
    const contentImages = content.images?.length > 0 ? content.images : [];
    const allReferenceImages = [...cliReferenceImages, ...contentImages];

    if (allReferenceImages.length > 0) {
      console.log(`Reference images: ${cliReferenceImages.length} from CLI + ${contentImages.length} from content = ${allReferenceImages.length} total`);
    }

    try {
      const startTime = Date.now();
      const result = await provider.image(content.text, {
        category: topic,
        referenceImages: allReferenceImages.length > 0 ? allReferenceImages : undefined,
        aspectRatio,
        imageSize
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.length > 0) {
        const imageData = result[0];

        if (imageData.startsWith("data:image/")) {
          // Base64 image - save to file
          const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
          if (matches) {
            const [, ext, base64Data] = matches;

            // Create filename: {topic}.{ext} - maps to category by topic name
            const filename = `${originalTopic}.${ext}`;
            const outputPath = path.join(outputDir, filename);

            fs.writeFileSync(outputPath, Buffer.from(base64Data, "base64"));
            const sizeKB = (base64Data.length * 0.75 / 1024).toFixed(1);

            console.log(`✅ Saved: ${outputPath}`);
            console.log(`   Size: ${sizeKB} KB | Time: ${elapsed}s`);
          }
        } else {
          // URL
          console.log(`✅ URL: ${imageData.substring(0, 80)}...`);
          console.log(`   Time: ${elapsed}s`);
        }
      } else {
        console.log(`❌ No image returned (${elapsed}s)`);
      }
    } catch (error) {
      console.error(`❌ Error: ${error}`);
    }

    // Rate limiting delay
    console.log("\nWaiting 2s before next request...");
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log("\n" + "=".repeat(60));
  console.log(`\n✅ Test complete! Images saved to: ${outputDir}\n`);
}

// Run
testImageGeneration().catch(console.error);
