#!/usr/bin/env ts-node
// scripts/bootstrap-admin.ts

/**
 * Bootstrap script to set up the initial admin user
 * 
 * This script promotes a user to admin tier based on their email address.
 * 
 * Usage:
 *   npx ts-node scripts/bootstrap-admin.ts --email=bozp.eth@gmail.com
 *   npx ts-node scripts/bootstrap-admin.ts --email=bozp.eth@gmail.com --dry-run
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface BootstrapArgs {
  email: string;
  dryRun: boolean;
}

function parseArgs(): BootstrapArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<BootstrapArgs> = {
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      parsed.email = arg.substring(8);
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    }
  }

  if (!parsed.email) {
    console.error('Usage: npx ts-node scripts/bootstrap-admin.ts --email=<email> [--dry-run]');
    console.error('');
    console.error('Options:');
    console.error('  --email=<email>   Email address of the user to promote to admin');
    console.error('  --dry-run         Show what would be done without making changes');
    process.exit(1);
  }

  return parsed as BootstrapArgs;
}

async function main(): Promise<void> {
  const args = parseArgs();
  
  console.log('='.repeat(60));
  console.log('Admin Bootstrap Script');
  console.log('='.repeat(60));
  console.log(`Email: ${args.email}`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log('');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    // Check if user exists
    const userResult = await pool.query(
      'SELECT id, email, tier, wallet_address, created_at FROM users WHERE LOWER(email) = LOWER($1)',
      [args.email]
    );

    if (userResult.rows.length === 0) {
      console.error(`ERROR: No user found with email "${args.email}"`);
      console.log('');
      console.log('The user must sign up first before being promoted to admin.');
      console.log('');
      
      // Show existing users for reference
      const allUsersResult = await pool.query(
        'SELECT email, tier FROM users ORDER BY created_at DESC LIMIT 10'
      );
      
      if (allUsersResult.rows.length > 0) {
        console.log('Recent users in the system:');
        for (const user of allUsersResult.rows) {
          console.log(`  - ${user.email || '(no email)'} [${user.tier}]`);
        }
      }
      
      process.exit(1);
    }

    const user = userResult.rows[0];
    console.log('User found:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Wallet: ${user.wallet_address || '(none)'}`);
    console.log(`  Current tier: ${user.tier}`);
    console.log(`  Created: ${user.created_at}`);
    console.log('');

    if (user.tier === 'admin') {
      console.log('User is already an admin. No changes needed.');
      process.exit(0);
    }

    if (args.dryRun) {
      console.log('[DRY RUN] Would update user tier to "admin"');
      console.log('');
      console.log('Run without --dry-run to apply changes.');
    } else {
      await pool.query(
        'UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2',
        ['admin', user.id]
      );
      
      console.log('SUCCESS: User promoted to admin!');
      console.log('');
      console.log('The user now has:');
      console.log('  - Unlimited configs');
      console.log('  - Unlimited runs per day');
      console.log('  - Unlimited AI calls');
      console.log('  - Access to admin dashboard');
      console.log('  - Ability to manage other users');
    }

  } catch (error) {
    console.error('Database error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
