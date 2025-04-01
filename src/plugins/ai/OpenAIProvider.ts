// src/plugins/ai/OpenAIProvider.ts

import { AiProvider } from "../../types";
import OpenAI from "openai";

interface OpenAIProviderConfig {
  name: string;
  apiKey: string;
  model?: string;          
  temperature?: number;    
  useOpenRouter?: boolean;
  siteUrl?: string;      
  siteName?: string;     
}

export class OpenAIProvider implements AiProvider {
  public name: string;
  private openai: OpenAI;
  private openaiDirect: OpenAI | null = null;  // For image generation
  private canGenerateImages: boolean = false;
  private model: string;
  private temperature: number;
  private useOpenRouter: boolean;

  static constructorInterface = {
    parameters: [
      {
        name: 'apiKey',
        type: 'string',
        required: true,
        description: 'OpenAI API key for authentication'
      },
      {
        name: 'model',
        type: 'string',
        required: false,
        description: 'OpenAI model to use (e.g., "gpt-4", "gpt-3.5-turbo")'
      },
      {
        name: 'temperature',
        type: 'number',
        required: false,
        description: 'Temperature setting for model responses (0-2)'
      },
      {
        name: 'useOpenRouter',
        type: 'boolean',
        required: false,
        description: 'Whether to use OpenRouter instead of direct OpenAI API'
      },
      {
        name: 'siteUrl',
        type: 'string',
        required: false,
        description: 'URL of the site using this provider'
      },
      {
        name: 'siteName',
        type: 'string',
        required: false,
        description: 'Name of the site using this provider'
      }
    ]
  };

  constructor(config: OpenAIProviderConfig) {
    this.name = config.name;
    this.useOpenRouter = config.useOpenRouter || false;
    
    // Initialize main client (OpenRouter or OpenAI)
    const openAIConfig: any = {
      apiKey: config.apiKey
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

  public async summarize(prompt: string): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.temperature
      });

      return completion.choices[0]?.message?.content || "";
    } catch (e) {
      console.error("Error in summarize:", e);
      throw e;
    }
  }

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
      console.error("Error in topics:", e);
      return [];
    }
  }

  public async image(text: string): Promise<string[]> {
    if (!this.canGenerateImages) {
      console.warn("Image generation is not available. When using OpenRouter, set OPENAI_DIRECT_KEY for image generation.");
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
      console.log(image.data[0].url);
      return JSON.parse(image.data[0].url || "[]");
    } catch (e) {
      console.error("Error in image generation:", e);
      return [];
    }
  }
}
