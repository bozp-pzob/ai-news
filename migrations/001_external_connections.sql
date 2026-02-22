-- ============================================
-- Migration: External Connections System
-- Renames Discord-specific tables to generic external_* tables
-- and adds support for multiple platforms (Discord, Telegram, Slack)
-- ============================================

-- ============================================
-- Step 1: Rename existing tables
-- ============================================

-- Rename discord_guild_connections -> external_connections
ALTER TABLE IF EXISTS discord_guild_connections RENAME TO external_connections;

-- Rename discord_guild_channels -> external_channels  
ALTER TABLE IF EXISTS discord_guild_channels RENAME TO external_channels;

-- Rename discord_oauth_states -> external_oauth_states
ALTER TABLE IF EXISTS discord_oauth_states RENAME TO external_oauth_states;

-- ============================================
-- Step 2: Add new columns to external_connections
-- ============================================

-- Add platform column (default to 'discord' for existing data)
ALTER TABLE external_connections 
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'discord';

-- Rename guild_id -> external_id
ALTER TABLE external_connections 
  RENAME COLUMN guild_id TO external_id;

-- Rename guild_name -> external_name
ALTER TABLE external_connections 
  RENAME COLUMN guild_name TO external_name;

-- Rename guild_icon -> external_icon  
ALTER TABLE external_connections 
  RENAME COLUMN guild_icon TO external_icon;

-- Rename bot_permissions -> permissions
ALTER TABLE external_connections 
  RENAME COLUMN bot_permissions TO permissions;

-- Add OAuth token columns (for platforms that need stored tokens)
ALTER TABLE external_connections
  ADD COLUMN IF NOT EXISTS access_token_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

-- Add metadata column for platform-specific data
ALTER TABLE external_connections
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ============================================
-- Step 3: Update external_channels columns
-- ============================================

-- Rename guild_connection_id -> connection_id
ALTER TABLE external_channels 
  RENAME COLUMN guild_connection_id TO connection_id;

-- Rename channel_id -> external_id
ALTER TABLE external_channels 
  RENAME COLUMN channel_id TO external_id;

-- Rename channel_name -> external_name
ALTER TABLE external_channels 
  RENAME COLUMN channel_name TO external_name;

-- Rename channel_type -> resource_type
ALTER TABLE external_channels 
  RENAME COLUMN channel_type TO resource_type;

-- Rename category_id -> parent_id
ALTER TABLE external_channels 
  RENAME COLUMN category_id TO parent_id;

-- Rename category_name -> parent_name
ALTER TABLE external_channels 
  RENAME COLUMN category_name TO parent_name;

-- Add metadata column
ALTER TABLE external_channels
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ============================================
-- Step 4: Update external_oauth_states columns
-- ============================================

-- Add platform column
ALTER TABLE external_oauth_states
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'discord';

-- Add metadata column
ALTER TABLE external_oauth_states
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ============================================
-- Step 5: Create Telegram message cache table
-- ============================================

CREATE TABLE IF NOT EXISTS telegram_message_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id UUID NOT NULL REFERENCES external_connections(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  from_user_id BIGINT,
  from_username TEXT,
  text TEXT,
  caption TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  has_media BOOLEAN DEFAULT FALSE,
  reply_to_message_id BIGINT,
  raw_message JSONB,
  message_date TIMESTAMPTZ NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate messages
  UNIQUE(connection_id, chat_id, message_id)
);

-- ============================================
-- Step 6: Update indexes
-- ============================================

-- Drop old indexes
DROP INDEX IF EXISTS idx_discord_guild_connections_user;
DROP INDEX IF EXISTS idx_discord_guild_connections_guild;
DROP INDEX IF EXISTS idx_discord_guild_connections_active;
DROP INDEX IF EXISTS idx_discord_guild_connections_user_active;
DROP INDEX IF EXISTS idx_discord_guild_channels_connection;
DROP INDEX IF EXISTS idx_discord_guild_channels_accessible;
DROP INDEX IF EXISTS idx_discord_oauth_states_expires;
DROP INDEX IF EXISTS idx_discord_oauth_states_user;

-- Create new indexes for external_connections
CREATE INDEX IF NOT EXISTS idx_external_connections_user ON external_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_external_connections_external ON external_connections(external_id);
CREATE INDEX IF NOT EXISTS idx_external_connections_platform ON external_connections(platform);
CREATE INDEX IF NOT EXISTS idx_external_connections_active ON external_connections(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_external_connections_user_active ON external_connections(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_external_connections_user_platform ON external_connections(user_id, platform);

-- Create new indexes for external_channels
CREATE INDEX IF NOT EXISTS idx_external_channels_connection ON external_channels(connection_id);
CREATE INDEX IF NOT EXISTS idx_external_channels_accessible ON external_channels(connection_id, is_accessible) WHERE is_accessible = TRUE;

-- Create new indexes for external_oauth_states
CREATE INDEX IF NOT EXISTS idx_external_oauth_states_expires ON external_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_external_oauth_states_user ON external_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_external_oauth_states_platform ON external_oauth_states(platform);

-- Create indexes for telegram_message_cache
CREATE INDEX IF NOT EXISTS idx_telegram_cache_connection ON telegram_message_cache(connection_id);
CREATE INDEX IF NOT EXISTS idx_telegram_cache_chat ON telegram_message_cache(connection_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_cache_date ON telegram_message_cache(connection_id, message_date DESC);

-- ============================================
-- Step 7: Update unique constraints
-- ============================================

-- Update unique constraint on external_connections
ALTER TABLE external_connections DROP CONSTRAINT IF EXISTS discord_guild_connections_user_id_guild_id_key;
ALTER TABLE external_connections ADD CONSTRAINT external_connections_user_platform_external_key 
  UNIQUE(user_id, platform, external_id);

-- Update unique constraint on external_channels  
ALTER TABLE external_channels DROP CONSTRAINT IF EXISTS discord_guild_channels_guild_connection_id_channel_id_key;
ALTER TABLE external_channels ADD CONSTRAINT external_channels_connection_external_key
  UNIQUE(connection_id, external_id);

-- ============================================
-- Step 8: Update foreign key references
-- ============================================

-- external_channels foreign key (may already be updated by rename)
ALTER TABLE external_channels DROP CONSTRAINT IF EXISTS discord_guild_channels_guild_connection_id_fkey;
ALTER TABLE external_channels ADD CONSTRAINT external_channels_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES external_connections(id) ON DELETE CASCADE;

-- ============================================
-- Step 9: Update triggers
-- ============================================

-- Drop old trigger
DROP TRIGGER IF EXISTS discord_guild_connections_updated_at ON external_connections;

-- Create new trigger
CREATE TRIGGER external_connections_updated_at
  BEFORE UPDATE ON external_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Step 10: Update cleanup functions
-- ============================================

-- Update cleanup function for OAuth states
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM external_oauth_states WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old Telegram message cache (keep 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_telegram_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM telegram_message_cache WHERE cached_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Mark inactive connections (platform-agnostic)
CREATE OR REPLACE FUNCTION mark_inactive_connections(p_platform TEXT, p_external_ids TEXT[])
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE external_connections 
  SET is_active = FALSE, updated_at = NOW()
  WHERE platform = p_platform 
    AND external_id = ANY(p_external_ids) 
    AND is_active = TRUE;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Done!
-- ============================================
SELECT 'Migration completed successfully!' as status;
