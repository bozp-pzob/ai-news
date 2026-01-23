// src/plugins/ai/OpenRouterProvider.ts

import { AiProvider } from "../../types";
import OpenAI from "openai";
import { logger } from "../../helpers/cliHelper";

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
    this.temperature = config.temperature ?? 0.7;
  }

  /**
   * Generates a summary of the provided text using the configured model via OpenRouter.
   * @param prompt - Text to be summarized
   * @returns Promise<string> Generated summary
   * @throws Error if the API request fails
   */
  public async summarize(prompt: string): Promise<string> {
    try {
      logger.debug(`OpenRouter API Call: model=${this.model}, promptLength=${prompt.length}, temperature=${this.temperature}`);

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.temperature
      });

      // Debug: Log the actual API response to understand what's happening
      logger.debug(`OpenRouter API Response: hasCompletion=${!!completion}, hasChoices=${!!completion?.choices}, choicesLength=${completion?.choices?.length}`);

      if (!completion || !completion.choices || completion.choices.length === 0) {
        logger.error("Invalid OpenRouter response - missing choices array");
        throw new Error("No choices returned from OpenRouter API");
      }
      
      return completion.choices[0]?.message?.content || "";
    } catch (error: any) {
      logger.error(`Error in summarize: ${error}`);
      
      // Check if it's a token limit error and we have a fallback model
      if (error.status === 400 && error.message?.includes('context limit') && this.fallbackModel) {
        logger.info(`Token limit exceeded, retrying with fallback model: ${this.fallbackModel}`);
        
        try {
          const fallbackCompletion = await this.openai.chat.completions.create({
            model: this.fallbackModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: this.temperature
          });

          logger.debug(`Fallback API Response: model=${this.fallbackModel}, hasCompletion=${!!fallbackCompletion}, hasChoices=${!!fallbackCompletion?.choices}, choicesLength=${fallbackCompletion?.choices?.length}`);

          if (!fallbackCompletion || !fallbackCompletion.choices || fallbackCompletion.choices.length === 0) {
            logger.error("Invalid fallback OpenRouter response - missing choices array");
            throw new Error("No choices returned from fallback OpenRouter API");
          }
          
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
    try {
      const prompt = `Provide up to 6 words that describe the topic of the following text:\n\n"${text}.\n\n Response format MUST be formatted in this way, the words must be strings:\n\n[ \"word1\", \"word2\", \"word3\"]\n`;
  
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.temperature
      });

      return JSON.parse(completion.choices[0]?.message?.content || "[]");
    } catch (e) {
      logger.error(`Error in topics: ${e}`);
      return [];
    }
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
