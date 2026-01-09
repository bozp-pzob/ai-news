#!/usr/bin/env ts-node
// scripts/backfill-embeddings.ts

/**
 * Backfill embeddings for existing content items
 * 
 * This script generates vector embeddings for content items that don't have them.
 * It processes items in batches to avoid rate limits and memory issues.
 * 
 * Usage:
 *   ts-node scripts/backfill-embeddings.ts \
 *     --config-id=<uuid> \
 *     [--batch-size=50] \
 *     [--delay=1000]
 */

import { Pool } from 'pg';
import { embeddingService } from '../src/services/embeddingService';

// Parse command line arguments
interface BackfillArgs {
  configId: string;
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(): BackfillArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<BackfillArgs> = {
    batchSize: 50,
    delayMs: 1000,
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--config-id=')) {
      parsed.configId = arg.substring(12);
    } else if (arg.startsWith('--batch-size=')) {
      parsed.batchSize = parseInt(arg.substring(13));
    } else if (arg.startsWith('--delay=')) {
      parsed.delayMs = parseInt(arg.substring(8));
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help') {
      console.log(`
Usage: ts-node scripts/backfill-embeddings.ts [options]

Options:
  --config-id=<uuid>    Config ID to backfill embeddings for (required)
  --batch-size=<n>      Number of items per batch (default: 50)
  --delay=<ms>          Delay between batches in milliseconds (default: 1000)
  --dry-run             Show what would be processed without generating embeddings
  --help                Show this help message
      `);
      process.exit(0);
    }
  }

  if (!parsed.configId) {
    console.error('Missing required --config-id argument. Use --help for usage.');
    process.exit(1);
  }

  return parsed as BackfillArgs;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs();

  console.log('=== Embedding Backfill ===\n');
  console.log(`Config ID: ${args.configId}`);
  console.log(`Batch Size: ${args.batchSize}`);
  console.log(`Delay: ${args.delayMs}ms`);
  console.log(`Dry Run: ${args.dryRun}`);
  console.log('');

  // Check embedding service is configured
  if (!embeddingService.isConfigured()) {
    console.error('OPENAI_API_KEY is not set. Cannot generate embeddings.');
    process.exit(1);
  }

  // Connect to PostgreSQL
  console.log('Connecting to PostgreSQL...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Count items needing embeddings
    const countResult = await pool.query(`
      SELECT COUNT(*) as count FROM items 
      WHERE config_id = $1 AND embedding IS NULL
    `, [args.configId]);
    
    const totalCount = parseInt(countResult.rows[0].count);
    console.log(`Found ${totalCount} items without embeddings\n`);

    if (totalCount === 0) {
      console.log('No items need embeddings. Done!');
      return;
    }

    if (args.dryRun) {
      console.log(`[DRY RUN] Would generate embeddings for ${totalCount} items`);
      return;
    }

    let processed = 0;
    let failed = 0;
    let lastId = 0;

    while (processed + failed < totalCount) {
      // Fetch batch of items
      const batchResult = await pool.query(`
        SELECT id, title, text FROM items 
        WHERE config_id = $1 AND embedding IS NULL AND id > $2
        ORDER BY id ASC
        LIMIT $3
      `, [args.configId, lastId, args.batchSize]);

      const items = batchResult.rows;
      if (items.length === 0) break;

      // Prepare texts for embedding
      const texts: string[] = [];
      const itemIds: number[] = [];

      for (const item of items) {
        const parts: string[] = [];
        if (item.title) parts.push(item.title);
        if (item.text) parts.push(item.text);
        
        if (parts.length > 0) {
          texts.push(parts.join('\n\n'));
          itemIds.push(item.id);
        }
        lastId = item.id;
      }

      if (texts.length === 0) continue;

      try {
        // Generate embeddings
        console.log(`Processing batch ${Math.floor(processed / args.batchSize) + 1}: ${texts.length} items...`);
        const embeddings = await embeddingService.embedBatch(texts);

        // Update items with embeddings
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          
          for (let i = 0; i < embeddings.length; i++) {
            const embedding = embeddings[i];
            if (embedding && embedding.length > 0) {
              await client.query(`
                UPDATE items SET embedding = $1 WHERE id = $2
              `, [`[${embedding.join(',')}]`, itemIds[i]]);
              processed++;
            } else {
              failed++;
            }
          }
          
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

        console.log(`  Success: ${processed}/${totalCount} processed, ${failed} failed`);

        // Delay between batches
        if (processed + failed < totalCount) {
          await sleep(args.delayMs);
        }

      } catch (error) {
        console.error(`  Error processing batch:`, error);
        failed += texts.length;
        await sleep(args.delayMs * 2); // Longer delay after error
      }
    }

    console.log('\n=== Backfill Complete ===');
    console.log(`Processed: ${processed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Success rate: ${((processed / (processed + failed)) * 100).toFixed(1)}%`);

  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
