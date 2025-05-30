---
title: Enricher Plugins
sidebar_label: Enrichers
---

Enricher plugins are components that process and augment `ContentItem`s after they have been fetched by a source plugin but typically before they are saved to storage or used by generator plugins. Their primary role is to add value, metadata, or insights to the raw content.

## Key Responsibilities

-   **Content Augmentation:** Modify `ContentItem` objects by adding new information (e.g., topics, sentiment scores, image URLs) or transforming existing fields.
-   **AI Integration (Optional):** Many enrichers leverage an `AiProvider` plugin to perform tasks like topic extraction, sentiment analysis, or image generation based on the content's text.
-   **Conditional Processing:** Enrichers may apply their logic conditionally, for example, only processing items that exceed a certain text length or match a specific type.

## Interface

All enricher plugins implement the `EnricherPlugin` interface defined in `src/types.ts`. The core method is:

-   `enrich(articles: ContentItem[]): ContentItem[] | Promise<ContentItem[]>`: Takes an array of `ContentItem`s and returns an array of (potentially modified) `ContentItem`s.

## Available Enricher Plugins

-   **`AiImageEnricher.ts`**:
    *   Uses an AI provider to generate images based on the text of `ContentItem`s.
    *   Adds the URLs of generated images to the `ContentItem.metadata.photos` array.
    *   Typically configured with an `AiEnricherConfig` (specifying the AI provider, and a `thresholdLength` for text).

-   **`AiTopicsEnricher.ts`**:
    *   Uses an AI provider to extract relevant topic keywords from the text of `ContentItem`s.
    *   Assigns the array of topic strings to the `ContentItem.topics` field.
    *   Also configured with `AiEnricherConfig`.

For detailed information on these enrichers, including their specific configuration and data flow, please examine their source code and associated READMEs in the `src/plugins/enrichers/` directory of the project repository.

*(Additional enricher plugins could be developed for tasks like sentiment analysis, named entity recognition, language detection, etc.)* 