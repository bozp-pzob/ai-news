-- ============================================================
-- Migration 009: UUID Schema Fix + Missing Tables
-- ============================================================
-- Converts users.id from INTEGER → UUID, fixes all FK children,
-- adds missing columns, creates all missing tables, stamps
-- Drizzle baseline so startup migrations are skipped.
--
-- Safe to run: all data tables are empty (0 real rows).
-- The one placeholder user (id=1) is regenerated as a UUID.
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
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_calls_today INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_calls_today_reset_at DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS tokens_used_today INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_used_today_reset_at DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS estimated_cost_today_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_reason TEXT;

-- Tier CHECK constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_tier_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_tier_check
      CHECK (tier IN ('free', 'paid', 'admin'));
  END IF;
END $$;

-- NOT NULL on privy_id (placeholder row has 'default' so this is safe)
ALTER TABLE users ALTER COLUMN privy_id SET NOT NULL;

-- Fix timestamp columns → timestamptz
ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- ============================================================
-- PHASE 3: INTEGER → UUID on users.id + all FK children
-- ============================================================

-- 3a. Add UUID column to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT uuid_generate_v4() NOT NULL;

-- 3b. Add user_uuid staging columns to all FK child tables
ALTER TABLE aggregation_jobs      ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE chat_conversations     ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE configs                ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE cubes                  ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE decks                  ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE external_connections   ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE external_oauth_states  ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE seller_bundles         ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE user_collection_items  ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE wishlist_deals         ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE wishlist_items         ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE collection_history_daily   ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE collection_history_weekly  ADD COLUMN IF NOT EXISTS user_uuid UUID;

-- 3c. Drop unique constraints that reference user_id (before we drop the column)
ALTER TABLE configs
  DROP CONSTRAINT IF EXISTS configs_user_id_name_key;
ALTER TABLE external_connections
  DROP CONSTRAINT IF EXISTS external_connections_user_id_platform_external_id_key;

-- 3d. Drop all FK constraints referencing users(id)
ALTER TABLE aggregation_jobs     DROP CONSTRAINT IF EXISTS aggregation_jobs_user_id_fkey;
ALTER TABLE chat_conversations    DROP CONSTRAINT IF EXISTS fk_chat_conversations_user;
ALTER TABLE configs               DROP CONSTRAINT IF EXISTS configs_user_id_fkey;
ALTER TABLE cubes                 DROP CONSTRAINT IF EXISTS fk_cubes_user;
ALTER TABLE decks                 DROP CONSTRAINT IF EXISTS fk_decks_user;
ALTER TABLE external_connections  DROP CONSTRAINT IF EXISTS external_connections_user_id_fkey;
ALTER TABLE external_oauth_states DROP CONSTRAINT IF EXISTS external_oauth_states_user_id_fkey;
ALTER TABLE seller_bundles        DROP CONSTRAINT IF EXISTS fk_bundle_user;
ALTER TABLE user_collection_items DROP CONSTRAINT IF EXISTS fk_collection_user;
ALTER TABLE wishlist_deals        DROP CONSTRAINT IF EXISTS fk_deal_user;
ALTER TABLE wishlist_items        DROP CONSTRAINT IF EXISTS fk_wishlist_user;

-- 3e. Swap users primary key: drop INTEGER id, promote uuid_id → id
ALTER TABLE users DROP CONSTRAINT users_pkey;
ALTER TABLE users DROP COLUMN id;
ALTER TABLE users RENAME COLUMN uuid_id TO id;
ALTER TABLE users ADD PRIMARY KEY (id);
DROP SEQUENCE IF EXISTS users_id_seq;

-- 3f. Swap user_id on each child table (all empty — no data migration needed)

-- aggregation_jobs
ALTER TABLE aggregation_jobs DROP COLUMN user_id;
ALTER TABLE aggregation_jobs RENAME COLUMN user_uuid TO user_id;
ALTER TABLE aggregation_jobs ALTER COLUMN user_id SET NOT NULL;

-- chat_conversations
ALTER TABLE chat_conversations DROP COLUMN user_id;
ALTER TABLE chat_conversations RENAME COLUMN user_uuid TO user_id;
ALTER TABLE chat_conversations ALTER COLUMN user_id SET NOT NULL;

-- configs
ALTER TABLE configs DROP COLUMN user_id;
ALTER TABLE configs RENAME COLUMN user_uuid TO user_id;
ALTER TABLE configs ALTER COLUMN user_id SET NOT NULL;

-- cubes
ALTER TABLE cubes DROP COLUMN user_id;
ALTER TABLE cubes RENAME COLUMN user_uuid TO user_id;
ALTER TABLE cubes ALTER COLUMN user_id SET NOT NULL;

-- decks
ALTER TABLE decks DROP COLUMN user_id;
ALTER TABLE decks RENAME COLUMN user_uuid TO user_id;
ALTER TABLE decks ALTER COLUMN user_id SET NOT NULL;

-- external_connections
ALTER TABLE external_connections DROP COLUMN user_id;
ALTER TABLE external_connections RENAME COLUMN user_uuid TO user_id;
ALTER TABLE external_connections ALTER COLUMN user_id SET NOT NULL;

-- external_oauth_states
ALTER TABLE external_oauth_states DROP COLUMN user_id;
ALTER TABLE external_oauth_states RENAME COLUMN user_uuid TO user_id;
ALTER TABLE external_oauth_states ALTER COLUMN user_id SET NOT NULL;

-- seller_bundles
ALTER TABLE seller_bundles DROP COLUMN user_id;
ALTER TABLE seller_bundles RENAME COLUMN user_uuid TO user_id;
ALTER TABLE seller_bundles ALTER COLUMN user_id SET NOT NULL;

-- user_collection_items
ALTER TABLE user_collection_items DROP COLUMN user_id;
ALTER TABLE user_collection_items RENAME COLUMN user_uuid TO user_id;
ALTER TABLE user_collection_items ALTER COLUMN user_id SET NOT NULL;

-- wishlist_deals
ALTER TABLE wishlist_deals DROP COLUMN user_id;
ALTER TABLE wishlist_deals RENAME COLUMN user_uuid TO user_id;
ALTER TABLE wishlist_deals ALTER COLUMN user_id SET NOT NULL;

-- wishlist_items
ALTER TABLE wishlist_items DROP COLUMN user_id;
ALTER TABLE wishlist_items RENAME COLUMN user_uuid TO user_id;
ALTER TABLE wishlist_items ALTER COLUMN user_id SET NOT NULL;

-- collection_history_daily (no FK constraint, just convert the column)
ALTER TABLE collection_history_daily DROP COLUMN user_id;
ALTER TABLE collection_history_daily RENAME COLUMN user_uuid TO user_id;

-- collection_history_weekly (no FK constraint, just convert the column)
ALTER TABLE collection_history_weekly DROP COLUMN user_id;
ALTER TABLE collection_history_weekly RENAME COLUMN user_uuid TO user_id;

-- 3g. Re-add all FK constraints (ON DELETE CASCADE — same as original)
ALTER TABLE aggregation_jobs
  ADD CONSTRAINT aggregation_jobs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE chat_conversations
  ADD CONSTRAINT fk_chat_conversations_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE configs
  ADD CONSTRAINT configs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE cubes
  ADD CONSTRAINT fk_cubes_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE decks
  ADD CONSTRAINT fk_decks_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE external_connections
  ADD CONSTRAINT external_connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE external_oauth_states
  ADD CONSTRAINT external_oauth_states_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE seller_bundles
  ADD CONSTRAINT fk_bundle_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_collection_items
  ADD CONSTRAINT fk_collection_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE wishlist_deals
  ADD CONSTRAINT fk_deal_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE wishlist_items
  ADD CONSTRAINT fk_wishlist_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 3h. Restore unique constraints that were dropped
ALTER TABLE configs
  ADD CONSTRAINT configs_user_id_name_key UNIQUE (user_id, name);

ALTER TABLE external_connections
  ADD CONSTRAINT external_connections_user_id_platform_external_id_key
    UNIQUE (user_id, platform, external_id);

-- ============================================================
-- PHASE 4: Fix configs — add 2 missing columns
-- ============================================================
ALTER TABLE configs
  ADD COLUMN IF NOT EXISTS is_local_execution BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_items BOOLEAN DEFAULT FALSE;

-- ============================================================
-- PHASE 5: Fix aggregation_jobs — add missing columns + index
-- ============================================================
ALTER TABLE aggregation_jobs
  ADD COLUMN IF NOT EXISTS total_prompt_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_completion_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ai_calls INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(10,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_config_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS resolved_secrets_encrypted BYTEA;

CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_running
  ON aggregation_jobs(status) WHERE status = 'running';

-- ============================================================
-- PHASE 6: Create missing Digital Gardener tables
-- ============================================================

-- Config sharing
CREATE TABLE IF NOT EXISTS config_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  shared_with_wallet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (shared_with_user_id IS NOT NULL OR shared_with_wallet IS NOT NULL)
);

-- API usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  wallet_address TEXT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  query_params JSONB,
  status_code INTEGER,
  response_time_ms INTEGER,
  payment_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments (x402 transactions)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  payer_wallet TEXT NOT NULL,
  amount DECIMAL(12,6) NOT NULL,
  platform_fee DECIMAL(12,6) NOT NULL,
  owner_revenue DECIMAL(12,6) NOT NULL,
  tx_signature TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','verified','settled','failed')),
  facilitator_response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- Content items
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  cid TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT,
  text TEXT,
  link TEXT,
  topics TEXT[],
  date BIGINT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, cid)
);

-- Summaries
CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT,
  categories JSONB,
  markdown TEXT,
  date BIGINT,
  content_hash TEXT,
  start_date BIGINT,
  end_date BIGINT,
  granularity TEXT DEFAULT 'daily',
  metadata JSONB,
  tokens_used INTEGER,
  estimated_cost_usd REAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Expression-based unique index (COALESCE can't be used in inline UNIQUE constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_summaries_unique
  ON summaries(config_id, type, date, COALESCE(granularity, 'daily'));

-- Cursors (incremental fetching)
CREATE TABLE IF NOT EXISTS cursors (
  id SERIAL PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  cid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, cid)
);

-- Temporary retention
CREATE TABLE IF NOT EXISTS temp_retention (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL CHECK (data_type IN ('items','summary')),
  data JSONB NOT NULL,
  reason TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  last_retry_error TEXT,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Outbound webhook delivery log
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

-- Site parsers (Drizzle schema only — not in postgres-schema.sql)
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

-- ============================================================
-- PHASE 7: Create old Discord-specific tables
-- (alongside unified external_connections system)
-- ============================================================

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

-- Cached channels for connected guilds
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

-- ============================================================
-- PHASE 8: Indexes
-- ============================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_privy     ON users(privy_id);
CREATE INDEX IF NOT EXISTS idx_users_wallet    ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_tier      ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_ai_reset  ON users(ai_calls_today_reset_at);
CREATE INDEX IF NOT EXISTS idx_users_banned    ON users(is_banned) WHERE is_banned = TRUE;

-- Configs
CREATE INDEX IF NOT EXISTS idx_configs_user          ON configs(user_id);
CREATE INDEX IF NOT EXISTS idx_configs_slug          ON configs(slug);
CREATE INDEX IF NOT EXISTS idx_configs_visibility    ON configs(visibility);
CREATE INDEX IF NOT EXISTS idx_configs_status        ON configs(status);
CREATE INDEX IF NOT EXISTS idx_configs_monetization  ON configs(monetization_enabled) WHERE monetization_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_configs_public        ON configs(visibility, monetization_enabled) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_configs_featured      ON configs(is_featured, featured_at DESC) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_configs_cron_active   ON configs(cron_expression) WHERE cron_expression IS NOT NULL;

-- Config shares
CREATE INDEX IF NOT EXISTS idx_config_shares_config ON config_shares(config_id);
CREATE INDEX IF NOT EXISTS idx_config_shares_user   ON config_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_config_shares_wallet ON config_shares(shared_with_wallet);

-- Discord guild connections
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_user         ON discord_guild_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_guild        ON discord_guild_connections(guild_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_active       ON discord_guild_connections(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_user_active  ON discord_guild_connections(user_id, is_active) WHERE is_active = TRUE;

-- Discord guild channels
CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_connection  ON discord_guild_channels(guild_connection_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_accessible  ON discord_guild_channels(guild_connection_id, is_accessible) WHERE is_accessible = TRUE;

-- Discord OAuth states
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_expires ON discord_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_user    ON discord_oauth_states(user_id);

-- Items
CREATE INDEX IF NOT EXISTS idx_items_config        ON items(config_id);
CREATE INDEX IF NOT EXISTS idx_items_config_date   ON items(config_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_items_config_type   ON items(config_id, type);
CREATE INDEX IF NOT EXISTS idx_items_config_source ON items(config_id, source);
CREATE INDEX IF NOT EXISTS idx_items_topics        ON items USING GIN(topics);
CREATE INDEX IF NOT EXISTS idx_items_metadata      ON items USING GIN(metadata);

-- Summaries
CREATE INDEX IF NOT EXISTS idx_summaries_config      ON summaries(config_id);
CREATE INDEX IF NOT EXISTS idx_summaries_config_date ON summaries(config_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_config_type ON summaries(config_id, type);

-- Cursors
CREATE INDEX IF NOT EXISTS idx_cursors_config ON cursors(config_id);

-- API Usage
CREATE INDEX IF NOT EXISTS idx_api_usage_config         ON api_usage(config_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user           ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created        ON api_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_config_created ON api_usage(config_id, created_at DESC);

-- Payments
CREATE INDEX IF NOT EXISTS idx_payments_config  ON payments(config_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer   ON payments(payer_wallet);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

-- Temp retention
CREATE INDEX IF NOT EXISTS idx_temp_retention_config  ON temp_retention(config_id);
CREATE INDEX IF NOT EXISTS idx_temp_retention_expires ON temp_retention(expires_at);
CREATE INDEX IF NOT EXISTS idx_temp_retention_retry   ON temp_retention(retry_count, last_retry_at);

-- Aggregation jobs
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_config           ON aggregation_jobs(config_id);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_config_created   ON aggregation_jobs(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_status           ON aggregation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_running          ON aggregation_jobs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_user             ON aggregation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_user_created     ON aggregation_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_continuous_running
  ON aggregation_jobs(job_type, status) WHERE job_type = 'continuous' AND status = 'running';

-- Webhook buffer
CREATE INDEX IF NOT EXISTS idx_webhook_buffer_pending  ON webhook_buffer(webhook_id, processed) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_webhook_buffer_received ON webhook_buffer(webhook_id, received_at DESC);

-- Webhook configs
CREATE INDEX IF NOT EXISTS idx_webhook_configs_webhook_id ON webhook_configs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_config     ON webhook_configs(config_id);

-- Outbound webhooks
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_user          ON outbound_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config        ON outbound_webhooks(config_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_active        ON outbound_webhooks(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config_active ON outbound_webhooks(config_id, is_active) WHERE is_active = TRUE;

-- Outbound webhook deliveries
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_webhook   ON outbound_webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_delivered ON outbound_webhook_deliveries(delivered_at DESC);

-- Site parsers
CREATE INDEX IF NOT EXISTS idx_site_parsers_domain ON site_parsers(domain);
CREATE INDEX IF NOT EXISTS idx_site_parsers_lookup ON site_parsers(domain, path_pattern);

-- ============================================================
-- PHASE 9: Functions, Triggers, Views
-- ============================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS configs_updated_at ON configs;
CREATE TRIGGER configs_updated_at
  BEFORE UPDATE ON configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS cursors_updated_at ON cursors;
CREATE TRIGGER cursors_updated_at
  BEFORE UPDATE ON cursors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS discord_guild_connections_updated_at ON discord_guild_connections;
CREATE TRIGGER discord_guild_connections_updated_at
  BEFORE UPDATE ON discord_guild_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS outbound_webhooks_updated_at ON outbound_webhooks;
CREATE TRIGGER outbound_webhooks_updated_at
  BEFORE UPDATE ON outbound_webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Reset daily run counter
CREATE OR REPLACE FUNCTION reset_daily_runs()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.runs_today_reset_at < CURRENT_DATE THEN
    NEW.runs_today = 0;
    NEW.runs_today_reset_at = CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS configs_reset_runs ON configs;
CREATE TRIGGER configs_reset_runs
  BEFORE UPDATE ON configs
  FOR EACH ROW EXECUTE FUNCTION reset_daily_runs();

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

-- Update config item count on insert/delete
CREATE OR REPLACE FUNCTION update_config_item_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE configs SET total_items = total_items + 1 WHERE id = NEW.config_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE configs SET total_items = total_items - 1 WHERE id = OLD.config_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS items_update_count ON items;
CREATE TRIGGER items_update_count
  AFTER INSERT OR DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION update_config_item_count();

-- Update config revenue on payment settled
CREATE OR REPLACE FUNCTION update_config_revenue()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'settled' AND (OLD.status IS NULL OR OLD.status != 'settled') THEN
    UPDATE configs
    SET total_revenue  = total_revenue  + NEW.owner_revenue,
        total_queries  = total_queries  + 1
    WHERE id = NEW.config_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_update_revenue ON payments;
CREATE TRIGGER payments_update_revenue
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_config_revenue();

-- Generate slug from name
CREATE OR REPLACE FUNCTION generate_slug(name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'));
END;
$$ LANGUAGE plpgsql;

-- Reset free run tracking at midnight UTC
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

-- Mark inactive Discord guild connections
CREATE OR REPLACE FUNCTION mark_inactive_discord_connections(guild_ids TEXT[])
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
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
-- PHASE 10: Views
-- ============================================================

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

CREATE OR REPLACE VIEW user_revenue_summary AS
SELECT
  c.user_id,
  SUM(p.amount)          AS total_volume,
  SUM(p.owner_revenue)   AS total_revenue,
  SUM(p.platform_fee)    AS total_platform_fees,
  COUNT(p.id)            AS total_transactions,
  COUNT(DISTINCT p.payer_wallet) AS unique_payers
FROM payments p
JOIN configs c ON p.config_id = c.id
WHERE p.status = 'settled'
GROUP BY c.user_id;

-- ============================================================
-- PHASE 11: Stamp Drizzle baseline
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
