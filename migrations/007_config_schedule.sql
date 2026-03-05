-- Add cron scheduling columns to configs table
ALTER TABLE configs
  ADD COLUMN IF NOT EXISTS cron_expression TEXT,
  ADD COLUMN IF NOT EXISTS schedule_timezone TEXT DEFAULT 'UTC';

-- Index for finding configs with active schedules
CREATE INDEX IF NOT EXISTS idx_configs_cron_active
  ON configs(cron_expression) WHERE cron_expression IS NOT NULL;
