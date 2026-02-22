-- Migration: Add job persistence and paywall columns
-- Run this against your PostgreSQL database to add support for the new run/job system

-- ============================================
-- USERS TABLE: Free run tracking
-- ============================================

-- Add free run tracking column (1 free run per day globally)
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_run_used_at DATE;

-- Index for free run queries
CREATE INDEX IF NOT EXISTS idx_users_free_run ON users(free_run_used_at);

-- ============================================
-- CONFIGS TABLE: Continuous run settings
-- ============================================

-- Add global interval for continuous runs (milliseconds)
ALTER TABLE configs ADD COLUMN IF NOT EXISTS global_interval INTEGER;

-- Add reference to currently running continuous job
ALTER TABLE configs ADD COLUMN IF NOT EXISTS active_job_id UUID;

-- ============================================
-- AGGREGATION_JOBS TABLE: Enhanced job tracking
-- ============================================

-- Add job type column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'aggregation_jobs' AND column_name = 'job_type'
  ) THEN
    ALTER TABLE aggregation_jobs ADD COLUMN job_type TEXT DEFAULT 'one-time';
    ALTER TABLE aggregation_jobs ADD CONSTRAINT aggregation_jobs_job_type_check 
      CHECK (job_type IN ('one-time', 'continuous'));
  END IF;
END $$;

-- Add global interval for continuous jobs (milliseconds)
ALTER TABLE aggregation_jobs ADD COLUMN IF NOT EXISTS global_interval INTEGER;

-- Add run count (for continuous jobs, increments each interval tick)
ALTER TABLE aggregation_jobs ADD COLUMN IF NOT EXISTS run_count INTEGER DEFAULT 1;

-- Add last fetch timestamp (for continuous jobs, updated each interval tick)
ALTER TABLE aggregation_jobs ADD COLUMN IF NOT EXISTS last_fetch_at TIMESTAMPTZ;

-- ============================================
-- INDEXES for job queries
-- ============================================

-- Index for finding jobs by user
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_user ON aggregation_jobs(user_id);

-- Index for finding jobs by config
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_config ON aggregation_jobs(config_id);

-- Index for finding running jobs
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_status ON aggregation_jobs(status);

-- Index for finding running continuous jobs
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_continuous_running 
  ON aggregation_jobs(job_type, status) 
  WHERE job_type = 'continuous' AND status = 'running';

-- Index for finding jobs by config and status (for active job lookup)
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_config_status 
  ON aggregation_jobs(config_id, status);

-- Index for job history queries (by user, ordered by creation)
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_user_created 
  ON aggregation_jobs(user_id, created_at DESC);

-- Index for job history queries (by config, ordered by creation)
CREATE INDEX IF NOT EXISTS idx_aggregation_jobs_config_created 
  ON aggregation_jobs(config_id, created_at DESC);

-- ============================================
-- CLEANUP FUNCTION: Auto-cleanup old jobs
-- ============================================

-- Function to cleanup old aggregation jobs (default 90 days retention)
CREATE OR REPLACE FUNCTION cleanup_old_aggregation_jobs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM aggregation_jobs 
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
    AND status IN ('completed', 'failed', 'cancelled');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Done!
-- ============================================
-- Run this SQL against your database:
-- psql $DATABASE_URL -f src/plugins/storage/migrations/003_add_job_persistence.sql
