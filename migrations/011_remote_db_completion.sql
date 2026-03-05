-- ============================================================
-- Migration 011: Remote DB completion (192.168.1.217:6432)
-- ============================================================
-- Adds columns and tables that are missing from the production
-- database but present in the schema definition.
-- All statements are idempotent (IF NOT EXISTS).
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 1: Missing columns in configs
-- ============================================================
ALTER TABLE configs
  ADD COLUMN IF NOT EXISTS cron_expression TEXT,
  ADD COLUMN IF NOT EXISTS schedule_timezone TEXT DEFAULT 'UTC';

-- ============================================================
-- PHASE 2: Missing tables
-- ============================================================

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

-- ============================================================
-- PHASE 3: Indexes for new tables and missing ones
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_configs_cron_active
  ON configs(cron_expression) WHERE cron_expression IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_user
  ON outbound_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config
  ON outbound_webhooks(config_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_active
  ON outbound_webhooks(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config_active
  ON outbound_webhooks(config_id, is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_webhook
  ON outbound_webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_delivered
  ON outbound_webhook_deliveries(delivered_at DESC);

CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_user
  ON discord_guild_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_guild
  ON discord_guild_connections(guild_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_active
  ON discord_guild_connections(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_user_active
  ON discord_guild_connections(user_id, is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_connection
  ON discord_guild_channels(guild_connection_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_accessible
  ON discord_guild_channels(guild_connection_id, is_accessible) WHERE is_accessible = TRUE;

CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_user
  ON discord_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_expires
  ON discord_oauth_states(expires_at);

-- ============================================================
-- PHASE 4: Triggers for new tables
-- ============================================================

-- update_updated_at should already exist on this DB
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outbound_webhooks_updated_at ON outbound_webhooks;
CREATE TRIGGER outbound_webhooks_updated_at
  BEFORE UPDATE ON outbound_webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS discord_guild_connections_updated_at ON discord_guild_connections;
CREATE TRIGGER discord_guild_connections_updated_at
  BEFORE UPDATE ON discord_guild_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Cleanup function for webhook deliveries
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

-- Cleanup for Discord OAuth states
CREATE OR REPLACE FUNCTION cleanup_expired_discord_oauth_states()
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM discord_oauth_states WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PHASE 5: Update featured_configs view (needs is_featured col)
-- ============================================================

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

COMMIT;
