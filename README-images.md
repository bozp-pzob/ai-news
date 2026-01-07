# AI Image Generation System

## Overview

This document describes the AI-powered image generation system integrated into the ai-news aggregator. The system uses **OpenRouter** with **Google Gemini 3 Pro** (codenamed "Nano Banana Pro") to generate contextual images for daily summaries.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Image Generation Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Content Text ──► generateImagePrompt() ──► OpenRouter API       │
│       │                    │                      │              │
│       │           ┌────────┴────────┐             │              │
│       │           │ Template System │             ▼              │
│       │           │  - Category     │      Gemini 3 Pro          │
│       │           │  - Random pick  │      (image gen)           │
│       │           │  - AI summary   │             │              │
│       │           └─────────────────┘             ▼              │
│       │                                    Base64 Image          │
│       │                                          │              │
│       ▼                                          ▼              │
│  Reference Images ─────────────────────► [Optional CDN Upload]   │
│  (style transfer)                               │              │
│                                                  ▼              │
│                                           Final URL/Base64       │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Type Definitions (`src/types.ts`)

```typescript
// Configuration stored in config JSON files
interface ImageGenerationConfig {
  model?: string;                              // Default: google/gemini-3-pro-image-preview
  promptTemplates?: Record<string, string[]>;  // Category -> prompt array (random rotation)
  defaultPrompts?: string[];                   // Fallback prompts if no category match
  aspectRatio?: string;                        // e.g., "16:9", "1:1", "9:16", "21:9"
  imageSize?: '1K' | '2K' | '4K';              // Output resolution
  uploadToCDN?: boolean;                       // Upload to Bunny CDN
  cdnPath?: string;                            // CDN path prefix
}

// Per-request options (can override config)
interface ImageGenerationOptions {
  category?: string;                           // For template selection
  referenceImages?: string[];                  // URLs or base64 data URLs
  aspectRatio?: string;                        // Override aspect ratio
  imageSize?: '1K' | '2K' | '4K';              // Override size
}

// Provider interface
interface AiProvider {
  summarize(text: string): Promise<string>;
  topics(text: string): Promise<string[]>;
  image(text: string, options?: ImageGenerationOptions): Promise<string[]>;
}
```

### 2. OpenAIProvider (`src/plugins/ai/OpenAIProvider.ts`)

The main implementation that:
- Connects to OpenRouter API (not direct OpenAI)
- Uses `google/gemini-3-pro-image-preview` for image generation
- Implements prompt engineering with category-based templates
- Supports multi-image input for style transfer
- Handles base64 response extraction and optional CDN upload

**Key methods:**
- `image(text, options)` - Main entry point
- `generateImagePrompt(text, category)` - Template selection + AI summarization

### 3. AiImageEnricher (`src/plugins/enrichers/AiImageEnricher.ts`)

Enricher plugin that:
- Processes content items that lack images
- Passes content source as category for template selection
- Uses existing images in metadata as reference images
- Only processes items above threshold length (default: 300 chars)

### 4. CDN Uploader (`src/helpers/cdnUploader.ts`)

Added `uploadBase64ImageToCDN()` function to:
- Parse base64 data URLs
- Write to temp file
- Upload via existing Bunny CDN integration
- Clean up temp files

### 5. Test Script (`scripts/test-image-gen.ts`)

Standalone test script that:
- Loads config from JSON files (same as production)
- Processes real daily summary JSON files
- Supports CLI arguments for testing variations
- Saves generated images to `output/test-images/`

```bash
# Basic usage
npx ts-node --transpile-only scripts/test-image-gen.ts

# With specific JSON file
npx ts-node --transpile-only scripts/test-image-gen.ts output/elizaos/json-cdn/2026-01-01.json

# With options
npx ts-node --transpile-only scripts/test-image-gen.ts \
  --config=config/elizaos.json \
  --provider=imageProvider \
  --ref=./style/anime.png \
  --aspect=1:1 \
  --size=2K \
  --category=discordrawdata \
  --limit=2
```

---

## Configuration

### Config File Structure (`config/elizaos.json`)

```json
{
  "ai": [
    {
      "type": "OpenAIProvider",
      "name": "imageProvider",
      "params": {
        "apiKey": "process.env.OPENAI_API_KEY",
        "model": "openai/gpt-4o-mini",
        "useOpenRouter": true,
        "siteUrl": "process.env.SITE_URL",
        "siteName": "process.env.SITE_NAME",
        "imageConfig": {
          "model": "google/gemini-3-pro-image-preview",
          "aspectRatio": "16:9",
          "imageSize": "1K",
          "uploadToCDN": false,
          "cdnPath": "generated-images",
          "defaultPrompts": ["..."],
          "promptTemplates": {
            "discordrawdata": ["..."],
            "issue": ["..."],
            "pull_request": ["..."],
            "github_summary": ["..."],
            "contributors": ["..."],
            "completed_items": ["..."]
          }
        }
      }
    }
  ]
}
```

### Daily Report Categories

The daily summary JSON has these category topics that map to prompt templates:

| Topic | Content Type | Visual Style |
|-------|--------------|--------------|
| `discordrawdata` | Discord channel summaries | Community gathering, warm colors, Discord blurple |
| `issue` | GitHub issues | Floating cards, checkboxes, dark theme |
| `pull_request` | Pull requests | Merging streams, branch lines, technical |
| `github_summary` | Overall GitHub activity | Contribution graphs, cityscapes, data-viz |
| `contributors` | Top contributors | Celebratory, group photo, golden highlights |
| `completed_items` | Completed work | Checkmarks, progress bars, success green |

---

## OpenRouter API Details

### Endpoint
```
POST https://openrouter.ai/api/v1/chat/completions
```

### Request Format
```typescript
{
  model: "google/gemini-3-pro-image-preview",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "prompt here" },
      // Optional reference images:
      { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
      { type: "image_url", image_url: { url: "https://example.com/ref.jpg" } }
    ]
  }],
  modalities: ["image", "text"],
  image_config: {
    aspect_ratio: "16:9",  // Options: 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 9:21, 3:2, 2:3, auto
    image_size: "1K"       // Options: 1K (1024px), 2K (2048px), 4K (4096px)
  }
}
```

### Response Format
```typescript
{
  choices: [{
    message: {
      content: "text response",
      images: [{
        image_url: {
          url: "data:image/png;base64,iVBORw0KGgo..."
        }
      }]
    }
  }]
}
```

### Multi-Image Input (Reference Images)

The model accepts up to multiple reference images for:
- **Style transfer**: Match artistic style of reference
- **Composition**: Use layout/framing from reference
- **Identity preservation**: Maintain subject appearance (up to 5 subjects)
- **Image editing**: Modify existing images based on prompt

---

## Challenges Encountered

### 1. DALL-E Deprecation
**Problem**: Original implementation used DALL-E 3 via direct OpenAI API.
**Solution**: Removed DALL-E support entirely, switched to OpenRouter with Gemini.

### 2. Prompt Quality
**Problem**: Raw content text produced generic/uninteresting images.
**Solution**: Implemented two-stage prompt engineering:
1. AI summarizes content into 1-2 visual sentences
2. Summary inserted into category-specific template with artistic direction

### 3. Configuration Divergence
**Problem**: Test script had hardcoded prompts separate from production config.
**Solution**: Refactored test script to load `imageConfig` from JSON config files.

### 4. Reference Image Format
**Problem**: Local files needed conversion for API.
**Solution**: Test script auto-converts local paths to base64 data URLs.

### 5. Response Extraction
**Problem**: OpenRouter returns images in non-standard location.
**Solution**: Extract from `message.images[].image_url.url` instead of standard content.

---

## Progress Made

### Completed
- [x] Added `ImageGenerationConfig` and `ImageGenerationOptions` types
- [x] Updated `AiProvider` interface with new `image()` signature
- [x] Implemented OpenRouter/Gemini image generation in `OpenAIProvider`
- [x] Added `generateImagePrompt()` with template system
- [x] Added `uploadBase64ImageToCDN()` helper function
- [x] Updated `AiImageEnricher` to pass category and reference images
- [x] Created `imageProvider` config in `config/elizaos.json`
- [x] Created comprehensive prompt templates for all 6 categories
- [x] Built test script with CLI arguments
- [x] Removed deprecated DALL-E support
- [x] Consolidated config to prevent divergence

### Not Yet Tested in Production
- [ ] Full pipeline run with image generation enabled
- [ ] CDN upload flow (`uploadToCDN: true`)
- [ ] Reference image style transfer with real content images

---

## Files Modified

| File | Changes |
|------|---------|
| `src/types.ts` | Added `ImageGenerationConfig`, `ImageGenerationOptions`, updated `AiProvider` |
| `src/plugins/ai/OpenAIProvider.ts` | New `image()` implementation, prompt engineering, removed DALL-E |
| `src/plugins/enrichers/AiImageEnricher.ts` | Pass category and reference images |
| `src/helpers/cdnUploader.ts` | Added `uploadBase64ImageToCDN()` |
| `config/elizaos.json` | Added `imageProvider` with full `imageConfig` |
| `scripts/test-image-gen.ts` | New test script (loads from config) |

---

## Next Steps / TODO

### Immediate
1. **Test the system**: Run test script against real data
   ```bash
   npx ts-node --transpile-only scripts/test-image-gen.ts --limit=1
   ```

2. **Review generated images**: Check if prompts produce good visuals

3. **Tune prompt templates**: Adjust wording based on results

### Future Enhancements
- [ ] Add prompt templates for other content types (Twitter, RSS, etc.)
- [ ] Implement image caching to avoid regenerating same content
- [ ] Add retry logic for failed generations
- [ ] Support multiple images per category (carousel)
- [ ] Add image quality/style parameters to config
- [ ] Frontend integration to display generated images

### Frontend Integration Ideas
- Display hero image at top of daily summary
- Category-specific images as section headers
- Thumbnail gallery in sidebar
- Image zoom/lightbox functionality

---

## Environment Requirements

```bash
# Required
OPENAI_API_KEY=sk-or-...  # OpenRouter API key (not OpenAI)

# Optional (for CDN upload)
BUNNY_STORAGE_ZONE=your-zone
BUNNY_STORAGE_HOST=storage.bunnycdn.com
BUNNY_CDN_URL=https://your-zone.b-cdn.net
BUNNY_PASSWORD=your-password
```

---

## Quick Reference

### Generate test images
```bash
npx ts-node --transpile-only scripts/test-image-gen.ts --limit=2
```

### Check available categories
```bash
cat output/elizaos/json-cdn/2026-01-01.json | jq -r '.categories[].topic'
```

### Run with specific category only
```bash
npx ts-node --transpile-only scripts/test-image-gen.ts --category=github_summary --limit=1
```

### View prompt templates
```bash
cat config/elizaos.json | jq '.ai[] | select(.name=="imageProvider") | .params.imageConfig.promptTemplates'
```

---

## Session Handoff Notes

**Last worked on**: January 6, 2026

**State**: All code changes are complete and build successfully. Changes are NOT yet committed.

**To commit these changes**:
```bash
git add src/types.ts src/plugins/ai/OpenAIProvider.ts src/plugins/enrichers/AiImageEnricher.ts src/helpers/cdnUploader.ts config/elizaos.json scripts/test-image-gen.ts README-images.md
git commit -m "feat: add OpenRouter/Gemini image generation with prompt templates"
```

**To test immediately**:
```bash
npx ts-node --transpile-only scripts/test-image-gen.ts --limit=1
```

**Key design decisions**:
1. Single source of truth: All prompt templates live in `config/elizaos.json`
2. OpenRouter only: DALL-E support was removed as outdated
3. Category-based templates: Each content type gets visually distinct prompts
4. Random rotation: Multiple prompts per category, randomly selected for variety
