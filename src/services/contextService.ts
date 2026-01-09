// src/services/contextService.ts

import { PostgresStorage, VectorSearchResult } from '../plugins/storage/PostgresStorage';
import { embeddingService } from './embeddingService';
import { databaseService } from './databaseService';
import { ContentItem, SummaryItem } from '../types';

/**
 * Search options for semantic search
 */
export interface SearchOptions {
  query: string;
  configId: string;
  limit?: number;
  threshold?: number;
  type?: string;
  source?: string;
  afterDate?: string;  // ISO date string
  beforeDate?: string; // ISO date string
}

/**
 * Search result with relevance score
 */
export interface SearchResult {
  id: number;
  type: string;
  source: string;
  title?: string;
  text?: string;
  link?: string;
  topics?: string[];
  date: string;  // ISO date string
  similarity: number;
  metadata?: Record<string, any>;
}

/**
 * Context response formatted for LLM consumption
 */
export interface ContextResponse {
  config: string;
  date: string;
  summary?: string;
  highlights: string[];
  stats: {
    totalItems: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
  };
  sources: Array<{
    type: string;
    source: string;
    itemCount: number;
  }>;
}

/**
 * Topic with frequency count
 */
export interface TopicCount {
  topic: string;
  count: number;
}

/**
 * Parse ISO date to epoch seconds
 */
function dateToEpoch(date: string): number {
  return Math.floor(new Date(date).getTime() / 1000);
}

/**
 * Format epoch to ISO date string
 */
function epochToDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

/**
 * Get start of day epoch for a date
 */
function startOfDay(date: string): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Get end of day epoch for a date
 */
function endOfDay(date: string): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Perform semantic search across content items
 */
export async function search(options: SearchOptions): Promise<{
  results: SearchResult[];
  totalFound: number;
  searchTimeMs: number;
}> {
  const startTime = Date.now();
  
  const {
    query,
    configId,
    limit = 20,
    threshold = 0.7,
    type,
    source,
    afterDate,
    beforeDate
  } = options;

  // Generate embedding for query
  const queryEmbedding = await embeddingService.embed(query);

  // Get storage for config
  const storage = await databaseService.getStorageForConfig({
    id: configId,
    storage_type: 'platform'  // Will be overridden if external
  });

  // Perform vector search
  const results = await storage.searchByEmbedding({
    embedding: queryEmbedding,
    limit: limit * 2,  // Fetch more to account for filtering
    threshold,
    type,
    source,
    afterDate: afterDate ? dateToEpoch(afterDate) : undefined,
    beforeDate: beforeDate ? dateToEpoch(beforeDate) : undefined
  });

  const searchTimeMs = Date.now() - startTime;

  // Format results
  const formattedResults: SearchResult[] = results.slice(0, limit).map(item => ({
    id: item.id!,
    type: item.type,
    source: item.source,
    title: item.title,
    text: item.text,
    link: item.link,
    topics: item.topics,
    date: item.date ? epochToDate(item.date) : '',
    similarity: item.similarity,
    metadata: item.metadata
  }));

  return {
    results: formattedResults,
    totalFound: results.length,
    searchTimeMs
  };
}

/**
 * Get context for a config on a specific date
 */
export async function getContext(
  configId: string,
  date?: string
): Promise<ContextResponse> {
  const targetDate = date || new Date().toISOString().split('T')[0];
  
  const startEpoch = startOfDay(targetDate);
  const endEpoch = endOfDay(targetDate);

  // Get storage for config
  const storage = await databaseService.getStorageForConfig({
    id: configId,
    storage_type: 'platform'
  });

  // Get items for the day
  const items = await storage.getContentItemsBetweenEpoch(startEpoch, endEpoch);

  // Get summary for the day
  const summaries = await storage.getSummaryBetweenEpoch(startEpoch, endEpoch);
  const summary = summaries.length > 0 ? summaries[0] : undefined;

  // Calculate stats
  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  
  for (const item of items) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    bySource[item.source] = (bySource[item.source] || 0) + 1;
  }

  // Build sources array
  const sourcesMap = new Map<string, { type: string; source: string; itemCount: number }>();
  for (const item of items) {
    const key = `${item.type}:${item.source}`;
    if (!sourcesMap.has(key)) {
      sourcesMap.set(key, { type: item.type, source: item.source, itemCount: 0 });
    }
    sourcesMap.get(key)!.itemCount++;
  }

  // Extract highlights (top topics or key items)
  const highlights: string[] = [];
  
  if (summary?.markdown) {
    // Extract first few bullet points from markdown
    const bulletPoints = summary.markdown.match(/^[-*]\s+(.+)$/gm);
    if (bulletPoints) {
      highlights.push(...bulletPoints.slice(0, 5).map(bp => bp.replace(/^[-*]\s+/, '')));
    }
  }

  // Get config info
  const configResult = await databaseService.query(
    'SELECT name, slug FROM configs WHERE id = $1',
    [configId]
  );
  const configName = configResult.rows[0]?.slug || configId;

  return {
    config: configName,
    date: targetDate,
    summary: summary?.markdown,
    highlights,
    stats: {
      totalItems: items.length,
      byType,
      bySource
    },
    sources: Array.from(sourcesMap.values())
  };
}

/**
 * Get summary for a config on a specific date
 */
export async function getSummary(
  configId: string,
  date?: string,
  type?: string
): Promise<SummaryItem | null> {
  const targetDate = date || new Date().toISOString().split('T')[0];
  
  const startEpoch = startOfDay(targetDate);
  const endEpoch = endOfDay(targetDate);

  // Get storage for config
  const storage = await databaseService.getStorageForConfig({
    id: configId,
    storage_type: 'platform'
  });

  // Get summaries for the day
  const summaries = await storage.getSummaryBetweenEpoch(startEpoch, endEpoch);

  if (summaries.length === 0) {
    return null;
  }

  // Filter by type if specified
  if (type) {
    return summaries.find(s => s.type === type) || null;
  }

  return summaries[0];
}

/**
 * Get topics with counts for a config
 */
export async function getTopics(
  configId: string,
  options: {
    limit?: number;
    afterDate?: string;
    beforeDate?: string;
  } = {}
): Promise<TopicCount[]> {
  const { limit = 50, afterDate, beforeDate } = options;

  // Get storage for config
  const storage = await databaseService.getStorageForConfig({
    id: configId,
    storage_type: 'platform'
  });

  // If date range is specified, we need to filter
  if (afterDate || beforeDate) {
    const startEpoch = afterDate ? dateToEpoch(afterDate) : 0;
    const endEpoch = beforeDate ? dateToEpoch(beforeDate) : Math.floor(Date.now() / 1000);

    const items = await storage.getContentItemsBetweenEpoch(startEpoch, endEpoch);
    
    // Count topics manually
    const topicCounts: Record<string, number> = {};
    for (const item of items) {
      if (item.topics) {
        for (const topic of item.topics) {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        }
      }
    }

    // Sort and limit
    return Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // Use optimized query
  return storage.getTopicCounts(limit);
}

/**
 * Get source statistics for a config
 */
export async function getSourceStats(configId: string): Promise<Array<{
  source: string;
  count: number;
  latestDate: string;
}>> {
  const storage = await databaseService.getStorageForConfig({
    id: configId,
    storage_type: 'platform'
  });

  const stats = await storage.getSourceStats();
  
  return stats.map(s => ({
    source: s.source,
    count: s.count,
    latestDate: epochToDate(s.latestDate)
  }));
}

/**
 * Get config statistics
 */
export async function getConfigStats(configId: string): Promise<{
  totalItems: number;
  totalQueries: number;
  totalRevenue: number;
  dateRange: { from: string; to: string } | null;
  lastUpdated: string | null;
}> {
  // Get config info from database
  const configResult = await databaseService.query(
    `SELECT total_items, total_queries, total_revenue, last_run_at
     FROM configs WHERE id = $1`,
    [configId]
  );

  if (configResult.rows.length === 0) {
    throw new Error('Config not found');
  }

  const config = configResult.rows[0];

  // Get date range from storage
  const storage = await databaseService.getStorageForConfig({
    id: configId,
    storage_type: 'platform'
  });

  const dateRange = await storage.getDateRange();

  return {
    totalItems: config.total_items,
    totalQueries: config.total_queries,
    totalRevenue: parseFloat(config.total_revenue) || 0,
    dateRange: dateRange ? {
      from: epochToDate(dateRange.minDate),
      to: epochToDate(dateRange.maxDate)
    } : null,
    lastUpdated: config.last_run_at ? new Date(config.last_run_at).toISOString() : null
  };
}

/**
 * Format context for LLM consumption (optimized for context window)
 */
export async function formatContextForLLM(
  configId: string,
  date?: string,
  maxLength: number = 8000
): Promise<string> {
  const context = await getContext(configId, date);
  
  const parts: string[] = [];
  
  // Header
  parts.push(`# Context for ${context.config}`);
  parts.push(`Date: ${context.date}`);
  parts.push('');

  // Stats
  parts.push(`## Activity Summary`);
  parts.push(`Total items: ${context.stats.totalItems}`);
  parts.push('');

  // By source
  if (context.sources.length > 0) {
    parts.push('### Sources');
    for (const source of context.sources) {
      parts.push(`- ${source.source} (${source.type}): ${source.itemCount} items`);
    }
    parts.push('');
  }

  // Highlights
  if (context.highlights.length > 0) {
    parts.push('### Key Highlights');
    for (const highlight of context.highlights) {
      parts.push(`- ${highlight}`);
    }
    parts.push('');
  }

  // Summary (truncate if needed)
  if (context.summary) {
    parts.push('### Detailed Summary');
    
    const currentLength = parts.join('\n').length;
    const availableLength = maxLength - currentLength - 100;  // Buffer
    
    if (context.summary.length > availableLength) {
      parts.push(context.summary.substring(0, availableLength) + '...');
    } else {
      parts.push(context.summary);
    }
  }

  return parts.join('\n');
}

export const contextService = {
  search,
  getContext,
  getSummary,
  getTopics,
  getSourceStats,
  getConfigStats,
  formatContextForLLM
};
