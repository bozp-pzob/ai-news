/**
 * External Connections - Shared Types
 * 
 * Platform-agnostic types for external service connections
 * (Discord, Telegram, Slack, etc.)
 */

export type PlatformType = 'discord' | 'telegram' | 'slack' | 'github';

export type AuthType = 'oauth' | 'webhook' | 'token';

/**
 * External connection record from database
 */
export interface ExternalConnection {
  id: string;
  userId: string;
  platform: PlatformType;
  externalId: string;
  externalName: string;
  externalIcon?: string;
  permissions?: number;
  isActive: boolean;
  lastVerifiedAt?: Date;
  metadata: Record<string, any>;
  addedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * External connection with channel count (for API responses)
 */
export interface ExternalConnectionWithCount extends ExternalConnection {
  channelCount: number;
}

/**
 * External channel/resource record from database
 */
export interface ExternalChannel {
  id: string;
  connectionId: string;
  externalId: string;
  externalName: string;
  resourceType: number | string;
  parentId?: string;
  parentName?: string;
  position: number;
  isAccessible: boolean;
  metadata: Record<string, any>;
  lastSyncedAt?: Date;
}

/**
 * OAuth state record from database
 */
export interface ExternalOAuthState {
  id: string;
  userId: string;
  platform: PlatformType;
  state: string;
  redirectUrl?: string;
  metadata: Record<string, any>;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Result from generating an auth URL
 */
export interface AuthUrlResult {
  url: string;
  state: string;
  /** Instructions for platforms that need user action (e.g., Telegram) */
  instructions?: string;
  /** Platform type */
  platform: PlatformType;
  /** Auth type used */
  authType: AuthType;
}

/**
 * OAuth callback parameters (platform-agnostic)
 */
export interface OAuthCallbackParams {
  code?: string;
  state: string;
  platform: PlatformType;
  /** Platform-specific params (guild_id for Discord, etc.) */
  [key: string]: any;
}

/**
 * Webhook payload (for Telegram-style connections)
 */
export interface WebhookPayload {
  platform: PlatformType;
  /** Raw webhook data */
  data: any;
}

/**
 * Channel validation result
 */
export interface ValidationResult {
  valid: boolean;
  invalidChannels: string[];
}

/**
 * Platform info for frontend display
 */
export interface PlatformInfo {
  platform: PlatformType;
  displayName: string;
  icon: string;
  description: string;
  authType: AuthType;
  resourceTypes: string[];
  isEnabled: boolean;
  /** Instructions shown to user */
  connectionInstructions?: string;
}

/**
 * Create connection request
 */
export interface CreateConnectionRequest {
  userId: string;
  platform: PlatformType;
  externalId: string;
  externalName: string;
  externalIcon?: string;
  permissions?: number;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Channel sync options
 */
export interface SyncChannelsOptions {
  /** Force refresh even if recently synced */
  force?: boolean;
}

/**
 * Telegram-specific types
 */
export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface TelegramMessage {
  messageId: number;
  chatId: number;
  fromUserId?: number;
  fromUsername?: string;
  text?: string;
  caption?: string;
  date: number;
  hasMedia: boolean;
  replyToMessageId?: number;
}

/**
 * Telegram message cache record
 */
export interface TelegramMessageCache {
  id: string;
  connectionId: string;
  chatId: string;
  messageId: number;
  fromUserId?: number;
  fromUsername?: string;
  text?: string;
  caption?: string;
  messageType: string;
  hasMedia: boolean;
  replyToMessageId?: number;
  rawMessage: any;
  messageDate: Date;
  createdAt: Date;
}

/**
 * Pending connection (for Telegram-style flows)
 */
export interface PendingConnection {
  token: string;
  userId: string;
  platform: PlatformType;
  expiresAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Database row types (snake_case)
 */
export interface ExternalConnectionRow {
  id: string;
  user_id: string;
  platform: string;
  external_id: string;
  external_name: string;
  external_icon: string | null;
  permissions: number | null;
  is_active: boolean;
  last_verified_at: Date | null;
  metadata: Record<string, any>;
  access_token_encrypted: Buffer | null;
  refresh_token_encrypted: Buffer | null;
  token_expires_at: Date | null;
  added_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ExternalChannelRow {
  id: string;
  connection_id: string;
  external_id: string;
  external_name: string;
  resource_type: number;
  parent_id: string | null;
  parent_name: string | null;
  position: number;
  is_accessible: boolean;
  metadata: Record<string, any>;
  last_synced_at: Date | null;
}

export interface ExternalOAuthStateRow {
  id: string;
  user_id: string;
  platform: string;
  state: string;
  redirect_url: string | null;
  metadata: Record<string, any>;
  expires_at: Date;
  created_at: Date;
}

/**
 * Map database row to ExternalConnection
 */
export function mapConnectionRow(row: ExternalConnectionRow): ExternalConnection {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform as PlatformType,
    externalId: row.external_id,
    externalName: row.external_name,
    externalIcon: row.external_icon || undefined,
    permissions: row.permissions || undefined,
    isActive: row.is_active,
    lastVerifiedAt: row.last_verified_at || undefined,
    metadata: row.metadata || {},
    addedAt: row.added_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map database row to ExternalChannel
 */
export function mapChannelRow(row: ExternalChannelRow): ExternalChannel {
  return {
    id: row.id,
    connectionId: row.connection_id,
    externalId: row.external_id,
    externalName: row.external_name,
    resourceType: row.resource_type,
    parentId: row.parent_id || undefined,
    parentName: row.parent_name || undefined,
    position: row.position,
    isAccessible: row.is_accessible,
    metadata: row.metadata || {},
    lastSyncedAt: row.last_synced_at || undefined,
  };
}

/**
 * Map database row to ExternalOAuthState
 */
export function mapOAuthStateRow(row: ExternalOAuthStateRow): ExternalOAuthState {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform as PlatformType,
    state: row.state,
    redirectUrl: row.redirect_url || undefined,
    metadata: row.metadata || {},
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
