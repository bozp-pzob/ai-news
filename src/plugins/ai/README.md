# AI Provider Plugins (`src/plugins/ai/`)

This directory contains plugins that act as wrappers or clients for various Artificial Intelligence (AI) model providers. These plugins abstract the complexities of interacting with different AI APIs and provide a standardized interface for other parts of the application (like enrichers or generators) to use AI capabilities.

All AI Provider plugins must implement the `AiProvider` interface defined in `src/types.ts`.

## Key Files

### `OpenAIProvider.ts`

**Functionality:**

*   Implements the `AiProvider` interface to interact with OpenAI compatible APIs.
*   Supports using the direct OpenAI API or the OpenRouter API (which acts as a proxy for various models, including OpenAI and Anthropic models like Claude).
*   The choice between direct OpenAI and OpenRouter is determined by the `useOpenRouter` parameter in its configuration.
*   Handles API key authentication and, if using OpenRouter, additional headers like `HTTP-Referer` and `X-Title`.
*   Configurable parameters include:
    *   `name`: A unique name for this provider instance.
    *   `apiKey`: The API key for the service (OpenAI or OpenRouter).
    *   `model`: The specific AI model to use (e.g., `gpt-4o-mini`, `anthropic/claude-3.7-sonnet`). If using OpenRouter and a non-OpenAI model, the model name should be prefixed appropriately (e.g., `anthropic/claude-3.7-sonnet`).
    *   `temperature`: Controls the randomness of the AI's output.
    *   `useOpenRouter`: Boolean, true to use OpenRouter.
    *   `siteUrl`, `siteName`: Required for OpenRouter identification.
*   Provides the following core AI operations:
    *   `summarize(prompt: string): Promise<string>`: Generates a text summary for a given prompt.
    *   `topics(text: string): Promise<string[]>`: Extracts a list of topic keywords from a given text. The prompt used for this asks for up to 6 words in a specific JSON array format.
    *   `image(text: string): Promise<string[]>`: Generates an image based on a text description using a model like DALL-E 3. When `useOpenRouter` is true, image generation might require a separate direct OpenAI API key (`OPENAI_DIRECT_KEY` environment variable) because OpenRouter might not support image generation through all its proxied models or might require direct OpenAI credentials for it.

**Data Flow:**

1.  **Initialization:** An instance of `OpenAIProvider` is created by `configHelper.ts` based on the JSON configuration. The API key and other parameters are passed to its constructor.
2.  **Injection:** This instance is then injected into other plugins (Enrichers, Generators, or even some Sources) that declare a dependency on an `AiProvider` with a matching name.
3.  **Usage (e.g., in a Generator):**
    *   A generator plugin calls one of the provider's methods (e.g., `summarize(someText)`).
    *   `OpenAIProvider` constructs the appropriate API request (including the prompt/text and model parameters).
    *   It sends the request to either the OpenAI API or OpenRouter API endpoint.
    *   It receives the API response.
    *   It parses the response to extract the relevant data (e.g., summary text, topic list, image URL).
    *   It returns the processed data to the calling generator plugin.

**Dependencies:**

*   Relies on the `openai` NPM package.
*   Uses interfaces from `src/types.ts` (`AiProvider`).
*   API keys are typically sourced from environment variables and passed via the JSON configuration. 