// src/plugins/ai/OpenAIProvider.ts

import { AiProvider, ImageGenerationConfig, ImageGenerationOptions, CDNConfig, AiUsageStats, SummarizeOptions, BudgetExhaustedError } from "../../types";
import { createTopicsPrompt } from "../../helpers/promptHelper";
import OpenAI from "openai";
import { logger } from "../../helpers/cliHelper";
import { uploadBase64ImageToCDN, getDefaultCDNConfig } from "../../helpers/cdnUploader";
import { getModelMetadata, ModelMetadata } from "../../helpers/modelMetadataCache";

/**
 * Configuration interface for OpenAIProvider.
 * Defines the required and optional parameters for initializing an OpenAI provider.
 */
interface OpenAIProviderConfig {
  name: string;           // Name identifier for this provider
  apiKey?: string;        // OpenAI API key for authentication (optional if using platform AI)
  model?: string;         // Optional model name (defaults to gpt-4o-mini)
  temperature?: number;   // Optional temperature setting for response generation
  useOpenRouter?: boolean; // Whether to use OpenRouter instead of direct OpenAI API
  siteUrl?: string;       // Optional site URL for OpenRouter
  siteName?: string;      // Optional site name for OpenRouter
  fallbackModel?: string; // Optional large context model for fallback when token limits exceeded
  imageConfig?: ImageGenerationConfig; // Optional image generation configuration
  usePlatformAI?: boolean; // Whether to use platform-hosted AI (API key injected by platform)
}

/**
 * OpenAIProvider class implements the AiProvider interface for OpenAI's API.
 * This provider supports text summarization, topic extraction, and image generation
 * using either direct OpenAI API or OpenRouter as a proxy.
 */
export class OpenAIProvider implements AiProvider {
  public name: string;
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private useOpenRouter: boolean;
  private fallbackModel?: string;
  private imageConfig?: ImageGenerationConfig;
  private imageModel: string;
  
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
  
  // Token budget enforcement
  private _tokenBudget: number | null = null;

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
        description: 'OpenAI API key for authentication (not required if using platform AI)',
        secret: true
      },
      {
        name: 'model',
        type: 'string',
        required: false,
        description: 'OpenAI model to use (e.g., "gpt-4o", "gpt-4o-mini")'
      },
      {
        name: 'temperature',
        type: 'number',
        required: false,
        description: 'Temperature setting for model responses (0-2)'
      },
      {
        name: 'fallbackModel',
        type: 'string',
        required: false,
        description: 'Fallback model to use when token limits exceeded'
      }
    ]
  };

  /**
   * Creates a new instance of OpenAIProvider.
   * Initializes the OpenAI client with the provided configuration and sets up
   * optional image generation capabilities.
   * @param config - Configuration object containing API keys and settings
   */
  constructor(config: OpenAIProviderConfig) {
    this.name = config.name;
    this.useOpenRouter = config.useOpenRouter || false;
    this.fallbackModel = config.fallbackModel;
    this.imageConfig = config.imageConfig;
    this.imageModel = config.imageConfig?.model || "google/gemini-3-pro-image-preview";

    // Initialize OpenAI client (direct or via OpenRouter)
    
    // When using platform AI, the API key is injected by the platform at runtime
    // If no API key is provided and usePlatformAI is true, use a placeholder
    // (the platform will replace this with the actual key before execution)
    const apiKey = config.apiKey || (config.usePlatformAI ? 'platform-injected' : '');
    
    if (!apiKey && !config.usePlatformAI) {
      throw new Error('OpenAI API key is required unless using platform AI');
    }
    
    // Validate that the placeholder was replaced when using platform AI
    if (apiKey === 'platform-injected') {
      throw new Error('Platform AI credentials were not properly injected. The placeholder "platform-injected" should have been replaced with the actual API key. Check that OPENAI_API_KEY environment variable is set.');
    }
    
    // Warn if API key format doesn't match expected provider
    if (this.useOpenRouter && apiKey && !apiKey.startsWith('sk-or-')) {
      logger.warning(`[OpenAIProvider] Using OpenRouter but API key does not start with 'sk-or-'. This may cause authentication failures. Ensure OPENAI_API_KEY contains an OpenRouter API key, not an OpenAI key.`);
    }
    
    // Initialize main client (OpenRouter or OpenAI)
    const openAIConfig: any = {
      apiKey: apiKey
    };

    if (this.useOpenRouter) {
      openAIConfig.baseURL = "https://openrouter.ai/api/v1";
      openAIConfig.defaultHeaders = {
        "HTTP-Referer": config.siteUrl || "",
        "X-Title": config.siteName || "",
      };
      this.model = config.model?.includes("/") ? config.model : `openai/${config.model || "gpt-4o-mini"}`;
    } else {
      this.model = config.model || "gpt-4o-mini";
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
    
    if (this.useOpenRouter) {
      try {
        this._modelMetadata = await getModelMetadata(this.model);
        if (this._modelMetadata) {
          logger.info(`[OpenAIProvider] Model ${this.model}: context=${this._modelMetadata.contextLength}, promptPrice=${this._modelMetadata.promptPricePerToken}, completionPrice=${this._modelMetadata.completionPricePerToken}`);
        }
      } catch (e) {
        logger.warning(`[OpenAIProvider] Failed to fetch model metadata: ${e}`);
      }
    }
  }

  /**
   * Record token usage from an API completion response.
   * Throws BudgetExhaustedError if token budget is exceeded.
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
    
    // Check token budget after recording usage
    if (this._tokenBudget !== null && this._usage.totalTokens > this._tokenBudget) {
      throw new BudgetExhaustedError(this._usage, this._tokenBudget);
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

  /** Set a token budget. Throws BudgetExhaustedError if exceeded during any AI call. */
  public setTokenBudget(budget: number): void {
    this._tokenBudget = budget;
  }

  /** Clear the token budget (no limit). */
  public clearTokenBudget(): void {
    this._tokenBudget = null;
  }

  /** Get remaining tokens in the budget, or null if no budget is set. */
  public getRemainingBudget(): number | null {
    if (this._tokenBudget === null) return null;
    return Math.max(0, this._tokenBudget - this._usage.totalTokens);
  }

  /**
   * Generates a summary of the provided text using the configured OpenAI model.
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

      logger.debug(`OpenAI API Call: model=${this.model}, useOpenRouter=${this.useOpenRouter}, promptLength=${prompt.length}, temperature=${effectiveTemp}, hasSystemPrompt=${!!options?.systemPrompt}, jsonMode=${!!options?.jsonMode}`);

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

      logger.debug(`OpenAI API Response: hasCompletion=${!!completion}, hasChoices=${!!completion?.choices}, choicesLength=${completion?.choices?.length}`);

      if (!completion || !completion.choices || completion.choices.length === 0) {
        logger.error("Invalid OpenAI response - missing choices array");
        throw new Error("No choices returned from OpenAI API");
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
            logger.error("Invalid fallback OpenAI response - missing choices array");
            throw new Error("No choices returned from fallback OpenAI API");
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
   * Generates an optimized prompt for image generation based on content and category.
   * Uses prompt templates with random rotation for variety.
   * @param text - Content text to base the image on
   * @param category - Optional category for template selection
   * @returns Promise<string> Optimized image prompt
   */
  /**
   * Map item types to template keys
   */
  private mapTypeToTemplateKey(type: string): string {
    const mapping: Record<string, string> = {
      discordRawData: "discordrawdata",
      githubIssue: "issue",
      githubPullRequest: "pull_request",
      githubStatsSummary: "github_summary",
      githubTopContributors: "contributors",
      githubCompletedItem: "completed_items",
    };
    return mapping[type] || type.toLowerCase();
  }

  private async generateImagePrompt(text: string, category?: string): Promise<string> {
    // Map item type to template key (e.g., "discordRawData" -> "discordrawdata")
    const templateKey = category ? this.mapTypeToTemplateKey(category) : "";

    // Check for category-specific prompts first
    let prompts = this.imageConfig?.promptTemplates?.[templateKey];

    if (!prompts && templateKey) {
      logger.warning(`No promptTemplate found for category "${category}" (mapped to "${templateKey}"). Using defaultPrompts.`);
    }

    // Fall back to defaults if no category match
    if (!prompts) {
      prompts = this.imageConfig?.defaultPrompts;
    }

    // If still no prompts, fail explicitly
    if (!prompts || prompts.length === 0) {
      throw new Error(`No image prompts configured for category "${category}" and no defaultPrompts set`);
    }

    // Random rotation - pick one prompt from the array
    const template = prompts[Math.floor(Math.random() * prompts.length)];

    // Ask for the vibe/feeling rather than literal description - makes better visuals
    const summaryPrompt = `What's the vibe of this? Reply with only 3-6 words capturing the mood or feeling:\n\n${text.substring(0, 1500)}`;

    try {
      const summary = await this.summarize(summaryPrompt);
      return template.replace("{summary}", summary.trim());
    } catch (error) {
      logger.warning(`Failed to generate summary for image prompt, using truncated text: ${error}`);
      // Fallback: use truncated text directly
      return template.replace("{summary}", text.substring(0, 200));
    }
  }

  /**
   * Generate vector embeddings for one or more texts.
   * Uses the OpenAI embeddings API (works via direct OpenAI or OpenRouter).
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
      logger.error(`[OpenAIProvider] Error generating embeddings: ${error}`);
      return texts.map(() => []);
    }

    return results;
  }

  /**
   * Generates an image based on the provided text description.
   * Uses OpenRouter with Gemini (Nano Banana Pro) for image generation.
   * Supports reference images for style transfer, composition, or editing.
   *
   * @param text - Text description for image generation
   * @param options - Optional settings: category, referenceImages, aspectRatio, imageSize
   * @returns Promise<string[]> Array containing the generated image URL or data URL
   */
  public async image(text: string, options?: ImageGenerationOptions): Promise<string[]> {
    if (!this.useOpenRouter) {
      logger.warning("Image generation requires OpenRouter. Set useOpenRouter: true in config.");
      return [];
    }

    const category = options?.category;
    const referenceImages = options?.referenceImages || [];
    const aspectRatio = options?.aspectRatio || this.imageConfig?.aspectRatio || "16:9";
    const imageSize = options?.imageSize || this.imageConfig?.imageSize || "1K";

    try {
      // Generate optimized prompt using templates
      const imagePrompt = await this.generateImagePrompt(text, category);
      console.log(`Generated Prompt:\n"${imagePrompt}"\n`);
      logger.debug(`Image prompt (category=${category || "default"}): ${imagePrompt.substring(0, 100)}...`);

      // Build content array with text prompt first, then any reference images
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: imagePrompt }
      ];

      // Add reference images if provided
      for (const refImage of referenceImages) {
        content.push({
          type: "image_url",
          image_url: { url: refImage }
        });
      }

      if (referenceImages.length > 0) {
        logger.debug(`Including ${referenceImages.length} reference image(s) in request`);
      }

      // Build request with image_config
      const requestBody: any = {
        model: this.imageModel,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
        image_config: {
          aspect_ratio: aspectRatio,
          image_size: imageSize
        }
      };

      logger.debug(`Image config: aspect_ratio=${aspectRatio}, image_size=${imageSize}`);

      // Call OpenRouter with Gemini for image generation
      const response = await this.openai.chat.completions.create(requestBody);

      // Extract base64 image from OpenRouter response
      // Response format: message.images[].image_url.url = "data:image/png;base64,..."
      const message = response.choices[0]?.message as any;
      let imageUrl: string | undefined;

      if (message?.images && message.images.length > 0) {
        imageUrl = message.images[0]?.image_url?.url;
      }

      if (!imageUrl) {
        // Debug: log what we actually got
        logger.error(`No image returned from OpenRouter (model: ${this.imageModel})`);
        logger.error(`Response keys: ${Object.keys(message || {}).join(", ")}`);
        if (message?.content) {
          logger.error(`Response content: ${String(message.content)}`);
        }
        if (message?.refusal) {
          logger.error(`Model refusal: ${message.refusal}`);
        }
        return [];
      }

      logger.debug(`Generated base64 image via OpenRouter (${this.imageModel})`);

      // Upload to CDN if configured
      if (this.imageConfig?.uploadToCDN && imageUrl.startsWith("data:image/")) {
        const cdnPath = this.imageConfig.cdnPath || "generated-images";
        const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const remotePath = `${cdnPath}/${filename}`;

        const cdnConfig: Partial<CDNConfig> = getDefaultCDNConfig();
        const result = await uploadBase64ImageToCDN(imageUrl, remotePath, cdnConfig);

        if (result.success) {
          logger.debug(`Uploaded to CDN: ${result.cdnUrl}`);
          return [result.cdnUrl];
        } else {
          logger.warning(`CDN upload failed: ${result.message}, returning base64`);
        }
      }

      return imageUrl ? [imageUrl] : [];

    } catch (error) {
      logger.error(`Error in image generation: ${error}`);
      return [];
    }
  }
}
