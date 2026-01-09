// src/mcp/server.ts
// @ts-nocheck - MCP SDK types will be available after npm install

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { contextService } from '../services/contextService';
import { userService } from '../services/userService';
import { databaseService } from '../services/databaseService';

/**
 * MCP Server for AI News Context Aggregation Platform
 * 
 * This server provides tools for AI agents to:
 * - Search across community context
 * - Get summaries and context for specific dates
 * - List available configs
 * - Get statistics and topics
 */

const server = new Server(
  {
    name: 'ai-news-context',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

/**
 * Tool definitions
 */
const TOOLS = [
  {
    name: 'search_context',
    description: 'Semantic search across community context. Use this to find relevant discussions, announcements, or information about specific topics.',
    inputSchema: {
      type: 'object',
      properties: {
        config_id: {
          type: 'string',
          description: 'The config/community ID to search in',
        },
        query: {
          type: 'string',
          description: 'The search query - describe what you want to find',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10, max: 50)',
        },
        after_date: {
          type: 'string',
          description: 'Only return results after this date (ISO format: YYYY-MM-DD)',
        },
        before_date: {
          type: 'string',
          description: 'Only return results before this date (ISO format: YYYY-MM-DD)',
        },
      },
      required: ['config_id', 'query'],
    },
  },
  {
    name: 'get_context',
    description: 'Get aggregated context for a community on a specific date. Returns summary, highlights, and statistics.',
    inputSchema: {
      type: 'object',
      properties: {
        config_id: {
          type: 'string',
          description: 'The config/community ID',
        },
        date: {
          type: 'string',
          description: 'Date to get context for (ISO format: YYYY-MM-DD). Defaults to today.',
        },
        format: {
          type: 'string',
          enum: ['json', 'text'],
          description: 'Output format. "text" is optimized for LLM context windows.',
        },
      },
      required: ['config_id'],
    },
  },
  {
    name: 'get_summary',
    description: 'Get the AI-generated summary for a community on a specific date.',
    inputSchema: {
      type: 'object',
      properties: {
        config_id: {
          type: 'string',
          description: 'The config/community ID',
        },
        date: {
          type: 'string',
          description: 'Date to get summary for (ISO format: YYYY-MM-DD). Defaults to today.',
        },
      },
      required: ['config_id'],
    },
  },
  {
    name: 'list_configs',
    description: 'List available public configs/communities that can be queried.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Optional search term to filter configs by name or description',
        },
        limit: {
          type: 'number',
          description: 'Maximum configs to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'get_topics',
    description: 'Get trending topics for a community with frequency counts.',
    inputSchema: {
      type: 'object',
      properties: {
        config_id: {
          type: 'string',
          description: 'The config/community ID',
        },
        limit: {
          type: 'number',
          description: 'Maximum topics to return (default: 20)',
        },
        after_date: {
          type: 'string',
          description: 'Only count topics after this date',
        },
      },
      required: ['config_id'],
    },
  },
  {
    name: 'get_stats',
    description: 'Get statistics for a config including total items, date range, and sources.',
    inputSchema: {
      type: 'object',
      properties: {
        config_id: {
          type: 'string',
          description: 'The config/community ID',
        },
      },
      required: ['config_id'],
    },
  },
];

/**
 * Handle list tools request
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_context': {
        const result = await contextService.search({
          configId: args.config_id as string,
          query: args.query as string,
          limit: Math.min(args.limit as number || 10, 50),
          afterDate: args.after_date as string,
          beforeDate: args.before_date as string,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: args.query,
                totalFound: result.totalFound,
                searchTimeMs: result.searchTimeMs,
                results: result.results.map(r => ({
                  title: r.title,
                  text: r.text?.substring(0, 500),
                  source: r.source,
                  date: r.date,
                  similarity: r.similarity,
                  link: r.link,
                })),
              }, null, 2),
            },
          ],
        };
      }

      case 'get_context': {
        const format = args.format as string || 'json';
        
        if (format === 'text') {
          const text = await contextService.formatContextForLLM(
            args.config_id as string,
            args.date as string
          );
          return {
            content: [{ type: 'text', text }],
          };
        }

        const context = await contextService.getContext(
          args.config_id as string,
          args.date as string
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(context, null, 2),
            },
          ],
        };
      }

      case 'get_summary': {
        const summary = await contextService.getSummary(
          args.config_id as string,
          args.date as string
        );

        if (!summary) {
          return {
            content: [
              {
                type: 'text',
                text: 'No summary available for the specified date.',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: summary.markdown || JSON.stringify(summary, null, 2),
            },
          ],
        };
      }

      case 'list_configs': {
        const result = await userService.getPublicConfigs({
          search: args.search as string,
          limit: args.limit as number || 20,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                total: result.total,
                configs: result.configs.map(c => ({
                  id: c.id,
                  name: c.name,
                  slug: c.slug,
                  description: c.description,
                  totalItems: c.totalItems,
                })),
              }, null, 2),
            },
          ],
        };
      }

      case 'get_topics': {
        const topics = await contextService.getTopics(args.config_id as string, {
          limit: args.limit as number || 20,
          afterDate: args.after_date as string,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ topics }, null, 2),
            },
          ],
        };
      }

      case 'get_stats': {
        const stats = await contextService.getConfigStats(args.config_id as string);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Handle list resources request
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  // Get public configs as resources
  const result = await userService.getPublicConfigs({ limit: 100 });

  return {
    resources: result.configs.map(config => ({
      uri: `context://${config.slug}`,
      name: config.name,
      description: config.description || `Context from ${config.name}`,
      mimeType: 'text/plain',
    })),
  };
});

/**
 * Handle read resource request
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  // Parse URI: context://slug
  const match = uri.match(/^context:\/\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const slug = match[1];
  const config = await userService.getConfigBySlug(slug);

  if (!config) {
    throw new Error(`Config not found: ${slug}`);
  }

  // Get today's context
  const context = await contextService.formatContextForLLM(config.id);

  return {
    contents: [
      {
        uri,
        mimeType: 'text/plain',
        text: context,
      },
    ],
  };
});

/**
 * Start the MCP server
 */
export async function startMCPServer(): Promise<void> {
  // Initialize database connection
  if (process.env.DATABASE_URL) {
    await databaseService.initPlatformDatabase();
  }

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP] Server started');
}

/**
 * Run the server if this is the main module
 */
if (require.main === module) {
  startMCPServer().catch((error) => {
    console.error('[MCP] Failed to start server:', error);
    process.exit(1);
  });
}

export default server;
