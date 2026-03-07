-- ============================================================
-- Migration 012: Standalone backend support columns
-- ============================================================
-- Adds backend_url and data_access_token columns to configs
-- for standalone backend data proxying.
--
-- backend_url: the URL of the user's standalone backend server
--   (owner-only, never exposed publicly)
-- data_access_token: encrypted data access token for authenticating
--   proxy requests to the standalone backend
--
-- All statements are idempotent (IF NOT EXISTS).
-- ============================================================

BEGIN;

-- Add columns for standalone backend data proxying
ALTER TABLE configs
  ADD COLUMN IF NOT EXISTS backend_url TEXT,
  ADD COLUMN IF NOT EXISTS data_access_token TEXT;

-- Comment the columns for documentation
COMMENT ON COLUMN configs.backend_url IS 'URL of standalone backend server (owner-only, never exposed publicly)';
COMMENT ON COLUMN configs.data_access_token IS 'Encrypted data access token for authenticating proxy requests to standalone backend';

COMMIT;
