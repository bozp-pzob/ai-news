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
  
  -- Limits tracking (for free tier)
  runs_today INTEGER DEFAULT 0,
  runs_today_reset_at DATE DEFAULT CURRENT_DATE,
  
  -- Stats
  total_items INTEGER DEFAULT 0,
  total_queries INTEGER DEFAULT 0,
  total_revenue DECIMAL(12, 6) DEFAULT 0,
  
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
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(config_id, type, date)
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

-- Aggregation jobs tracking (supplements Bull/Redis)
CREATE TABLE IF NOT EXISTS aggregation_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bull_job_id TEXT,  -- Reference to Bull job
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  items_fetched INTEGER DEFAULT 0,
  items_processed INTEGER DEFAULT 0,
  error_message TEXT,
  logs JSONB DEFAULT '[]',
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

-- Configs
CREATE INDEX IF NOT EXISTS idx_configs_user ON configs(user_id);
CREATE INDEX IF NOT EXISTS idx_configs_slug ON configs(slug);
CREATE INDEX IF NOT EXISTS idx_configs_visibility ON configs(visibility);
CREATE INDEX IF NOT EXISTS idx_configs_status ON configs(status);
CREATE INDEX IF NOT EXISTS idx_configs_monetization ON configs(monetization_enabled) WHERE monetization_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_configs_public ON configs(visibility, monetization_enabled) WHERE visibility = 'public';

-- Config shares
CREATE INDEX IF NOT EXISTS idx_config_shares_config ON config_shares(config_id);
CREATE INDEX IF NOT EXISTS idx_config_shares_user ON config_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_config_shares_wallet ON config_shares(shared_with_wallet);

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
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_status ON aggregation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_user ON aggregation_jobs(user_id);

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
