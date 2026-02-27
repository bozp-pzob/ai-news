-- Migration 002: Add encrypted resolved config/secrets to aggregation_jobs
-- 
-- Stores the fully-resolved config and secrets (with all $SECRET:uuid$ references
-- and platform credentials already injected) encrypted at rest using AES-256-GCM.
-- This allows continuous jobs to be resumed after a server restart without needing
-- the browser to re-resolve secrets.
--
-- Encryption uses the same SECRETS_ENCRYPTION_KEY env var and per-record key
-- derivation (PBKDF2 with jobId as context) as the existing configs.secrets column.

ALTER TABLE aggregation_jobs
  ADD COLUMN IF NOT EXISTS resolved_config_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS resolved_secrets_encrypted BYTEA;

COMMENT ON COLUMN aggregation_jobs.resolved_config_encrypted IS 'AES-256-GCM encrypted resolved config JSON (with all secrets/credentials injected). Keyed by jobId.';
COMMENT ON COLUMN aggregation_jobs.resolved_secrets_encrypted IS 'AES-256-GCM encrypted secrets map (Record<string,string>). Keyed by jobId.';
