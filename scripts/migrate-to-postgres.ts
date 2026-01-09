#!/usr/bin/env ts-node
// scripts/migrate-to-postgres.ts

/**
 * Migration script to move data from SQLite to PostgreSQL
 * 
 * This script:
 * 1. Reads content items and summaries from an SQLite database
 * 2. Creates a new config in the platform PostgreSQL database
 * 3. Migrates all data with the config association
 * 4. Optionally generates embeddings for existing content
 * 
 * Usage:
 *   ts-node scripts/migrate-to-postgres.ts \
 *     --sqlite=./data/my-config.db \
 *     --config-name="My Config" \
 *     --user-id=<user-uuid> \
 *     [--generate-embeddings]
 */

import * as path from 'path';
import * as fs from 'fs';
import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Parse command line arguments
interface MigrationArgs {
  sqlitePath: string;
  configName: string;
  userId: string;
  generateEmbeddings: boolean;
  dryRun: boolean;
}

function parseArgs(): MigrationArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<MigrationArgs> = {
    generateEmbeddings: false,
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--sqlite=')) {
      parsed.sqlitePath = arg.substring(9);
    } else if (arg.startsWith('--config-name=')) {
      parsed.configName = arg.substring(14);
    } else if (arg.startsWith('--user-id=')) {
      parsed.userId = arg.substring(10);
    } else if (arg === '--generate-embeddings') {
      parsed.generateEmbeddings = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help') {
      console.log(`
Usage: ts-node scripts/migrate-to-postgres.ts [options]

Options:
  --sqlite=<path>           Path to SQLite database file (required)
  --config-name=<name>      Name for the new config (required)
  --user-id=<uuid>          User ID to own the config (required)
  --generate-embeddings     Generate embeddings for content items
  --dry-run                 Show what would be migrated without actually migrating
  --help                    Show this help message
      `);
      process.exit(0);
    }
  }

  if (!parsed.sqlitePath || !parsed.configName || !parsed.userId) {
    console.error('Missing required arguments. Use --help for usage.');
    process.exit(1);
  }

  return parsed as MigrationArgs;
}

async function main() {
  const args = parseArgs();

  console.log('=== SQLite to PostgreSQL Migration ===\n');
  console.log(`SQLite Path: ${args.sqlitePath}`);
  console.log(`Config Name: ${args.configName}`);
  console.log(`User ID: ${args.userId}`);
  console.log(`Generate Embeddings: ${args.generateEmbeddings}`);
  console.log(`Dry Run: ${args.dryRun}`);
  console.log('');

  // Check SQLite file exists
  if (!fs.existsSync(args.sqlitePath)) {
    console.error(`SQLite file not found: ${args.sqlitePath}`);
    process.exit(1);
  }

  // Connect to SQLite
  console.log('Connecting to SQLite...');
  const sqliteDb = await open({
    filename: args.sqlitePath,
    driver: sqlite3.Database,
  });

  // Count items
  const itemCount = await sqliteDb.get<{ count: number }>('SELECT COUNT(*) as count FROM items');
  const summaryCount = await sqliteDb.get<{ count: number }>('SELECT COUNT(*) as count FROM summaries');
  
  console.log(`Found ${itemCount?.count || 0} items and ${summaryCount?.count || 0} summaries`);

  if (args.dryRun) {
    console.log('\n[DRY RUN] Would migrate the above data.');
    await sqliteDb.close();
    return;
  }

  // Connect to PostgreSQL
  console.log('\nConnecting to PostgreSQL...');
  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const pgClient = await pgPool.connect();

  try {
    await pgClient.query('BEGIN');

    // Generate config ID
    const configId = uuidv4();
    const slug = args.configName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');

    // Create config
    console.log(`Creating config with ID: ${configId}`);
    await pgClient.query(`
      INSERT INTO configs (id, user_id, name, slug, visibility, storage_type, config_json)
      VALUES ($1, $2, $3, $4, 'private', 'platform', $5)
    `, [configId, args.userId, args.configName, slug, JSON.stringify({})]);

    // Migrate items
    console.log('\nMigrating items...');
    const items = await sqliteDb.all('SELECT * FROM items');
    let migratedItems = 0;

    for (const item of items) {
      await pgClient.query(`
        INSERT INTO items (config_id, cid, type, source, title, text, link, topics, date, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (config_id, cid) DO NOTHING
      `, [
        configId,
        item.cid || uuidv4(),
        item.type,
        item.source,
        item.title,
        item.text,
        item.link,
        item.topics ? (typeof item.topics === 'string' ? JSON.parse(item.topics) : item.topics) : null,
        item.date,
        item.metadata ? (typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata) : null,
      ]);
      migratedItems++;

      if (migratedItems % 100 === 0) {
        console.log(`  Migrated ${migratedItems}/${items.length} items...`);
      }
    }
    console.log(`  Completed: ${migratedItems} items migrated`);

    // Migrate summaries
    console.log('\nMigrating summaries...');
    const summaries = await sqliteDb.all('SELECT * FROM summaries');
    let migratedSummaries = 0;

    for (const summary of summaries) {
      await pgClient.query(`
        INSERT INTO summaries (config_id, type, title, categories, markdown, date)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (config_id, type, date) DO NOTHING
      `, [
        configId,
        summary.type,
        summary.title,
        summary.categories ? (typeof summary.categories === 'string' ? JSON.parse(summary.categories) : summary.categories) : null,
        summary.markdown,
        summary.date,
      ]);
      migratedSummaries++;
    }
    console.log(`  Completed: ${migratedSummaries} summaries migrated`);

    // Update config stats
    await pgClient.query(`
      UPDATE configs SET total_items = $1 WHERE id = $2
    `, [migratedItems, configId]);

    await pgClient.query('COMMIT');
    console.log('\n=== Migration Completed Successfully ===');
    console.log(`Config ID: ${configId}`);
    console.log(`Slug: ${slug}`);

    // Generate embeddings if requested
    if (args.generateEmbeddings) {
      console.log('\nGenerating embeddings...');
      console.log('This may take a while for large datasets.');
      console.log('Run `npm run backfill-embeddings -- --config-id=' + configId + '` to generate embeddings separately.');
    }

  } catch (error) {
    await pgClient.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    pgClient.release();
    await pgPool.end();
    await sqliteDb.close();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
