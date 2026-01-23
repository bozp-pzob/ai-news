// src/plugins/ai/OpenAIProvider.ts

import { AiProvider } from "../../types";
import OpenAI from "openai";
import { logger } from "../../helpers/cliHelper";

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
  private openaiDirect: OpenAI | null = null;  // For image generation
  private canGenerateImages: boolean = false;
  private model: string;
  private temperature: number;
  private useOpenRouter: boolean;
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
    
    // When using platform AI, the API key is injected by the platform at runtime
    // If no API key is provided and usePlatformAI is true, use a placeholder
    // (the platform will replace this with the actual key before execution)
    const apiKey = config.apiKey || (config.usePlatformAI ? 'platform-injected' : '');
    
    if (!apiKey && !config.usePlatformAI) {
      throw new Error('OpenAI API key is required unless using platform AI');
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
      
      // Create separate OpenAI client for image generation if OpenAI key is provided
      const openaiKey = process.env.OPENAI_DIRECT_KEY;
      if (openaiKey) {
        this.openaiDirect = new OpenAI({
          apiKey: openaiKey
        });
        this.canGenerateImages = true;
      }
    } else {
      this.model = config.model || "gpt-4o-mini";
      this.canGenerateImages = true;
    }

    this.openai = new OpenAI(openAIConfig);
    this.temperature = config.temperature ?? 0.7;
  }

  /**
   * Generates a summary of the provided text using the configured OpenAI model.
   * @param prompt - Text to be summarized
   * @returns Promise<string> Generated summary
   * @throws Error if the API request fails
   */
  public async summarize(prompt: string): Promise<string> {
    try {
      logger.debug(`OpenAI API Call: model=${this.model}, useOpenRouter=${this.useOpenRouter}, promptLength=${prompt.length}, temperature=${this.temperature}`);

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.temperature
      });

      // Debug: Log the actual API response to understand what's happening
      logger.debug(`OpenAI API Response: hasCompletion=${!!completion}, hasChoices=${!!completion?.choices}, choicesLength=${completion?.choices?.length}`);

      if (!completion || !completion.choices || completion.choices.length === 0) {
        logger.error("Invalid OpenAI response - missing choices array");
        throw new Error("No choices returned from OpenAI API");
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
            logger.error("Invalid fallback OpenAI response - missing choices array");
            throw new Error("No choices returned from fallback OpenAI API");
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
   * Note: Requires direct OpenAI API key when using OpenRouter.
   * @param text - Text description for image generation
   * @returns Promise<string[]> Array containing the generated image URL
   */
  public async image(text: string): Promise<string[]> {
    if (!this.canGenerateImages) {
      logger.warning("Image generation is not available. When using OpenRouter, set OPENAI_DIRECT_KEY for image generation.");
      return [];
    }

    try {
      // Use direct OpenAI client for image generation
      const client = this.useOpenRouter ? this.openaiDirect! : this.openai;
      
      const prompt = `Create an image that depicts the following text:\n\n"${text}.\n\n Response format MUST be formatted in this way, the words must be strings:\n\n{ \"images\": \"<image_url>\"}\n`;
      
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
