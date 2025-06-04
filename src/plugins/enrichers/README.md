# Enricher Plugins (`src/plugins/enrichers/`)

Enricher plugins are designed to process and augment `ContentItem`s after they have been fetched by a source plugin but before they are stored or used by generator plugins. They modify the `ContentItem`s by adding new information, metadata, or transforming existing content.

All Enricher plugins must implement the `EnricherPlugin` interface defined in `src/types.ts`, which requires an `enrich(articles: ContentItem[]): ContentItem[] | Promise<ContentItem[]>` method.

## Key Files

### `AiImageEnricher.ts`

**Functionality:**

*   Implements the `EnricherPlugin` interface.
*   Uses an injected `AiProvider` to generate images based on the text content of `ContentItem`s.
*   Typically configured with an `AiEnricherConfig` which specifies the `provider`, an optional `maxTokens` (though not directly used for image prompt generation in the current implementation), and a `thresholdLength`.
*   It processes each `ContentItem`: if the `text` field is present and its length exceeds the `thresholdLength` (default 300 characters), it calls the `aiProvider.image(contentItem.text)` method.
*   The URL(s) of the generated image(s) returned by the provider are then added to the `ContentItem.metadata.photos` array. If `photos` doesn't exist, it's created. If it exists, new images are appended.
*   If image generation fails or the conditions are not met, the original `ContentItem` is returned unmodified.

**Data Flow:**

1.  **Input:** Receives an array of `ContentItem`s from the aggregator (`ContentAggregator` or `HistoricalAggregator`) after they have been fetched by a source and deduplicated.
2.  **Processing (per item):**
    *   Checks if `contentItem.text` exists and meets `thresholdLength`.
    *   If so, calls `this.provider.image(contentItem.text)` (where `provider` is an instance of `AiProvider`).
    *   The `AiProvider` (e.g., `OpenAIProvider`) communicates with an external AI image generation service.
    *   The AI provider returns an array of image URLs.
3.  **Output:** Returns a new array of `ContentItem`s. Items that were processed successfully will have their `metadata.photos` field updated with the new image URLs.

**Dependencies:**

*   Requires an `AiProvider` instance to be injected (configured via JSON).
*   Uses `ContentItem`, `EnricherPlugin`, `AiEnricherConfig` interfaces from `src/types.ts`.

### `AiTopicsEnricher.ts`

**Functionality:**

*   Implements the `EnricherPlugin` interface.
*   Uses an injected `AiProvider` to extract relevant topic keywords from the text content of `ContentItem`s.
*   Configured with an `AiEnricherConfig` specifying the `provider`, optional `maxTokens` (not directly used in current topic extraction logic), and `thresholdLength`.
*   Processes each `ContentItem`: if `contentItem.text` exists and its length is greater than `thresholdLength` (default 300), it calls `this.provider.topics(contentItem.text)`.
*   The array of topic strings returned by the AI provider is then assigned to the `contentItem.topics` field.
*   If topic extraction fails or conditions aren't met, the original `ContentItem` is returned.

**Data Flow:**

1.  **Input:** Receives an array of `ContentItem`s from the aggregator.
2.  **Processing (per item):**
    *   Checks if `contentItem.text` exists and meets `thresholdLength`.
    *   If so, calls `this.provider.topics(contentItem.text)`.
    *   The `AiProvider` (e.g., `OpenAIProvider`) communicates with an external AI service to perform topic modeling/extraction.
    *   The AI provider returns an array of topic strings.
3.  **Output:** Returns a new array of `ContentItem`s. Processed items will have their `topics` field populated with the extracted topics.

**Dependencies:**

*   Requires an `AiProvider` instance.
*   Uses `ContentItem`, `EnricherPlugin`, `AiEnricherConfig` interfaces from `src/types.ts`. 