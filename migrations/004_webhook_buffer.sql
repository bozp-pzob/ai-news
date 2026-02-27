-- Migration 004: Webhook Buffer Table
-- Stores incoming webhook payloads until they are consumed by WebhookSource.fetchItems()
-- 
-- Multi-tenant isolation:
-- - Each WebhookSource config gets a unique webhook_id
-- - fetchItems() filters by webhook_id
-- - Webhook endpoint validates webhook_secret before writing
--
-- Run: psql $DATABASE_URL -f migrations/004_webhook_buffer.sql

-- Create the webhook buffer table
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

-- Index for efficient polling: fetch unprocessed items for a specific webhook
CREATE INDEX IF NOT EXISTS idx_webhook_buffer_pending 
  ON webhook_buffer(webhook_id, processed) 
  WHERE processed = FALSE;

-- Index for date-ordered retrieval
CREATE INDEX IF NOT EXISTS idx_webhook_buffer_received 
  ON webhook_buffer(webhook_id, received_at DESC);

-- Webhook configs table: stores webhook_id -> webhook_secret mapping
-- Used by the webhook route to validate incoming requests
CREATE TABLE IF NOT EXISTS webhook_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id TEXT NOT NULL UNIQUE,
  webhook_secret TEXT NOT NULL,
  config_id UUID,
  source_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_configs_webhook_id 
  ON webhook_configs(webhook_id);

-- Cleanup function: delete processed webhook data older than retention period
CREATE OR REPLACE FUNCTION cleanup_old_webhook_buffer() RETURNS void AS $$
BEGIN
  DELETE FROM webhook_buffer 
  WHERE processed = TRUE 
  AND processed_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
