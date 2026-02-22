/**
 * Shared cache for OpenRouter model metadata (context length, pricing).
 * Fetches once from GET https://openrouter.ai/api/v1/models and caches
 * with a configurable TTL (default 1 hour).
 */

import { logger } from './cliHelper';

export interface ModelMetadata {
  id: string;
  contextLength: number;
  promptPricePerToken: number;
  completionPricePerToken: number;
}

interface CacheEntry {
  models: Map<string, ModelMetadata>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cache: CacheEntry | null = null;
let fetchPromise: Promise<Map<string, ModelMetadata>> | null = null;

/**
 * Fetch all model metadata from OpenRouter and populate the cache.
 * Uses a deduplication promise so concurrent calls only trigger one request.
 */
async function fetchModels(): Promise<Map<string, ModelMetadata>> {
  const models = new Map<string, ModelMetadata>();
  
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      logger.warning(`[ModelCache] Failed to fetch model list: HTTP ${response.status}`);
      return models;
    }

    const data = await response.json() as any;
    
    if (!data?.data || !Array.isArray(data.data)) {
      logger.warning('[ModelCache] Unexpected response format from OpenRouter models API');
      return models;
    }

    for (const model of data.data) {
      if (!model.id) continue;

      // Pricing from OpenRouter is in dollars per token
      const promptPrice = parseFloat(model.pricing?.prompt || '0');
      const completionPrice = parseFloat(model.pricing?.completion || '0');

      models.set(model.id, {
        id: model.id,
        contextLength: model.context_length || 0,
        promptPricePerToken: promptPrice,
        completionPricePerToken: completionPrice,
      });
    }

    logger.info(`[ModelCache] Cached metadata for ${models.size} models`);
  } catch (error) {
    logger.warning(`[ModelCache] Error fetching model metadata: ${error}`);
  }

  return models;
}

/**
 * Get metadata for a specific model. Fetches from OpenRouter if the cache
 * is empty or stale. Returns null if the model is not found.
 */
export async function getModelMetadata(modelId: string): Promise<ModelMetadata | null> {
  // Check if cache is valid
  if (cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS) {
    return cache.models.get(modelId) || null;
  }

  // Deduplicate concurrent fetches
  if (!fetchPromise) {
    fetchPromise = fetchModels().then(models => {
      cache = { models, fetchedAt: Date.now() };
      fetchPromise = null;
      return models;
    }).catch(err => {
      fetchPromise = null;
      throw err;
    });
  }

  const models = await fetchPromise;
  return models.get(modelId) || null;
}

/**
 * Get context length for a model. Returns 0 if unknown.
 */
export async function getModelContextLength(modelId: string): Promise<number> {
  const meta = await getModelMetadata(modelId);
  return meta?.contextLength || 0;
}

/**
 * Get pricing for a model. Returns { prompt: 0, completion: 0 } if unknown.
 */
export async function getModelPricing(modelId: string): Promise<{ prompt: number; completion: number }> {
  const meta = await getModelMetadata(modelId);
  return {
    prompt: meta?.promptPricePerToken || 0,
    completion: meta?.completionPricePerToken || 0,
  };
}
