#!/usr/bin/env ts-node
// scripts/check-duplicates.ts

/**
 * Check for duplicate/overlapping records in the items table for a given config.
 *
 * Checks performed:
 * 1. Duplicate CIDs (same cid appearing multiple times)
 * 2. Items with NULL cids (bypass unique constraint)
 * 3. Content-level duplicates (same text content stored under different cids)
 * 4. Near-duplicate detection (same source + type + date)
 *
 * Usage:
 *   npm run check-duplicates -- --config-id=<uuid> [--fix] [--dry-run] [--verbose]
 *
 * Options:
 *   --config-id=<uuid>  Required. The config UUID to check.
 *   --fix               Delete duplicate rows, keeping the oldest (lowest id).
 *   --dry-run           Show what --fix would do without deleting anything.
 *   --verbose           Show full details of duplicate records.
 */

import { Pool } from 'pg';

interface Args {
  configId: string;
  fix: boolean;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Partial<Args> = {
    fix: false,
    dryRun: false,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--config-id=')) {
      parsed.configId = arg.substring(12);
    } else if (arg === '--fix') {
      parsed.fix = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--verbose') {
      parsed.verbose = true;
    }
  }

  if (!parsed.configId) {
    console.error('Error: --config-id=<uuid> is required');
    console.error(
      'Usage: npm run check-duplicates -- --config-id=<uuid> [--fix] [--dry-run] [--verbose]'
    );
    process.exit(1);
  }

  return parsed as Args;
}

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('Error: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log(`\n=== Duplicate Check for Config: ${args.configId} ===\n`);

    // Verify config exists
    const configResult = await pool.query(
      'SELECT id, name, slug, total_items, status FROM configs WHERE id = $1',
      [args.configId]
    );

    if (configResult.rows.length === 0) {
      console.error(`Config ${args.configId} not found in database.`);
      process.exit(1);
    }

    const config = configResult.rows[0];
    console.log(`Config: "${config.name}" (${config.slug})`);
    console.log(`Status: ${config.status} | Tracked total_items: ${config.total_items}`);

    // Actual item count
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM items WHERE config_id = $1',
      [args.configId]
    );
    const actualCount = parseInt(countResult.rows[0].count);
    console.log(`Actual items in DB: ${actualCount}`);

    if (actualCount !== config.total_items) {
      console.log(
        `\u26a0  Mismatch: configs.total_items (${config.total_items}) != actual count (${actualCount})`
      );
    }
    console.log('');

    let totalDuplicateRows = 0;
    const idsToDelete: number[] = [];

    // ── Check 1: Duplicate CIDs ──────────────────────────────────
    console.log('\u2500\u2500 Check 1: Duplicate CIDs \u2500\u2500');
    const dupeCids = await pool.query(
      `SELECT cid, COUNT(*) as cnt, array_agg(id ORDER BY id) as ids
       FROM items
       WHERE config_id = $1 AND cid IS NOT NULL
       GROUP BY cid
       HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC`,
      [args.configId]
    );

    if (dupeCids.rows.length === 0) {
      console.log('\u2713 No duplicate CIDs found.\n');
    } else {
      const dupeRowCount = dupeCids.rows.reduce(
        (sum: number, r: any) => sum + (parseInt(r.cnt) - 1),
        0
      );
      console.log(
        `\u2717 Found ${dupeCids.rows.length} CIDs with duplicates (${dupeRowCount} extra rows)\n`
      );
      totalDuplicateRows += dupeRowCount;

      for (const row of dupeCids.rows) {
        const ids = row.ids as number[];
        const keep = ids[0]; // Keep the oldest (lowest id)
        const remove = ids.slice(1);
        idsToDelete.push(...remove);

        if (args.verbose || dupeCids.rows.length <= 20) {
          console.log(
            `  cid: "${row.cid}" \u2192 ${row.cnt} copies (keep id=${keep}, remove ids=[${remove.join(', ')}])`
          );
        }
      }

      if (!args.verbose && dupeCids.rows.length > 20) {
        console.log(`  ... and ${dupeCids.rows.length - 20} more (use --verbose to see all)`);
      }
      console.log('');
    }

    // ── Check 2: NULL CIDs ───────────────────────────────────────
    console.log('\u2500\u2500 Check 2: Items with NULL CID \u2500\u2500');
    const nullCids = await pool.query(
      `SELECT COUNT(*) as count FROM items WHERE config_id = $1 AND cid IS NULL`,
      [args.configId]
    );
    const nullCount = parseInt(nullCids.rows[0].count);

    if (nullCount === 0) {
      console.log('\u2713 No items with NULL cid.\n');
    } else {
      console.log(
        `\u26a0  Found ${nullCount} items with NULL cid (these bypass unique constraints)\n`
      );

      if (args.verbose) {
        const nullItems = await pool.query(
          `SELECT id, type, source, title, date, created_at
           FROM items
           WHERE config_id = $1 AND cid IS NULL
           ORDER BY id
           LIMIT 20`,
          [args.configId]
        );
        for (const item of nullItems.rows) {
          console.log(
            `  id=${item.id} type=${item.type} source=${item.source} title="${(item.title || '').substring(0, 60)}"`
          );
        }
        if (nullCount > 20) {
          console.log(`  ... and ${nullCount - 20} more`);
        }
        console.log('');
      }
    }

    // ── Check 3: Content-level duplicates (same text, different cids) ──
    console.log('\u2500\u2500 Check 3: Content-level Duplicates (same text, different CID) \u2500\u2500');
    const contentDupes = await pool.query(
      `SELECT md5(text) as text_hash, COUNT(*) as cnt,
              array_agg(id ORDER BY id) as ids,
              array_agg(cid ORDER BY id) as cids,
              MIN(LEFT(text, 100)) as text_preview
       FROM items
       WHERE config_id = $1 AND text IS NOT NULL AND text != ''
       GROUP BY md5(text)
       HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC
       LIMIT 50`,
      [args.configId]
    );

    if (contentDupes.rows.length === 0) {
      console.log('\u2713 No content-level duplicates found.\n');
    } else {
      const contentDupeRows = contentDupes.rows.reduce(
        (sum: number, r: any) => sum + (parseInt(r.cnt) - 1),
        0
      );
      console.log(
        `\u26a0  Found ${contentDupes.rows.length} groups of content duplicates (${contentDupeRows} extra rows)\n`
      );

      const limit = args.verbose ? 50 : 10;
      for (const row of contentDupes.rows.slice(0, limit)) {
        console.log(`  Text hash: ${row.text_hash} \u2192 ${row.cnt} copies`);
        console.log(`    IDs: [${(row.ids as number[]).join(', ')}]`);
        console.log(
          `    CIDs: [${(row.cids as string[]).map((c: string) => `"${c}"`).join(', ')}]`
        );
        console.log(`    Preview: "${row.text_preview}..."`);
      }
      if (!args.verbose && contentDupes.rows.length > 10) {
        console.log(
          `  ... and ${contentDupes.rows.length - 10} more groups (use --verbose to see all)`
        );
      }
      console.log('');
    }

    // ── Check 4: Near-duplicates (same source + type + date) ─────
    console.log('\u2500\u2500 Check 4: Near-Duplicates (same source + type + date) \u2500\u2500');
    const nearDupes = await pool.query(
      `SELECT source, type, date, COUNT(*) as cnt,
              array_agg(id ORDER BY id) as ids,
              array_agg(cid ORDER BY id) as cids
       FROM items
       WHERE config_id = $1
       GROUP BY source, type, date
       HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC
       LIMIT 50`,
      [args.configId]
    );

    if (nearDupes.rows.length === 0) {
      console.log('\u2713 No near-duplicates found.\n');
    } else {
      const nearDupeRows = nearDupes.rows.reduce(
        (sum: number, r: any) => sum + (parseInt(r.cnt) - 1),
        0
      );
      console.log(
        `\u26a0  Found ${nearDupes.rows.length} groups sharing source+type+date (${nearDupeRows} extra rows)\n`
      );

      const limit = args.verbose ? 50 : 10;
      for (const row of nearDupes.rows.slice(0, limit)) {
        const dateStr = row.date
          ? new Date(parseInt(row.date) * 1000).toISOString()
          : 'NULL';
        console.log(
          `  ${row.source}/${row.type} @ ${dateStr} \u2192 ${row.cnt} items (ids: [${(row.ids as number[]).join(', ')}])`
        );
      }
      if (!args.verbose && nearDupes.rows.length > 10) {
        console.log(`  ... and ${nearDupes.rows.length - 10} more (use --verbose to see all)`);
      }
      console.log('');
    }

    // ── Check 5: Breakdown by source and type ────────────────────
    console.log('\u2500\u2500 Breakdown by Source/Type \u2500\u2500');
    const breakdown = await pool.query(
      `SELECT source, type, COUNT(*) as count,
              COUNT(DISTINCT cid) as unique_cids,
              COUNT(*) - COUNT(DISTINCT cid) as potential_dupes
       FROM items
       WHERE config_id = $1
       GROUP BY source, type
       ORDER BY count DESC`,
      [args.configId]
    );

    if (breakdown.rows.length > 0) {
      console.log(
        '  Source              | Type                     | Total  | Unique CIDs | Potential Dupes'
      );
      console.log(
        '  -------------------|--------------------------|--------|-------------|----------------'
      );
      for (const row of breakdown.rows) {
        const src = (row.source || '').padEnd(19);
        const typ = (row.type || '').padEnd(24);
        const total = String(row.count).padStart(6);
        const unique = String(row.unique_cids).padStart(11);
        const dupes = String(row.potential_dupes).padStart(15);
        console.log(`  ${src} | ${typ} | ${total} | ${unique} | ${dupes}`);
      }
    }
    console.log('');

    // ── Summary ──────────────────────────────────────────────────
    console.log('\u2550'.repeat(47));
    console.log(`Total items: ${actualCount}`);
    console.log(`Duplicate CID rows to remove: ${idsToDelete.length}`);
    console.log(`NULL CID items: ${nullCount}`);
    console.log(`Content-level duplicate groups: ${contentDupes.rows.length}`);
    console.log('\u2550'.repeat(47));
    console.log('');

    // ── Fix mode ─────────────────────────────────────────────────
    if (idsToDelete.length > 0 && (args.fix || args.dryRun)) {
      if (args.dryRun) {
        console.log(
          `[DRY RUN] Would delete ${idsToDelete.length} duplicate rows (ids: ${idsToDelete.slice(0, 20).join(', ')}${idsToDelete.length > 20 ? '...' : ''})`
        );
      } else if (args.fix) {
        console.log(`Deleting ${idsToDelete.length} duplicate rows...`);

        // Delete in batches of 500
        const batchSize = 500;
        let deleted = 0;
        for (let i = 0; i < idsToDelete.length; i += batchSize) {
          const batch = idsToDelete.slice(i, i + batchSize);
          const result = await pool.query(
            `DELETE FROM items WHERE id = ANY($1::int[]) AND config_id = $2`,
            [batch, args.configId]
          );
          deleted += result.rowCount || 0;
          console.log(
            `  Deleted batch ${Math.floor(i / batchSize) + 1}: ${result.rowCount} rows`
          );
        }

        console.log(`\n\u2713 Deleted ${deleted} duplicate rows total.`);

        // Verify final count
        const finalCount = await pool.query(
          'SELECT COUNT(*) as count FROM items WHERE config_id = $1',
          [args.configId]
        );
        console.log(`Final item count: ${finalCount.rows[0].count}`);

        // Fix the total_items counter on the config
        await pool.query('UPDATE configs SET total_items = $1 WHERE id = $2', [
          parseInt(finalCount.rows[0].count),
          args.configId,
        ]);
        console.log(`Updated configs.total_items to ${finalCount.rows[0].count}`);
      }
    } else if (idsToDelete.length > 0) {
      console.log(
        `Run with --fix to delete ${idsToDelete.length} duplicate CID rows, or --dry-run to preview.`
      );
    }

    if (
      idsToDelete.length === 0 &&
      nullCount === 0 &&
      contentDupes.rows.length === 0
    ) {
      console.log('\u2713 No duplicates found. All records are unique.');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
