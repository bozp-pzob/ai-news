-- ============================================
-- AI News Context Aggregation Platform
-- PostgreSQL Schema with pgvector
-- ============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- PLATFORM TABLES (Multi-tenant management)
-- ============================================

-- Users (linked to Privy)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  privy_id TEXT UNIQUE NOT NULL,
  email TEXT,
  wallet_address TEXT,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'paid', 'admin')),
  settings JSONB DEFAULT '{}',
  -- AI usage tracking (for platform AI with daily limits)
  ai_calls_today INTEGER DEFAULT 0,
  ai_calls_today_reset_at DATE DEFAULT CURRENT_DATE,
  -- Token budget tracking (for generation guardrails)
  tokens_used_today INTEGER DEFAULT 0,
  tokens_used_today_reset_at DATE DEFAULT CURRENT_DATE,
  estimated_cost_today_cents INTEGER DEFAULT 0,  -- Cost in 1/100 cent precision
  -- Free run tracking (1 free run per day globally)
  free_run_used_at DATE,
  -- Admin: ban tracking
  is_banned BOOLEAN DEFAULT FALSE,
  banned_at TIMESTAMPTZ,
  banned_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configs (user-owned data pipelines)
CREATE TABLE IF NOT EXISTS configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private', 'shared', 'unlisted')),
  
  -- Storage configuration
  storage_type TEXT NOT NULL DEFAULT 'platform' CHECK (storage_type IN ('platform', 'external')),
  external_db_url TEXT,  -- Encrypted, for free users
  external_db_valid BOOLEAN DEFAULT NULL,  -- NULL = not tested, TRUE = valid, FALSE = invalid
  external_db_error TEXT,  -- Last error message if validation failed
  
  -- Monetization
  monetization_enabled BOOLEAN DEFAULT FALSE,
  price_per_query DECIMAL(10, 6) DEFAULT 0.001,  -- In USDC
  owner_wallet TEXT,  -- Solana wallet for payouts
  
  -- Config definition
  config_json JSONB NOT NULL,  -- The actual config (sources, enrichers, etc.)
  secrets BYTEA,  -- Encrypted secrets (Discord tokens, API keys)
  
  -- Status
  status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error', 'paused')),
  last_run_at TIMESTAMPTZ,
  last_run_duration_ms INTEGER,
  last_error TEXT,
  
  -- Continuous run settings
  global_interval INTEGER,  -- Milliseconds, overrides per-source intervals for continuous runs
  active_job_id UUID,  -- Reference to currently running continuous job
  
  -- Limits tracking (for free tier)
  runs_today INTEGER DEFAULT 0,
  runs_today_reset_at DATE DEFAULT CURRENT_DATE,
  
  -- Stats
  total_items INTEGER DEFAULT 0,
  total_queries INTEGER DEFAULT 0,
  total_revenue DECIMAL(12, 6) DEFAULT 0,
  
  -- Local execution: config runs on user's local server, not on platform
  is_local_execution BOOLEAN DEFAULT FALSE,
  
  -- Data access: hide raw items from non-owners (UI + API)
  hide_items BOOLEAN DEFAULT FALSE,
  
  -- Admin: featured configs
  is_featured BOOLEAN DEFAULT FALSE,
  featured_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, name),
  UNIQUE(slug)
);

-- Config sharing (for 'shared' visibility)
CREATE TABLE IF NOT EXISTS config_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  shared_with_wallet TEXT,  -- Can share with wallet address directly
  permissions TEXT[] DEFAULT ARRAY['read'],  -- 'read', 'query'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CHECK (shared_with_user_id IS NOT NULL OR shared_with_wallet IS NOT NULL)
);

-- ============================================
-- DISCORD INTEGRATION (Multi-tenant bot)
-- ============================================

-- Discord guild connections (tracks which user added bot to which guild)
CREATE TABLE IF NOT EXISTS discord_guild_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,                    -- Discord guild snowflake ID
  guild_name TEXT NOT NULL,
  guild_icon TEXT,                           -- Guild icon hash (for display)
  bot_permissions BIGINT DEFAULT 0,          -- Bot's permission bitfield in guild
  added_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,            -- Bot still present in guild
  last_verified_at TIMESTAMPTZ,              -- Last time we verified bot presence
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Each user can only have one connection per guild
  UNIQUE(user_id, guild_id)
);

-- Cached channels for connected guilds
CREATE TABLE IF NOT EXISTS discord_guild_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_connection_id UUID NOT NULL REFERENCES discord_guild_connections(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,                  -- Discord channel snowflake ID
  channel_name TEXT NOT NULL,
  channel_type INTEGER NOT NULL,             -- Discord ChannelType enum value
  category_id TEXT,                          -- Parent category ID
  category_name TEXT,                        -- Parent category name
  position INTEGER DEFAULT 0,                -- Channel position for ordering
  is_accessible BOOLEAN DEFAULT TRUE,        -- Bot can read this channel
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Each channel appears once per connection
  UNIQUE(guild_connection_id, channel_id)
);

-- OAuth state storage (for CSRF protection during OAuth flow)
CREATE TABLE IF NOT EXISTS discord_oauth_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL UNIQUE,                -- Random state token
  redirect_url TEXT,                         -- Where to redirect after OAuth
  expires_at TIMESTAMPTZ NOT NULL,           -- State expiration (short-lived)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL for anonymous/paid requests
  wallet_address TEXT,  -- For x402 payments
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  query_params JSONB,
  status_code INTEGER,
  response_time_ms INTEGER,
  payment_id UUID,  -- Link to payment if paid request
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments (x402 transactions)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  payer_wallet TEXT NOT NULL,
  amount DECIMAL(12, 6) NOT NULL,  -- Total in USDC
  platform_fee DECIMAL(12, 6) NOT NULL,
  owner_revenue DECIMAL(12, 6) NOT NULL,
  tx_signature TEXT,  -- Solana transaction signature
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'settled', 'failed')),
  facilitator_response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- ============================================
-- CONTENT TABLES (Aggregated data)
-- ============================================

-- Content items
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  cid TEXT,  -- Content ID from source
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT,
  text TEXT,
  link TEXT,
  topics TEXT[],
  date BIGINT,  -- Epoch seconds
  metadata JSONB,
  embedding vector(1536),
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
  date BIGINT,  -- Epoch seconds
  content_hash TEXT,  -- SHA-256 hash of source content used to generate this summary
  start_date BIGINT,  -- Epoch seconds — for range summaries, the start of the range
  end_date BIGINT,  -- Epoch seconds — for range summaries, the end of the range
  granularity TEXT DEFAULT 'daily',  -- daily, weekly, monthly, custom
  metadata JSONB,  -- Flexible metadata (highlights, trends, contributors, etc.)
  tokens_used INTEGER,  -- Actual tokens consumed to generate this summary
  estimated_cost_usd REAL,  -- Estimated generation cost in USD
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(config_id, type, date, COALESCE(granularity, 'daily'))
);

-- Cursors (for incremental fetching)
CREATE TABLE IF NOT EXISTS cursors (
  id SERIAL PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  cid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(config_id, cid)
);

-- Temporary retention (for failed external DB writes)
CREATE TABLE IF NOT EXISTS temp_retention (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL CHECK (data_type IN ('items', 'summary')),
  data JSONB NOT NULL,
  reason TEXT,  -- Why it's in temp retention
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  last_retry_error TEXT,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BACKGROUND JOBS
-- ============================================

-- Aggregation jobs tracking
CREATE TABLE IF NOT EXISTS aggregation_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Job type and configuration
  job_type TEXT DEFAULT 'one-time' CHECK (job_type IN ('one-time', 'continuous')),
  global_interval INTEGER,  -- Milliseconds, for continuous jobs
  
  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Stats (for continuous jobs, these accumulate across ticks)
  items_fetched INTEGER DEFAULT 0,
  items_processed INTEGER DEFAULT 0,
  run_count INTEGER DEFAULT 1,  -- For continuous: increments each interval tick
  last_fetch_at TIMESTAMPTZ,  -- For continuous: updated each interval tick
  
  -- AI token usage and cost tracking
  total_prompt_tokens INTEGER DEFAULT 0,
  total_completion_tokens INTEGER DEFAULT 0,
  total_ai_calls INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6) DEFAULT 0,
  
  -- Error handling
  error_message TEXT,
  logs JSONB DEFAULT '[]',
  
  -- Encrypted resolved config/secrets for server restart resilience
  -- Stores the fully-resolved config (with all $SECRET:uuid$ references and platform
  -- credentials injected) encrypted with AES-256-GCM, keyed by jobId
  resolved_config_encrypted BYTEA,
  resolved_secrets_encrypted BYTEA,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_privy ON users(privy_id);
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_ai_reset ON users(ai_calls_today_reset_at);
CREATE INDEX IF NOT EXISTS idx_users_free_run ON users(free_run_used_at);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(is_banned) WHERE is_banned = TRUE;

-- Configs
CREATE INDEX IF NOT EXISTS idx_configs_user ON configs(user_id);
CREATE INDEX IF NOT EXISTS idx_configs_slug ON configs(slug);
CREATE INDEX IF NOT EXISTS idx_configs_visibility ON configs(visibility);
CREATE INDEX IF NOT EXISTS idx_configs_status ON configs(status);
CREATE INDEX IF NOT EXISTS idx_configs_monetization ON configs(monetization_enabled) WHERE monetization_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_configs_public ON configs(visibility, monetization_enabled) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_configs_featured ON configs(is_featured, featured_at DESC) WHERE is_featured = TRUE;

-- Config shares
CREATE INDEX IF NOT EXISTS idx_config_shares_config ON config_shares(config_id);
CREATE INDEX IF NOT EXISTS idx_config_shares_user ON config_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_config_shares_wallet ON config_shares(shared_with_wallet);

-- Discord guild connections
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_user ON discord_guild_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_guild ON discord_guild_connections(guild_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_active ON discord_guild_connections(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_discord_guild_connections_user_active ON discord_guild_connections(user_id, is_active) WHERE is_active = TRUE;

-- Discord guild channels
CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_connection ON discord_guild_channels(guild_connection_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_accessible ON discord_guild_channels(guild_connection_id, is_accessible) WHERE is_accessible = TRUE;

-- Discord OAuth states (cleanup old states)
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_expires ON discord_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_user ON discord_oauth_states(user_id);

-- Items
CREATE INDEX IF NOT EXISTS idx_items_config ON items(config_id);
CREATE INDEX IF NOT EXISTS idx_items_config_date ON items(config_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_items_config_type ON items(config_id, type);
CREATE INDEX IF NOT EXISTS idx_items_config_source ON items(config_id, source);
CREATE INDEX IF NOT EXISTS idx_items_topics ON items USING GIN(topics);
CREATE INDEX IF NOT EXISTS idx_items_metadata ON items USING GIN(metadata);

-- Summaries
CREATE INDEX IF NOT EXISTS idx_summaries_config ON summaries(config_id);
CREATE INDEX IF NOT EXISTS idx_summaries_config_date ON summaries(config_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_config_type ON summaries(config_id, type);

-- Cursors
CREATE INDEX IF NOT EXISTS idx_cursors_config ON cursors(config_id);

-- API Usage
CREATE INDEX IF NOT EXISTS idx_api_usage_config ON api_usage(config_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_config_created ON api_usage(config_id, created_at DESC);

-- Payments
CREATE INDEX IF NOT EXISTS idx_payments_config ON payments(config_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_wallet);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

-- Temp retention
CREATE INDEX IF NOT EXISTS idx_temp_retention_config ON temp_retention(config_id);
CREATE INDEX IF NOT EXISTS idx_temp_retention_expires ON temp_retention(expires_at);
CREATE INDEX IF NOT EXISTS idx_temp_retention_retry ON temp_retention(retry_count, last_retry_at);

-- Aggregation jobs
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_config ON aggregation_jobs(config_id);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_config_created ON aggregation_jobs(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_status ON aggregation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_running ON aggregation_jobs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_user ON aggregation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_user_created ON aggregation_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_continuous_running ON aggregation_jobs(job_type, status) WHERE job_type = 'continuous' AND status = 'running';

-- ============================================
-- VECTOR INDEXES (IVFFlat for ANN search)
-- Note: These are created after initial data load for better performance
-- ============================================

-- Will be created after sufficient data exists:
-- CREATE INDEX idx_items_embedding ON items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX idx_summaries_embedding ON summaries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers
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

-- Reset daily run counter function
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

-- Reset daily AI calls counter function (for users table)
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

-- Reset daily token usage counter function (for generation budget tracking)
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

-- Update config stats after item insert
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

-- Update config revenue after payment settled
CREATE OR REPLACE FUNCTION update_config_revenue()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'settled' AND (OLD.status IS NULL OR OLD.status != 'settled') THEN
    UPDATE configs 
    SET total_revenue = total_revenue + NEW.owner_revenue,
        total_queries = total_queries + 1
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

-- ============================================
-- VIEWS
-- ============================================

-- Public configs view (for discovery)
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
  u.wallet_address as owner_wallet,
  (SELECT COUNT(*) FROM items WHERE config_id = c.id AND date > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')) as items_last_24h
FROM configs c
JOIN users u ON c.user_id = u.id
WHERE c.visibility = 'public';

-- Featured configs view (for public discovery)
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
  u.wallet_address as owner_wallet
FROM configs c
JOIN users u ON c.user_id = u.id
WHERE c.is_featured = TRUE
  AND c.visibility IN ('public', 'unlisted')
ORDER BY c.featured_at DESC;

-- User revenue summary view
CREATE OR REPLACE VIEW user_revenue_summary AS
SELECT 
  c.user_id,
  SUM(p.amount) as total_volume,
  SUM(p.owner_revenue) as total_revenue,
  SUM(p.platform_fee) as total_platform_fees,
  COUNT(p.id) as total_transactions,
  COUNT(DISTINCT p.payer_wallet) as unique_payers
FROM payments p
JOIN configs c ON p.config_id = c.id
WHERE p.status = 'settled'
GROUP BY c.user_id;

-- ============================================
-- CLEANUP FUNCTIONS
-- ============================================

-- Clean up expired temp retention
CREATE OR REPLACE FUNCTION cleanup_expired_temp_retention()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM temp_retention WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Clean up old API usage logs (keep 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_api_usage()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM api_usage WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Clean up expired Discord OAuth states
CREATE OR REPLACE FUNCTION cleanup_expired_discord_oauth_states()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM discord_oauth_states WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Clean up old aggregation jobs (configurable retention, default 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_aggregation_jobs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM aggregation_jobs 
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
    AND status != 'running';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
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

-- Mark inactive Discord guild connections (bot removed from guild)
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
