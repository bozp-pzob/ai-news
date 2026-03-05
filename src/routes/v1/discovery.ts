// src/routes/v1/discovery.ts
// Agent-facing discovery endpoints: OpenAPI spec, .well-known files, robots.txt

import { Router, Request, Response } from 'express';

const router = Router();

// =============================================================================
// OpenAPI 3.1 Specification (agent-relevant public endpoints)
// =============================================================================

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Digital Gardener API',
    version: '1.0.0',
    description:
      'Community intelligence platform that aggregates, enriches, and summarizes content from Discord, GitHub, and Telegram. Provides structured data and AI-generated summaries for 100+ communities. Paid endpoints use the x402 payment protocol (USDC on Solana).',
    contact: {
      name: 'Digital Gardener',
      url: 'https://digitalgardener.com',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: 'https://digitalgardener.com/api/v1',
      description: 'Production',
    },
  ],
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Health check',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    version: { type: 'string', example: '1.0.0' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/configs': {
      get: {
        operationId: 'listConfigs',
        summary: 'List public communities',
        description:
          'List all public community configs. Use the returned id or slug to query specific communities. Free endpoint.',
        tags: ['Discovery'],
        parameters: [
          {
            name: 'search',
            in: 'query',
            schema: { type: 'string' },
            description: 'Search term to filter by name or description',
          },
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string', enum: ['trending', 'newest', 'popular'] },
            description: 'Sort order',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20 },
            description: 'Maximum results',
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
            description: 'Pagination offset',
          },
        ],
        responses: {
          '200': {
            description: 'List of public community configs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    configs: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ConfigSummary' },
                    },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/configs/featured': {
      get: {
        operationId: 'getFeaturedConfigs',
        summary: 'List featured communities',
        description: 'Returns editorially curated featured community configs. Free endpoint.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'List of featured configs',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ConfigSummary' },
                },
              },
            },
          },
        },
      },
    },
    '/configs/{id}': {
      get: {
        operationId: 'getConfig',
        summary: 'Get community details',
        description:
          'Get full metadata for a community config including name, description, sources, date range, and monetization status. Accepts UUID or slug. Free endpoint.',
        tags: ['Discovery'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Config UUID or slug',
          },
        ],
        responses: {
          '200': {
            description: 'Config details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ConfigDetail' },
              },
            },
          },
          '404': { description: 'Config not found' },
        },
      },
    },
    '/configs/{id}/items/context': {
      get: {
        operationId: 'getItemsContext',
        summary: 'Get LLM-optimized plain-text context',
        description:
          'Get aggregated community context for a specific date as plain text optimized for LLM context windows. Requires x402 payment for monetized communities.',
        tags: ['Data'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Config UUID or slug',
          },
          {
            name: 'date',
            in: 'query',
            schema: { type: 'string', format: 'date' },
            description: 'Date to get context for (YYYY-MM-DD). Defaults to today.',
          },
          {
            name: 'maxLength',
            in: 'query',
            schema: { type: 'integer', default: 8000 },
            description: 'Maximum output length in characters',
          },
        ],
        responses: {
          '200': {
            description: 'LLM-optimized plain text context',
            content: {
              'text/plain': {
                schema: { type: 'string', description: 'LLM-optimized plain text context' },
              },
            },
          },
          '402': { $ref: '#/components/responses/PaymentRequired' },
          '404': { description: 'Config not found' },
        },
      },
    },
    '/configs/{id}/summary/json': {
      get: {
        operationId: 'getSummaryJson',
        summary: 'Get AI-generated summary (JSON)',
        description:
          'Get the AI-generated daily summary for a community as a structured JSON object including markdown, categories, and metadata. Requires x402 payment for monetized communities.',
        tags: ['Data'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Config UUID or slug',
          },
          {
            name: 'date',
            in: 'query',
            schema: { type: 'string', format: 'date' },
            description: 'Date to get summary for (YYYY-MM-DD). Defaults to today.',
          },
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string' },
            description: 'Summary type filter (e.g. "dailySummary")',
          },
        ],
        responses: {
          '200': {
            description: 'AI-generated community summary (JSON)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    markdown: { type: 'string', description: 'Summary in markdown format' },
                    date: { type: 'string', format: 'date' },
                    type: { type: 'string' },
                    categories: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          '402': { $ref: '#/components/responses/PaymentRequired' },
          '404': { description: 'Config or summary not found' },
        },
      },
    },
    '/configs/{id}/summary/md': {
      get: {
        operationId: 'getSummaryMd',
        summary: 'Get AI-generated summary (Markdown)',
        description:
          'Get the AI-generated daily summary for a community as raw Markdown text. Ideal for rendering or piping into other tools. Requires x402 payment for monetized communities.',
        tags: ['Data'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Config UUID or slug',
          },
          {
            name: 'date',
            in: 'query',
            schema: { type: 'string', format: 'date' },
            description: 'Date to get summary for (YYYY-MM-DD). Defaults to today.',
          },
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string' },
            description: 'Summary type filter (e.g. "dailySummary")',
          },
        ],
        responses: {
          '200': {
            description: 'AI-generated community summary as Markdown',
            content: {
              'text/markdown': {
                schema: { type: 'string', description: 'Raw Markdown summary text' },
              },
            },
          },
          '402': { $ref: '#/components/responses/PaymentRequired' },
          '404': { description: 'Config or summary not found' },
        },
      },
    },
    '/configs/{id}/topics': {
      get: {
        operationId: 'getTopics',
        summary: 'Get trending topics',
        description:
          'Get trending topic keywords with frequency counts. Useful for understanding current community discussions. Free endpoint.',
        tags: ['Discovery'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Config UUID or slug',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20 },
            description: 'Maximum topics to return',
          },
        ],
        responses: {
          '200': {
            description: 'List of trending topics with counts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    topics: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          topic: { type: 'string' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/configs/{id}/stats': {
      get: {
        operationId: 'getStats',
        summary: 'Get community statistics',
        description:
          'Get statistics including total content items, date range, active sources, and contributor counts. Free endpoint.',
        tags: ['Discovery'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Config UUID or slug',
          },
        ],
        responses: {
          '200': {
            description: 'Config statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalItems: { type: 'integer' },
                    dateRange: {
                      type: 'object',
                      properties: {
                        earliest: { type: 'string', format: 'date' },
                        latest: { type: 'string', format: 'date' },
                      },
                    },
                    sources: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/configs/{id}/items/json': {
      get: {
        operationId: 'getItemsJson',
        summary: 'Get raw content items (JSON)',
        description:
          'Get individual content items (messages, PRs, issues, commits) from a community as structured JSON. Returns a truncated preview for monetized communities without payment. Send X-Payment-Proof header (x402 protocol) for full per-request access.',
        tags: ['Data'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Config UUID or slug',
          },
          {
            name: 'source',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by source name',
          },
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by content type',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'Content items in JSON format (may be truncated preview without payment)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { type: 'object' } },
                    pagination: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        limit: { type: 'integer' },
                        offset: { type: 'integer' },
                        hasMore: { type: 'boolean' },
                      },
                    },
                    preview: {
                      type: 'boolean',
                      description: 'True if data is truncated (payment required for full access)',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/configs/{id}/items/md': {
      get: {
        operationId: 'getItemsMd',
        summary: 'Get raw content items (Markdown)',
        description:
          'Get individual content items as a single Markdown document. Each item is rendered as a ## section with source, date, type, body text, and optional link. Sections are separated by horizontal rules. Ideal for LLM ingestion or human reading.',
        tags: ['Data'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Config UUID or slug',
          },
          {
            name: 'source',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by source name',
          },
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by content type',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'Content items as a Markdown document',
            content: {
              'text/markdown': {
                schema: { type: 'string', description: 'Items rendered as Markdown sections' },
              },
            },
          },
        },
      },
    },
    '/search': {
      post: {
        operationId: 'semanticSearch',
        summary: 'Semantic search across community content',
        description:
          'Search community content using natural language queries. Powered by vector embeddings. Requires x402 payment for monetized communities.',
        tags: ['Search'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['configId', 'query'],
                properties: {
                  configId: {
                    type: 'string',
                    description: 'Community config ID to search in',
                  },
                  query: {
                    type: 'string',
                    description: 'Natural language search query',
                  },
                  limit: {
                    type: 'integer',
                    default: 10,
                    maximum: 50,
                    description: 'Maximum results',
                  },
                  threshold: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: 'Minimum similarity threshold',
                  },
                  type: {
                    type: 'string',
                    description: 'Filter by content type',
                  },
                  source: {
                    type: 'string',
                    description: 'Filter by source name',
                  },
                  afterDate: {
                    type: 'string',
                    format: 'date',
                    description: 'Only return results after this date',
                  },
                  beforeDate: {
                    type: 'string',
                    format: 'date',
                    description: 'Only return results before this date',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          title: { type: 'string' },
                          text: { type: 'string' },
                          source: { type: 'string' },
                          date: { type: 'string', format: 'date-time' },
                          similarity: { type: 'number' },
                          link: { type: 'string' },
                        },
                      },
                    },
                    totalFound: { type: 'integer' },
                    searchTimeMs: { type: 'number' },
                  },
                },
              },
            },
          },
          '402': { $ref: '#/components/responses/PaymentRequired' },
        },
      },
    },
  },
  components: {
    schemas: {
      ConfigSummary: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          slug: { type: 'string' },
          description: { type: 'string' },
          totalItems: { type: 'integer' },
          visibility: { type: 'string', enum: ['public', 'unlisted', 'private'] },
        },
      },
      ConfigDetail: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          slug: { type: 'string' },
          description: { type: 'string' },
          visibility: { type: 'string' },
          monetization_enabled: { type: 'boolean' },
          price_per_query: { type: 'number', description: 'Price per query in USDC (0 = free)' },
          totalItems: { type: 'integer' },
          dateRange: {
            type: 'object',
            properties: {
              earliest: { type: 'string', format: 'date' },
              latest: { type: 'string', format: 'date' },
            },
          },
        },
      },
      PaymentDetails: {
        type: 'object',
        description: 'x402 payment details returned in the 402 response body',
        properties: {
          amount: {
            type: 'string',
            description: 'Amount in smallest USDC unit (6 decimals). "1000" = 0.001 USDC.',
          },
          currency: { type: 'string', example: 'USDC' },
          network: { type: 'string', example: 'solana' },
          recipient: {
            type: 'string',
            description: 'Solana wallet address to send payment to',
          },
          platformWallet: {
            type: 'string',
            description: 'Platform wallet address (receives platform fee)',
          },
          platformFee: {
            type: 'string',
            description: 'Platform fee amount (deducted from total)',
          },
          facilitatorUrl: {
            type: 'string',
            description: 'pop402 facilitator URL for payment verification',
          },
          memo: {
            type: 'string',
            description:
              'Transaction memo. MUST be included in the Solana transaction for verification.',
          },
          expiresAt: {
            type: 'string',
            format: 'date-time',
            description: 'Payment offer expiration (5 minutes from request)',
          },
        },
      },
    },
    responses: {
      PaymentRequired: {
        description:
          'Payment required. Create a Solana USDC transaction with the specified amount, recipient, and memo. Then retry the request with the X-Payment-Proof header containing {"signature":"<tx_signature>","memo":"<memo>"}.',
        headers: {
          'X-Payment-Required': {
            schema: { type: 'string' },
            description: 'JSON string with full payment details',
          },
          'X-Payment-Amount': {
            schema: { type: 'string' },
            description: 'Payment amount in smallest USDC unit',
          },
          'X-Payment-Currency': {
            schema: { type: 'string' },
            description: 'Currency (USDC)',
          },
          'X-Payment-Network': {
            schema: { type: 'string' },
            description: 'Blockchain network (solana)',
          },
          'X-Payment-Recipient': {
            schema: { type: 'string' },
            description: 'Recipient Solana wallet address',
          },
          'X-Payment-Memo': {
            schema: { type: 'string' },
            description: 'Memo to include in the Solana transaction',
          },
          'X-Payment-Expires': {
            schema: { type: 'string', format: 'date-time' },
            description: 'Payment offer expiration timestamp',
          },
        },
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string', example: 'Payment Required' },
                code: { type: 'string', example: 'PAYMENT_REQUIRED' },
                payment: { $ref: '#/components/schemas/PaymentDetails' },
              },
            },
          },
        },
      },
    },
    securitySchemes: {
      x402Payment: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Payment-Proof',
        description:
          'x402 payment proof. JSON string: {"signature":"<solana_tx_signature>","memo":"<memo_from_402_response>"}',
      },
    },
  },
  tags: [
    {
      name: 'System',
      description: 'Health and status endpoints',
    },
    {
      name: 'Discovery',
      description: 'Free endpoints for discovering communities, topics, and statistics',
    },
    {
      name: 'Data',
      description:
        'Community data endpoints. May require x402 payment for monetized communities.',
    },
    {
      name: 'Search',
      description:
        'Semantic search across community content. May require x402 payment for monetized communities.',
    },
  ],
};

// =============================================================================
// AI Plugin Manifest (.well-known/ai-plugin.json)
// =============================================================================

const AI_PLUGIN_MANIFEST = {
  schema_version: 'v1',
  name_for_human: 'Digital Gardener',
  name_for_model: 'digital_gardener',
  description_for_human:
    'Community intelligence from Discord, GitHub, and Telegram. Get AI summaries, raw data, trending topics, and semantic search across 100+ communities.',
  description_for_model:
    'Access structured community intelligence data from Discord, GitHub, and Telegram. Use this to: (1) List available communities via GET /api/v1/configs, (2) Get free trending topics via GET /api/v1/configs/{id}/topics, (3) Get free statistics via GET /api/v1/configs/{id}/stats, (4) Get raw items as JSON via GET /api/v1/configs/{id}/items/json, as Markdown via /items/md, or as LLM-optimized plain text via /items/context (may require x402 USDC payment), (5) Get AI-generated summaries as JSON via GET /api/v1/configs/{id}/summary/json or as Markdown via /summary/md (may require x402 USDC payment), (6) Get generated content list as JSON via GET /api/v1/configs/{id}/content/json or as Markdown via /content/md, and a single content entry via /content/{contentId}/json or /content/{contentId}/md (may require x402 USDC payment), (7) Semantic search via POST /api/v1/search (may require x402 USDC payment). Paid endpoints return HTTP 402 with Solana USDC payment instructions. Send payment proof via X-Payment-Proof header.',
  api: {
    type: 'openapi',
    url: 'https://digitalgardener.com/api/v1/openapi.json',
  },
  auth: {
    type: 'none',
    instructions:
      'Free endpoints require no authentication. Paid data endpoints use the x402 payment protocol (USDC on Solana). When you receive a 402 response, create a Solana USDC transaction with the specified amount, recipient, and memo, then retry with the X-Payment-Proof header.',
  },
  logo_url: 'https://digitalgardener.com/logo.svg',
};

// =============================================================================
// Robots.txt
// =============================================================================

const ROBOTS_TXT = `User-agent: *
Allow: /api/v1/
Allow: /.well-known/
Disallow: /api/v1/admin/
Disallow: /api/v1/me/
Disallow: /api/v1/relay/
Disallow: /api/v1/local/

# Agent-readable API specification
# OpenAPI: https://digitalgardener.com/api/v1/openapi.json
# Plugin manifest: https://digitalgardener.com/.well-known/ai-plugin.json
`;

// =============================================================================
// Route handlers
// =============================================================================

/** GET /api/v1/openapi.json */
router.get('/openapi.json', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(OPENAPI_SPEC);
});

export { AI_PLUGIN_MANIFEST, ROBOTS_TXT };
export default router;
