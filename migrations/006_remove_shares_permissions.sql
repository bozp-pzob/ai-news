-- Migration 006: Remove unused permissions column from config_shares
-- The permissions column was never read or enforced anywhere in the codebase.
-- Sharing grants access based on row existence only (via requireConfigAccess middleware).
--
-- Run: psql $DATABASE_URL -f migrations/006_remove_shares_permissions.sql

ALTER TABLE config_shares DROP COLUMN IF EXISTS permissions;
