-- ============================================================
-- Migration 010: ainews database — schema completion
-- ============================================================
-- Targets the `ainews` database (users.id is already UUID).
-- Adds missing columns, creates missing tables, indexes,
-- functions, triggers, views, and stamps Drizzle baseline.
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS).
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 1: Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- PHASE 2: Add missing columns to users
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_calls_today INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_calls_today_reset_at DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS tokens_used_today INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_used_today_reset_at DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS estimated_cost_today_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_run_used_at DATE,
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_reason TEXT;

-- ============================================================
-- PHASE 3: Add missing columns to configs
-- ============================================================
ALTER TABLE configs
  ADD COLUMN IF NOT EXISTS global_interval INTEGER,
  ADD COLUMN IF NOT EXISTS active_job_id UUID,
  ADD COLUMN IF NOT EXISTS cron_expression TEXT,
  ADD COLUMN IF NOT EXISTS schedule_timezone TEXT DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_local_execution BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_items BOOLEAN DEFAULT FALSE;

-- ============================================================
-- PHASE 4: Add missing columns to aggregation_jobs
-- ============================================================
ALTER TABLE aggregation_jobs
  ADD COLUMN IF NOT EXISTS job_type TEXT DEFAULT 'one-time',
  ADD COLUMN IF NOT EXISTS global_interval INTEGER,
  ADD COLUMN IF NOT EXISTS run_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_fetch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_prompt_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_completion_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ai_calls INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(10,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_config_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS resolved_secrets_encrypted BYTEA;

-- Add CHECK constraint on job_type if not already present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aggregation_jobs_job_type_check'
  ) THEN
    ALTER TABLE aggregation_jobs
      ADD CONSTRAINT aggregation_jobs_job_type_check
        CHECK (job_type IN ('one-time', 'continuous'));
  END IF;
END $$;

-- ============================================================
-- PHASE 5: Add missing columns to summaries
-- ============================================================
ALTER TABLE summaries
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS start_date BIGINT,
  ADD COLUMN IF NOT EXISTS end_date BIGINT,
  ADD COLUMN IF NOT EXISTS granularity TEXT DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd REAL;

-- ============================================================
-- PHASE 6: Create missing tables
-- ============================================================

-- Webhook buffer
CREATE TABLE IF NOT EXISTS webhook_buffer (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  content_type TEXT,
  headers JSONB,
  source_ip TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ
);

-- Webhook configs
CREATE TABLE IF NOT EXISTS webhook_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id TEXT NOT NULL UNIQUE,
  webhook_secret TEXT NOT NULL,
  config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
  source_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outbound webhooks
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{job.completed,job.failed}',
  signing_secret TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  description TEXT,
  last_triggered_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  total_deliveries INTEGER DEFAULT 0,
  total_successes INTEGER DEFAULT 0,
  total_failures INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outbound webhook deliveries
CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id UUID NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  error TEXT,
  duration_ms INTEGER,
  delivered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Site parsers
CREATE TABLE IF NOT EXISTS site_parsers (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  path_pattern TEXT NOT NULL,
  parser_code TEXT NOT NULL,
  object_type_string TEXT,
  version INTEGER DEFAULT 1,
  consecutive_failures INTEGER DEFAULT 0,
  last_success_at BIGINT,
  last_failure_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  sample_url TEXT,
  metadata JSONB
);

-- Discord guild connections
CREATE TABLE IF NOT EXISTS discord_guild_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  guild_name TEXT NOT NULL,
  guild_icon TEXT,
  bot_permissions BIGINT DEFAULT 0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, guild_id)
);

-- Discord guild channels
CREATE TABLE IF NOT EXISTS discord_guild_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_connection_id UUID NOT NULL REFERENCES discord_guild_connections(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_type INTEGER NOT NULL,
  category_id TEXT,
  category_name TEXT,
  position INTEGER DEFAULT 0,
  is_accessible BOOLEAN DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_connection_id, channel_id)
);

-- Discord OAuth states
CREATE TABLE IF NOT EXISTS discord_oauth_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL UNIQUE,
  redirect_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- External connections (unified multi-platform: Discord, Telegram, Slack, GitHub)
CREATE TABLE IF NOT EXISTS external_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_name TEXT,
  external_icon TEXT,
  permissions BIGINT DEFAULT 0,
  access_token_encrypted BYTEA,
  refresh_token_encrypted BYTEA,
  token_expires_at TIMESTAMPTZ,
  metadata JSONB,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, external_id)
);

-- External channels (cached channels per connection)
CREATE TABLE IF NOT EXISTS external_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id UUID NOT NULL REFERENCES external_connections(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_type INTEGER,
  category_id TEXT,
  category_name TEXT,
  position INTEGER DEFAULT 0,
  is_accessible BOOLEAN DEFAULT TRUE,
  metadata JSONB,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, channel_id)
);

-- External OAuth states (CSRF protection for all platforms)
CREATE TABLE IF NOT EXISTS external_oauth_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  redirect_url TEXT,
  metadata JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Telegram message cache
CREATE TABLE IF NOT EXISTS telegram_message_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id UUID NOT NULL REFERENCES external_connections(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  text TEXT,
  date TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, chat_id, message_id)
);

-- ============================================================
-- PHASE 7: Indexes (all IF NOT EXISTS — safe to re-run)
-- ============================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_ai_reset  ON users(ai_calls_today_reset_at);
CREATE INDEX IF NOT EXISTS idx_users_free_run  ON users(free_run_used_at);
CREATE INDEX IF NOT EXISTS idx_users_banned    ON users(is_banned) WHERE is_banned = TRUE;

-- Configs
CREATE INDEX IF NOT EXISTS idx_configs_cron_active ON configs(cron_expression) WHERE cron_expression IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_configs_featured    ON configs(is_featured, featured_at DESC) WHERE is_featured = TRUE;

-- Aggregation jobs
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_running
  ON aggregation_jobs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_config_created
  ON aggregation_jobs(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_user_created
  ON aggregation_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_continuous_running
  ON aggregation_jobs(job_type, status)
  WHERE job_type = 'continuous' AND status = 'running';

-- Summaries (note: expression-based unique handled by runCustomSQL on startup)
CREATE INDEX IF NOT EXISTS idx_summaries_config_type ON summaries(config_id, type);

-- Discord guild connections
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_user
  ON discord_guild_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_guild
  ON discord_guild_connections(guild_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_active
  ON discord_guild_connections(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_user_active
  ON discord_guild_connections(user_id, is_active) WHERE is_active = TRUE;

-- Discord guild channels
CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_connection
  ON discord_guild_channels(guild_connection_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_accessible
  ON discord_guild_channels(guild_connection_id, is_accessible) WHERE is_accessible = TRUE;

-- Discord OAuth states
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_expires ON discord_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_user    ON discord_oauth_states(user_id);

-- External connections
CREATE INDEX IF NOT EXISTS idx_external_connections_user
  ON external_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_external_connections_user_platform
  ON external_connections(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_external_connections_user_active
  ON external_connections(user_id, is_active) WHERE is_active = TRUE;

-- External channels
CREATE INDEX IF NOT EXISTS idx_external_channels_connection ON external_channels(connection_id);

-- External OAuth states
CREATE INDEX IF NOT EXISTS idx_external_oauth_states_user    ON external_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_external_oauth_states_expires ON external_oauth_states(expires_at);

-- Telegram message cache
CREATE INDEX IF NOT EXISTS idx_telegram_cache_connection ON telegram_message_cache(connection_id);
CREATE INDEX IF NOT EXISTS idx_telegram_cache_chat       ON telegram_message_cache(connection_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_cache_date       ON telegram_message_cache(date DESC);

-- Webhook buffer
CREATE INDEX IF NOT EXISTS idx_webhook_buffer_pending
  ON webhook_buffer(webhook_id, processed) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_webhook_buffer_received
  ON webhook_buffer(webhook_id, received_at DESC);

-- Webhook configs
CREATE INDEX IF NOT EXISTS idx_webhook_configs_webhook_id ON webhook_configs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_config     ON webhook_configs(config_id);

-- Outbound webhooks
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_user
  ON outbound_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config
  ON outbound_webhooks(config_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_active
  ON outbound_webhooks(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config_active
  ON outbound_webhooks(config_id, is_active) WHERE is_active = TRUE;

-- Outbound webhook deliveries
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_webhook
  ON outbound_webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_delivered
  ON outbound_webhook_deliveries(delivered_at DESC);

-- Site parsers
CREATE INDEX IF NOT EXISTS idx_site_parsers_domain ON site_parsers(domain);
CREATE INDEX IF NOT EXISTS idx_site_parsers_lookup ON site_parsers(domain, path_pattern);

-- ============================================================
-- PHASE 8: Functions & Triggers (new ones only)
-- ============================================================

-- Reset daily AI calls
CREATE OR REPLACE FUNCTION reset_daily_ai_calls()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ai_calls_today_reset_at < CURRENT_DATE THEN
    NEW.ai_calls_today = 0;
    NEW.ai_calls_today_reset_at = CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_reset_ai_calls ON users;
CREATE TRIGGER users_reset_ai_calls
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION reset_daily_ai_calls();

-- Reset daily token usage
CREATE OR REPLACE FUNCTION reset_daily_token_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tokens_used_today_reset_at < CURRENT_DATE THEN
    NEW.tokens_used_today = 0;
    NEW.estimated_cost_today_cents = 0;
    NEW.tokens_used_today_reset_at = CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_reset_token_usage ON users;
CREATE TRIGGER users_reset_token_usage
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION reset_daily_token_usage();

-- Reset free run tracking
CREATE OR REPLACE FUNCTION reset_free_run_used()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.free_run_used_at IS NOT NULL AND NEW.free_run_used_at < CURRENT_DATE THEN
    NEW.free_run_used_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_reset_free_run ON users;
CREATE TRIGGER users_reset_free_run
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION reset_free_run_used();

-- update_updated_at (may already exist — use CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Outbound webhooks updated_at trigger
DROP TRIGGER IF EXISTS outbound_webhooks_updated_at ON outbound_webhooks;
CREATE TRIGGER outbound_webhooks_updated_at
  BEFORE UPDATE ON outbound_webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Discord guild connections updated_at trigger
DROP TRIGGER IF EXISTS discord_guild_connections_updated_at ON discord_guild_connections;
CREATE TRIGGER discord_guild_connections_updated_at
  BEFORE UPDATE ON discord_guild_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- External connections updated_at trigger
DROP TRIGGER IF EXISTS external_connections_updated_at ON external_connections;
CREATE TRIGGER external_connections_updated_at
  BEFORE UPDATE ON external_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Webhook configs updated_at trigger
DROP TRIGGER IF EXISTS webhook_configs_updated_at ON webhook_configs;
CREATE TRIGGER webhook_configs_updated_at
  BEFORE UPDATE ON webhook_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Generate slug
CREATE OR REPLACE FUNCTION generate_slug(name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'));
END;
$$ LANGUAGE plpgsql;

-- Mark inactive Discord guild connections
CREATE OR REPLACE FUNCTION mark_inactive_discord_connections(guild_ids TEXT[])
RETURNS INTEGER AS $$
DECLARE updated_count INTEGER;
BEGIN
  UPDATE discord_guild_connections
  SET is_active = FALSE, updated_at = NOW()
  WHERE guild_id = ANY(guild_ids) AND is_active = TRUE;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Cleanup functions
CREATE OR REPLACE FUNCTION cleanup_expired_temp_retention()
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM temp_retention WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_api_usage()
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM api_usage WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_expired_discord_oauth_states()
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM discord_oauth_states WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_aggregation_jobs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM aggregation_jobs
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
    AND status != 'running';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_webhook_deliveries(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM outbound_webhook_deliveries
  WHERE delivered_at < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PHASE 9: Views (new + update existing)
-- ============================================================

-- Update public_configs to include items_last_24h if not already there
CREATE OR REPLACE VIEW public_configs AS
SELECT
  c.id,
  c.slug,
  c.name,
  c.description,
  c.monetization_enabled,
  c.price_per_query,
  c.total_items,
  c.total_queries,
  c.last_run_at,
  c.created_at,
  u.wallet_address AS owner_wallet,
  (SELECT COUNT(*) FROM items
   WHERE config_id = c.id
     AND date > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')) AS items_last_24h
FROM configs c
JOIN users u ON c.user_id = u.id
WHERE c.visibility = 'public';

-- Featured configs (new)
CREATE OR REPLACE VIEW featured_configs AS
SELECT
  c.id,
  c.slug,
  c.name,
  c.description,
  c.monetization_enabled,
  c.price_per_query,
  c.total_items,
  c.total_queries,
  c.last_run_at,
  c.featured_at,
  c.created_at,
  u.wallet_address AS owner_wallet
FROM configs c
JOIN users u ON c.user_id = u.id
WHERE c.is_featured = TRUE
  AND c.visibility IN ('public', 'unlisted')
ORDER BY c.featured_at DESC;

-- Update user_revenue_summary to use correct column name
CREATE OR REPLACE VIEW user_revenue_summary AS
SELECT
  c.user_id,
  SUM(p.amount)                  AS total_volume,
  SUM(p.owner_revenue)           AS total_revenue,
  SUM(p.platform_fee)            AS total_platform_fees,
  COUNT(p.id)                    AS total_transactions,
  COUNT(DISTINCT p.payer_wallet) AS unique_payers
FROM payments p
JOIN configs c ON p.config_id = c.id
WHERE p.status = 'settled'
GROUP BY c.user_id;

-- ============================================================
-- PHASE 10: Stamp Drizzle baseline
-- Hash of drizzle/0000_clever_doctor_doom.sql (SHA-256)
-- ============================================================
CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT
);

INSERT INTO "__drizzle_migrations" (hash, created_at)
SELECT '4adbb3ff07c884093998f1233f1a8d951ec586b0fb922543908ff34eb9317220', 1772472786697
WHERE NOT EXISTS (
  SELECT 1 FROM "__drizzle_migrations"
  WHERE hash = '4adbb3ff07c884093998f1233f1a8d951ec586b0fb922543908ff34eb9317220'
);

COMMIT;
