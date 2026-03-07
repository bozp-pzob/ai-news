import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { AggregatorService } from './services/aggregatorService';
import { WebSocketService } from './services/websocketService';
import { databaseService } from './services/databaseService';
import { externalConnectionService } from './services/externalConnections';
import { jobService } from './services/jobService';
import { userService } from './services/userService';
import { licenseService } from './services/licenseService';
import { cronService } from './services/cronService';
import { initQueues, closeQueues, scheduleRecurringAggregation } from './services/queueService';
import { startAggregationWorker, stopAggregationWorker } from './workers/aggregationWorker';
import v1Routes from './routes/v1';
import { errorMiddleware } from './middleware/errorMiddleware';
import { logger } from './helpers/cliHelper';

// Import pop402 payment middleware
// @ts-ignore - package may not have types
import { paymentMiddleware } from '@pop402/x402-express';
import { PRO_PLANS } from './services/licenseService';

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// pop402 configuration
const FACILITATOR_URL = process.env.POP402_FACILITATOR_URL || 'https://facilitator.pop402.com';
const NETWORK = process.env.POP402_NETWORK || 'solana';
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS || '';
const MOCK_MODE = process.env.POP402_MOCK_MODE === 'true';

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Configure pop402 protected routes for license purchases
// Each plan has its own endpoint with its specific price
const protectedRoutes: Record<string, any> = {};
for (const [planId, plan] of Object.entries(PRO_PLANS)) {
  protectedRoutes[`/api/v1/me/license/purchase/${planId}`] = {
    price: `$${plan.priceDisplay}`,
    network: NETWORK,
    config: {
      description: `Pro License - ${plan.name}`,
      mimeType: 'application/json',
    }
  };
}

// Debug middleware to log payment headers
app.use((req, res, next) => {
  if (req.path.includes('/license/purchase/')) {
    logger.info('pop402 Request to protected route:', {
      path: req.path,
      method: req.method,
      hasXPayment: !!req.headers['x-payment'],
      hasXPaymentMeta: !!req.headers['x-payment-meta'],
      xPaymentMetaPreview: req.headers['x-payment-meta'] 
        ? Buffer.from(req.headers['x-payment-meta'] as string, 'base64').toString().slice(0, 200) + '...'
        : null,
    });
  }
  next();
});

// Apply pop402 payment middleware at app level (only if configured and not mock mode)
if (!MOCK_MODE && PLATFORM_WALLET) {
  logger.info('pop402 Payment middleware enabled:', {
    platformWallet: PLATFORM_WALLET.slice(0, 8) + '...',
    facilitatorUrl: FACILITATOR_URL,
    network: NETWORK,
    protectedRoutes: Object.keys(protectedRoutes),
  });
  
  app.use(paymentMiddleware(PLATFORM_WALLET, protectedRoutes, { url: FACILITATOR_URL }));
} else if (MOCK_MODE) {
  logger.info('pop402 Mock mode - payment middleware disabled');
} else {
  logger.warn('pop402 PLATFORM_WALLET_ADDRESS not set - payment middleware disabled');
}

// Serve static files from the frontend build directory
app.use(express.static(path.join(__dirname, '../frontend/build')));

// API v1 routes (multi-tenant platform)
app.use('/api/v1', v1Routes);

// Initialize services
const aggregatorService = AggregatorService.getInstance();

// Initialize WebSocket service
const webSocketService = new WebSocketService(server, aggregatorService);

// Legacy routes removed - all API access goes through /api/v1 routes
// See src/routes/v1/ for the platform API

// Agent discovery routes (served before the SPA catch-all)
import { AI_PLUGIN_MANIFEST, ROBOTS_TXT } from './routes/v1/discovery';

app.get('/.well-known/ai-plugin.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(AI_PLUGIN_MANIFEST);
});

app.get('/robots.txt', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send(ROBOTS_TXT);
});

// Centralized error handling for API routes
// Must be registered after all API routes but before the SPA catch-all
app.use('/api', errorMiddleware);

// ── OG Meta Tag Injection for Social Crawlers ────────────────────
// When a bot (Twitter, Facebook, Slack, Discord) requests /configs/:slug,
// we serve a minimal HTML page with OG meta tags so the link preview shows
// the config name, description, and latest summary stats.
// Human browsers still get the full React SPA (the SPA catch-all below).
const SOCIAL_CRAWLER_RE = /Twitterbot|facebookexternalhit|Facebot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Googlebot|bingbot/i;

app.get('/configs/:slugOrId', async (req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (!SOCIAL_CRAWLER_RE.test(ua)) {
    // Not a social crawler — fall through to the SPA catch-all
    return next();
  }

  try {
    const { slugOrId } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
    const query = isUUID
      ? 'SELECT name, slug, description, visibility, total_items, total_queries FROM configs WHERE id = $1'
      : 'SELECT name, slug, description, visibility, total_items, total_queries FROM configs WHERE slug = $1';

    const result = await databaseService.query(query, [slugOrId]);
    if (result.rows.length === 0 || result.rows[0].visibility === 'private') {
      return next(); // fall through to SPA
    }

    const config = result.rows[0];
    const siteUrl = process.env.SITE_URL || `https://${req.headers.host || 'digitalgardener.com'}`;
    const pageUrl = `${siteUrl}/configs/${config.slug}`;
    const title = `${config.name} — Digital Gardener`;
    const desc = config.description
      || `${config.total_items || 0} items collected, ${config.total_queries || 0} queries served.`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:site_name" content="Digital Gardener" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(desc)}" />
  <meta http-equiv="refresh" content="0; url=${escapeHtml(pageUrl)}" />
</head>
<body><p>Redirecting to <a href="${escapeHtml(pageUrl)}">${escapeHtml(config.name)}</a></p></body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(html);
  } catch (error) {
    logger.error('OG meta injection error (falling through to SPA)', error);
    return next();
  }
});

/** Escape HTML special chars for safe embedding in attribute values */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Serve the React app for any other routes (catch-all)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

// Local server key for encrypted config execution
// The key is generated once on startup (or loaded from env) and used to decrypt
// configs sent from the hosted UI via the relay endpoint.
let _localServerKey: string | null = null;

export function getLocalServerKey(): string | null {
  return _localServerKey;
}

/**
 * Restore cron schedules from the database into BullMQ repeatable jobs.
 * Called on startup after queues are initialized.
 */
async function restoreScheduledJobs() {
  try {
    const scheduledConfigs = await userService.getScheduledConfigs();
    logger.info(`Startup: Found ${scheduledConfigs.length} configs with cron schedules`);

    for (const config of scheduledConfigs) {
      try {
        await scheduleRecurringAggregation(config.id, config.userId, config.cronExpression, config.timezone || 'UTC');
        logger.info(`Startup: Restored schedule for config ${config.name} (${config.cronExpression}, ${config.timezone || 'UTC'})`);
      } catch (error) {
        logger.error(`Startup: Failed to restore schedule for config ${config.id}`, error);
      }
    }

    logger.info('Startup: Finished restoring scheduled jobs');
  } catch (error) {
    logger.error('Startup: Error restoring scheduled jobs', error);
  }
}

// Initialize database and start server
async function start() {
  try {
    // Load or generate the local server key for encrypted config execution.
    // Precedence: 1) LOCAL_SERVER_KEY env var  2) persisted key file  3) generate new
    const keyFile = path.join(process.cwd(), 'data', '.local-server-key');

    if (process.env.LOCAL_SERVER_KEY) {
      // Explicit env var takes priority
      _localServerKey = process.env.LOCAL_SERVER_KEY;
      logger.info('Local server key loaded from LOCAL_SERVER_KEY env var');
    } else if (fs.existsSync(keyFile)) {
      // Reuse the previously persisted key
      _localServerKey = fs.readFileSync(keyFile, 'utf-8').trim();
      logger.info(`Local server key loaded from ${keyFile}`);
    } else {
      // First run — generate a new key and persist it
      _localServerKey = crypto.randomBytes(32).toString('base64');
      const keyDir = path.dirname(keyFile);
      if (!fs.existsSync(keyDir)) {
        fs.mkdirSync(keyDir, { recursive: true });
      }
      fs.writeFileSync(keyFile, _localServerKey, { mode: 0o600 });
      logger.info(`Local server key generated and saved to ${keyFile}`);
      logger.info('  Delete that file or set LOCAL_SERVER_KEY env var to use a different key.');
    }

    // Always log the key on startup so the user can find it
    logger.info('');
    logger.info('  Local Server Key (paste this into the platform UI):');
    logger.info(`  ${_localServerKey}`);
    logger.info('');

    // Initialize platform database if DATABASE_URL is set
    if (process.env.DATABASE_URL) {
      await databaseService.initPlatformDatabase();
      logger.info('Platform database initialized');
      
      // Initialize external connection service (Discord bot, Telegram bot, etc.)
      // This starts the bots so they can receive events
      await externalConnectionService.initialize();
      logger.info('External connection service initialized');
      
      // Initialize BullMQ queues + worker if Redis is configured
      if (process.env.REDIS_URL) {
        try {
          await initQueues();
          await startAggregationWorker();
          logger.info('BullMQ queues and aggregation worker initialized');
          
          // Restore cron schedules from the database into BullMQ
          await restoreScheduledJobs();
        } catch (error) {
          logger.warn('Failed to initialize BullMQ (Redis may be unavailable). Falling back to in-process execution.', error);
        }
      } else {
        logger.info('REDIS_URL not set — BullMQ disabled, using in-process execution');
      }
      
      // Resume running continuous jobs
      await resumeRunningJobs();
      
      // Start cron jobs (job pruning, pro validation)
      cronService.startCronJobs();
    }

    // Start the server
    server.listen(port, () => {
      logger.info(`API server running on port ${port}`);
      logger.info(`Frontend served at http://localhost:${port}`);
      logger.info(`API v1 available at http://localhost:${port}/api/v1`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Resume running continuous jobs on server startup
 * Also validates that users still have pro licenses
 */
async function resumeRunningJobs() {
  try {
    const runningJobs = await jobService.getRunningJobs();
    logger.info(`Startup: Found ${runningJobs.length} running jobs to process`);
    
    for (const job of runningJobs) {
      if (job.jobType === 'continuous') {
        // Verify user still has pro license
        let hasProLicense = false;
        
        try {
          const user = await userService.getUserById(job.userId);
          if (user?.tier === 'admin') {
            hasProLicense = true;
          } else if (user?.walletAddress) {
            const license = await licenseService.verifyLicense(user.walletAddress);
            hasProLicense = license.isActive;
          }
        } catch (error) {
          logger.error(`Startup: Error checking user ${job.userId}:`, error);
        }
        
        if (!hasProLicense) {
          // User lost pro, stop the continuous job
          logger.info(`Startup: User ${job.userId} no longer has pro license, cancelling job ${job.id}`);
          await jobService.cancelJob(job.id);
          await jobService.addJobLog(job.id, 'warn', 'Continuous job cancelled - Pro license no longer active');
          continue;
        }
        
        // Resume the continuous job
        logger.info(`Startup: Resuming continuous job ${job.id} for config ${job.configId}`);
        
        try {
          // Load config metadata (needed for name, storageType, etc.)
          const config = await userService.getConfigById(job.configId);
          if (!config) {
            logger.error(`Startup: Config ${job.configId} not found for job ${job.id}`);
            await jobService.failJob(job.id, 'Config not found during resume');
            continue;
          }
          
          // Try to load the encrypted resolved config/secrets from the job record first.
          // These contain the fully-resolved config (with all $SECRET:uuid$ references and
          // platform credentials already injected) from when the job was originally started.
          const resolvedConfig = await jobService.getJobResolvedConfig(job.id);
          const resolvedSecrets = await jobService.getJobResolvedSecrets(job.id);
          
          let configJson: any;
          let secrets: Record<string, string>;
          
          if (resolvedConfig && resolvedSecrets) {
            // Use the encrypted resolved config — all secrets are already baked in.
            // Re-inject platform credentials since env vars may have rotated since last start.
            logger.info(`Startup: Using encrypted resolved config for job ${job.id}`);
            configJson = resolvedConfig;
            secrets = resolvedSecrets;
            
            const user = await userService.getUserById(job.userId);
            const isAdmin = user?.tier === 'admin';
            
            // Re-inject platform AI credentials (env vars may have changed)
            const usesPlatformAI = configJson.ai?.some((ai: any) => ai.params?.usePlatformAI === true);
            if (isAdmin || usesPlatformAI) {
              const model = process.env.PRO_TIER_AI_MODEL || 'openai/gpt-4o';
              const platformApiKey = process.env.OPENAI_API_KEY;
              const siteUrl = process.env.SITE_URL || '';
              const siteName = process.env.SITE_NAME || '';

              configJson.ai = configJson.ai?.map((ai: any) => {
                if (ai.params?.usePlatformAI || isAdmin) {
                  return {
                    ...ai,
                    params: {
                      ...ai.params,
                      model,
                      apiKey: platformApiKey,
                      useOpenRouter: true,
                      siteUrl,
                      siteName,
                    }
                  };
                }
                return ai;
              }) || [];
            }

            // Re-inject platform storage credentials (env vars may have changed)
            const usesPlatformStorage = configJson.storage?.some((s: any) => s.params?.usePlatformStorage === true);
            if (config.storageType === 'platform' || isAdmin || usesPlatformStorage) {
              const platformDbUrl = process.env.DATABASE_URL;
              configJson.storage = configJson.storage?.map((storage: any) => {
                if (storage.params?.usePlatformStorage || config.storageType === 'platform' || isAdmin) {
                  return {
                    ...storage,
                    params: {
                      ...storage.params,
                      configId: job.configId,
                      connectionString: platformDbUrl,
                    }
                  };
                }
                return storage;
              }) || [];
            }
          } else {
            // Legacy fallback: no encrypted resolved config on the job.
            // Load from configs table and re-inject platform credentials.
            // NOTE: $SECRET:uuid$ references in config_json won't resolve correctly,
            // but ALL_CAPS and process.env.X references will work.
            logger.info(`Startup: No encrypted resolved config for job ${job.id}, using legacy fallback`);
            secrets = await userService.getConfigSecrets(job.configId) || {};
            configJson = config.configJson as any;

            const user = await userService.getUserById(job.userId);
            const isAdmin = user?.tier === 'admin';

            // Inject platform AI credentials
            const usesPlatformAI = configJson.ai?.some((ai: any) => ai.params?.usePlatformAI === true);
            if (isAdmin || usesPlatformAI) {
              const model = process.env.PRO_TIER_AI_MODEL || 'openai/gpt-4o';
              const platformApiKey = process.env.OPENAI_API_KEY;
              const siteUrl = process.env.SITE_URL || '';
              const siteName = process.env.SITE_NAME || '';

              configJson.ai = configJson.ai?.map((ai: any) => {
                if (ai.params?.usePlatformAI || isAdmin) {
                  return {
                    ...ai,
                    params: {
                      ...ai.params,
                      model,
                      apiKey: platformApiKey,
                      useOpenRouter: true,
                      siteUrl,
                      siteName,
                    }
                  };
                }
                return ai;
              }) || [];
            }

            // Inject platform storage credentials (configId for multi-tenant isolation)
            const usesPlatformStorage = configJson.storage?.some((s: any) => s.params?.usePlatformStorage === true);
            if (config.storageType === 'platform' || isAdmin || usesPlatformStorage) {
              const platformDbUrl = process.env.DATABASE_URL;
              configJson.storage = configJson.storage?.map((storage: any) => {
                if (storage.params?.usePlatformStorage || config.storageType === 'platform' || isAdmin) {
                  return {
                    ...storage,
                    params: {
                      ...storage.params,
                      configId: job.configId,
                      connectionString: platformDbUrl,
                    }
                  };
                }
                return storage;
              }) || [];
            }
          }
          
          // Start the continuous job (using existing job ID to resume)
          await aggregatorService.startContinuousJob(
            job.configId,
            job.userId,
            config.name,
            configJson,
            { runOnce: false },
            secrets,
            job.globalInterval,
            job.id // Pass existing job ID to resume
          );
          
          await jobService.addJobLog(job.id, 'info', 'Continuous job resumed after server restart');
          logger.info(`Startup: Successfully resumed job ${job.id}`);
        } catch (error) {
          logger.error(`Startup: Error resuming job ${job.id}:`, error);
          await jobService.failJob(job.id, `Failed to resume after restart: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else {
        // One-time job was interrupted - mark as failed
        logger.info(`Startup: Marking interrupted one-time job ${job.id} as failed`);
        await jobService.failJob(job.id, 'Server restarted during execution');
      }
    }
    
    logger.info('Startup: Finished processing running jobs');
  } catch (error) {
    logger.error('Startup: Error resuming running jobs:', error);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  cronService.stopCronJobs();
  await stopAggregationWorker();
  await closeQueues();
  await externalConnectionService.shutdown();
  await databaseService.closeAllConnections();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});