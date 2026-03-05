-- Outbound webhooks: notify external URLs on events (job completion, failure, etc.)
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{job.completed,job.failed}',
  signing_secret TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  description TEXT,
  -- Delivery tracking
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

-- Outbound webhook delivery log (recent deliveries for debugging)
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_user ON outbound_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config ON outbound_webhooks(config_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_active ON outbound_webhooks(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config_active ON outbound_webhooks(config_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_webhook ON outbound_webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_delivered ON outbound_webhook_deliveries(delivered_at DESC);

-- Backfill: Add config_id index to webhook_configs if missing
CREATE INDEX IF NOT EXISTS idx_webhook_configs_config ON webhook_configs(config_id);

-- Trigger for updated_at on outbound_webhooks
DROP TRIGGER IF EXISTS outbound_webhooks_updated_at ON outbound_webhooks;
CREATE TRIGGER outbound_webhooks_updated_at
  BEFORE UPDATE ON outbound_webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Cleanup: remove old delivery logs (keep 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_deliveries(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM outbound_webhook_deliveries
  WHERE delivered_at < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
