---
title: AI Provider Plugins
sidebar_label: AI Providers
---

AI Provider plugins serve as an abstraction layer for interacting with various Artificial Intelligence (AI) model APIs. They provide a standardized interface (`AiProvider` from `src/types.ts`) that other components, such as Enricher or Generator plugins, can use to leverage AI capabilities without needing to know the specifics of each underlying AI service.

## Key Responsibilities

-   **API Abstraction:** Wrap the client libraries or HTTP request logic for specific AI platforms (e.g., OpenAI, OpenRouter, Anthropic models).
-   **Authentication:** Manage API keys and any other necessary authentication headers or parameters.
-   **Standardized Operations:** Implement core AI tasks through a common interface, typically including:
    *   `summarize(text: string): Promise<string>`: For generating text summaries.
    *   `topics(text: string): Promise<string[]>`: For extracting keywords or topics.
    *   `image(text: string): Promise<string[]>`: For generating images based on text prompts.

## Interface

All AI provider plugins implement the `AiProvider` interface defined in `src/types.ts`.

## Available AI Provider Plugins

-   **`OpenAIProvider.ts`**: 
    *   Interacts with OpenAI-compatible APIs.
    *   Can be configured to use the direct OpenAI API or OpenRouter (which can proxy to various models like OpenAI's GPT series or Anthropic's Claude models).
    *   Supports text summarization, topic extraction, and image generation (DALL-E 3).

For detailed information on the `OpenAIProvider`, including its configuration parameters and how it handles requests, please examine its source code and associated README in the `src/plugins/ai/` directory of the project repository.

*(In a more mature Docusaurus site, if more AI providers were added, each might have its own dedicated documentation page within this section.)* 