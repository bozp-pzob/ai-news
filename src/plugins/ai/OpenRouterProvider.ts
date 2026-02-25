// src/plugins/ai/OpenRouterProvider.ts

import { AiProvider, AiUsageStats, SummarizeOptions } from "../../types";
import { createTopicsPrompt } from "../../helpers/promptHelper";
import OpenAI from "openai";
import { logger } from "../../helpers/cliHelper";
import { getModelMetadata, ModelMetadata } from "../../helpers/modelMetadataCache";

/**
 * Configuration interface for OpenRouterProvider.
 * Defines the required and optional parameters for initializing an OpenRouter provider.
 */
interface OpenRouterProviderConfig {
  name: string;           // Name identifier for this provider
  apiKey?: string;        // OpenRouter API key for authentication (optional if using platform AI)
  model?: string;         // Optional model name (e.g., "anthropic/claude-3.7-sonnet")
  temperature?: number;   // Optional temperature setting for response generation
  siteUrl?: string;       // Optional site URL for OpenRouter headers
  siteName?: string;      // Optional site name for OpenRouter headers
  fallbackModel?: string; // Optional large context model for fallback when token limits exceeded
  usePlatformAI?: boolean; // Whether to use platform-hosted AI (API key injected by platform)
}

/**
 * OpenRouterProvider class implements the AiProvider interface for OpenRouter's API.
 * This provider supports text summarization, topic extraction, and image generation
 * using OpenRouter as the API gateway to various AI models.
 */
export class OpenRouterProvider implements AiProvider {
  public name: string;
  private openai: OpenAI;
  private openaiDirect: OpenAI | null = null;  // For image generation
  private canGenerateImages: boolean = false;
  private model: string;
  private temperature: number;
  private fallbackModel?: string;
  
  // Model metadata (fetched lazily from OpenRouter)
  private _modelMetadata: ModelMetadata | null = null;
  private _metadataFetched: boolean = false;
  
  // Cumulative usage tracking
  private _usage: AiUsageStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCalls: 0,
    estimatedCostUsd: 0,
  };

  static constructorInterface = {
    parameters: [
      {
        name: 'usePlatformAI',
        type: 'boolean',
        required: false,
        description: 'Use platform-hosted AI provider (Pro users get daily quota, free tier uses efficient model)',
        platformOnly: true
      },
      {
        name: 'apiKey',
        type: 'string',
        required: false,
        description: 'OpenRouter API key for authentication (not required if using platform AI)',
        secret: true
      },
      {
        name: 'model',
        type: 'string',
        required: false,
        description: 'Model to use via OpenRouter (e.g., "anthropic/claude-3.7-sonnet", "openai/gpt-4o")'
      },
      {
        name: 'temperature',
        type: 'number',
        required: false,
        description: 'Temperature setting for model responses (0-2)'
      },
      {
        name: 'siteUrl',
        type: 'string',
        required: false,
        description: 'URL of the site using this provider (for OpenRouter analytics)'
      },
      {
        name: 'siteName',
        type: 'string',
        required: false,
        description: 'Name of the site using this provider (for OpenRouter analytics)'
      },
      {
        name: 'fallbackModel',
        type: 'string',
        required: false,
        description: 'Large context model to fallback to when token limits exceeded (e.g., "openrouter/sonoma-sky-alpha")'
      }
    ]
  };

  /**
   * Creates a new instance of OpenRouterProvider.
   * Initializes the OpenAI-compatible client configured for OpenRouter's API.
   * @param config - Configuration object containing API keys and settings
   */
  constructor(config: OpenRouterProviderConfig) {
    this.name = config.name;
    this.fallbackModel = config.fallbackModel;
    
    // When using platform AI, the API key is injected by the platform at runtime
    // If no API key is provided and usePlatformAI is true, use a placeholder
    // (the platform will replace this with the actual key before execution)
    const apiKey = config.apiKey || (config.usePlatformAI ? 'platform-injected' : '');
    
    if (!apiKey && !config.usePlatformAI) {
      throw new Error('OpenRouter API key is required unless using platform AI');
    }
    
    // Validate that the placeholder was replaced when using platform AI
    if (apiKey === 'platform-injected') {
      throw new Error('Platform AI credentials were not properly injected. The placeholder "platform-injected" should have been replaced with the actual API key. Check that OPENAI_API_KEY environment variable is set.');
    }
    
    // Warn if API key format doesn't match expected provider (OpenRouter keys start with 'sk-or-')
    if (apiKey && !apiKey.startsWith('sk-or-')) {
      logger.warning(`[OpenRouterProvider] API key does not start with 'sk-or-'. This may cause authentication failures. Ensure OPENAI_API_KEY contains an OpenRouter API key, not an OpenAI key.`);
    }
    
    // Initialize client for OpenRouter
    const openAIConfig: any = {
      apiKey: apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": config.siteUrl || "",
        "X-Title": config.siteName || "",
      }
    };

    // Prepend 'openai/' if model doesn't include a slash (for backward compatibility)
    this.model = config.model?.includes("/") ? config.model : `openai/${config.model || "gpt-4o-mini"}`;
    
    // Create separate OpenAI client for image generation if OpenAI key is provided
    // (OpenRouter doesn't support image generation, so we need direct OpenAI access)
    const openaiKey = process.env.OPENAI_DIRECT_KEY;
    if (openaiKey) {
      this.openaiDirect = new OpenAI({
        apiKey: openaiKey
      });
      this.canGenerateImages = true;
    }

    this.openai = new OpenAI(openAIConfig);
    this.temperature = typeof config.temperature === 'string' ? parseFloat(config.temperature) : (config.temperature ?? 0.7);
  }

  /**
   * Lazily fetch model metadata from OpenRouter for context length and pricing.
   */
  private async ensureModelMetadata(): Promise<void> {
    if (this._metadataFetched) return;
    this._metadataFetched = true;
    
    try {
      this._modelMetadata = await getModelMetadata(this.model);
      if (this._modelMetadata) {
        logger.info(`[OpenRouterProvider] Model ${this.model}: context=${this._modelMetadata.contextLength}, promptPrice=${this._modelMetadata.promptPricePerToken}, completionPrice=${this._modelMetadata.completionPricePerToken}`);
      }
    } catch (e) {
      logger.warning(`[OpenRouterProvider] Failed to fetch model metadata: ${e}`);
    }
  }

  /**
   * Record token usage from an API completion response.
   */
  private recordUsage(usage: OpenAI.CompletionUsage | undefined): void {
    if (!usage) return;
    this._usage.totalPromptTokens += usage.prompt_tokens || 0;
    this._usage.totalCompletionTokens += usage.completion_tokens || 0;
    this._usage.totalTokens += usage.total_tokens || 0;
    this._usage.totalCalls++;
    
    if (this._modelMetadata) {
      this._usage.estimatedCostUsd +=
        (usage.prompt_tokens || 0) * this._modelMetadata.promptPricePerToken +
        (usage.completion_tokens || 0) * this._modelMetadata.completionPricePerToken;
    }
  }

  /** Get the model's maximum context length in tokens (0 if unknown). */
  public getContextLength(): number {
    return this._modelMetadata?.contextLength || 0;
  }

  /** Get cumulative token usage and cost stats since last reset. */
  public getUsageStats(): AiUsageStats {
    return { ...this._usage };
  }

  /** Reset cumulative usage stats to zero. */
  public resetUsageStats(): void {
    this._usage = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCalls: 0,
      estimatedCostUsd: 0,
    };
  }

  /**
   * Generates a summary of the provided text using the configured model via OpenRouter.
   * Supports optional system prompts for better instruction/data separation,
   * per-call temperature overrides, and JSON output mode.
   * @param prompt - Text to be summarized (sent as user message)
   * @param options - Optional settings: systemPrompt, temperature override, jsonMode
   * @returns Promise<string> Generated summary
   * @throws Error if the API request fails
   */
  public async summarize(prompt: string, options?: SummarizeOptions): Promise<string> {
    await this.ensureModelMetadata();
    const effectiveTemp = options?.temperature ?? this.temperature;
    
    try {
      // Build messages array: system prompt (if provided) + user message
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (options?.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      logger.debug(`OpenRouter API Call: model=${this.model}, promptLength=${prompt.length}, temperature=${effectiveTemp}, hasSystemPrompt=${!!options?.systemPrompt}, jsonMode=${!!options?.jsonMode}`);

      const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: this.model,
        messages,
        temperature: effectiveTemp
      };

      // Enable JSON mode when requested and supported
      if (options?.jsonMode) {
        requestParams.response_format = { type: 'json_object' };
      }

      const completion = await this.openai.chat.completions.create(requestParams);

      logger.debug(`OpenRouter API Response: hasCompletion=${!!completion}, hasChoices=${!!completion?.choices}, choicesLength=${completion?.choices?.length}`);

      if (!completion || !completion.choices || completion.choices.length === 0) {
        logger.error("Invalid OpenRouter response - missing choices array");
        throw new Error("No choices returned from OpenRouter API");
      }
      
      this.recordUsage(completion.usage);
      return completion.choices[0]?.message?.content || "";
    } catch (error: any) {
      logger.error(`Error in summarize: ${error}`);
      
      // Check if it's a token limit error and we have a fallback model
      if (error.status === 400 && error.message?.includes('context limit') && this.fallbackModel) {
        logger.info(`Token limit exceeded, retrying with fallback model: ${this.fallbackModel}`);
        
        try {
          const fallbackMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
          if (options?.systemPrompt) {
            fallbackMessages.push({ role: 'system', content: options.systemPrompt });
          }
          fallbackMessages.push({ role: 'user', content: prompt });

          const fallbackParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
            model: this.fallbackModel,
            messages: fallbackMessages,
            temperature: effectiveTemp
          };

          if (options?.jsonMode) {
            fallbackParams.response_format = { type: 'json_object' };
          }

          const fallbackCompletion = await this.openai.chat.completions.create(fallbackParams);

          logger.debug(`Fallback API Response: model=${this.fallbackModel}, hasCompletion=${!!fallbackCompletion}, hasChoices=${!!fallbackCompletion?.choices}, choicesLength=${fallbackCompletion?.choices?.length}`);

          if (!fallbackCompletion || !fallbackCompletion.choices || fallbackCompletion.choices.length === 0) {
            logger.error("Invalid fallback OpenRouter response - missing choices array");
            throw new Error("No choices returned from fallback OpenRouter API");
          }
          
          this.recordUsage(fallbackCompletion.usage);
          return fallbackCompletion.choices[0]?.message?.content || "";
        } catch (fallbackError) {
          logger.error(`Fallback model also failed: ${fallbackError}`);
          throw fallbackError;
        }
      }
      
      throw error; // Re-throw if not a token limit error or no fallback
    }
  }

  /**
   * Extracts topic keywords from the provided text.
   * Returns up to 6 words that describe the main topics of the text.
   * @param text - Text to analyze for topics
   * @returns Promise<string[]> Array of topic keywords
   */
  public async topics(text: string): Promise<string[]> {
    await this.ensureModelMetadata();
    try {
      const { systemPrompt, userPrompt } = createTopicsPrompt(text);
  
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2  // Low temperature for factual extraction
      });

      this.recordUsage(completion.usage);
      return JSON.parse(completion.choices[0]?.message?.content || "[]");
    } catch (e) {
      logger.error(`Error in topics: ${e}`);
      return [];
    }
  }

  /**
   * Generate vector embeddings for one or more texts.
   * Uses the OpenAI-compatible embeddings API via OpenRouter.
   * Falls back to direct OpenAI client if available.
   * @param texts - Array of text strings to embed
   * @param model - Optional embedding model override (default: text-embedding-3-small)
   * @returns Promise<number[][]> Array of embedding vectors, one per input text
   */
  public async embed(texts: string[], model?: string): Promise<number[][]> {
    const embeddingModel = model || 'text-embedding-3-small';
    const maxTokens = 8191;
    const batchSize = Math.max(1, 100);
    const timeoutMs = 30_000;

    if (texts.length === 0) return [];

    const results: number[][] = [];
    const truncate = (text: string): string => {
      const maxChars = maxTokens * 4;
      return text.length <= maxChars ? text : text.substring(0, maxChars - 3) + '...';
    };
    const prepare = (text: string): string => text.replace(/\s+/g, ' ').trim();

    try {
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const preparedBatch = batch.map(t => prepare(truncate(t))).filter(t => t.length > 0);

        if (preparedBatch.length === 0) {
          results.push(...batch.map(() => []));
          continue;
        }

        const response = await this.openai.embeddings.create(
          { model: embeddingModel, input: preparedBatch },
          { timeout: timeoutMs, maxRetries: 0 }
        );

        if (response.usage) {
          this._usage.totalPromptTokens += response.usage.prompt_tokens || 0;
          this._usage.totalTokens += response.usage.total_tokens || 0;
          this._usage.totalCalls++;
        }

        let responseIndex = 0;
        for (const originalText of batch) {
          if (prepare(truncate(originalText)).length > 0) {
            results.push(response.data[responseIndex].embedding);
            responseIndex++;
          } else {
            results.push([]);
          }
        }
      }
    } catch (error) {
      logger.error(`[OpenRouterProvider] Error generating embeddings: ${error}`);
      return texts.map(() => []);
    }

    return results;
  }

  /**
   * Generates an image based on the provided text description.
   * Uses DALL-E 3 model to create a 1024x1024 image.
   * Note: Requires OPENAI_DIRECT_KEY environment variable for image generation.
   * @param text - Text description for image generation
   * @returns Promise<string[]> Array containing the generated image URL
   */
  public async image(text: string): Promise<string[]> {
    if (!this.canGenerateImages) {
      logger.warning("Image generation is not available. Set OPENAI_DIRECT_KEY environment variable for image generation.");
      return [];
    }

    try {
      // Use direct OpenAI client for image generation (OpenRouter doesn't support it)
      const client = this.openaiDirect!;
      
      const params: OpenAI.Images.ImageGenerateParams = {
        model: "dall-e-3",
        prompt: text,
        n: 1,
        size: "1024x1024",
      };
  
      const image = await client.images.generate(params);
      if (image.data && image.data.length > 0 && image.data[0].url) {
        logger.debug(`Generated image URL: ${image.data[0].url}`);
        return [image.data[0].url];
      }
      return [];
    } catch (e) {
      logger.error(`Error in image generation: ${e}`);
      return [];
    }
  }
}
