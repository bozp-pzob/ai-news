/**
 * Drizzle ORM schema definition.
 *
 * This is the single source of truth for the platform database schema.
 * All tables, indexes, and relations are defined here in TypeScript.
 * Drizzle Kit generates SQL migrations from changes to this file.
 *
 * Note: pgvector `embedding vector(1536)` columns and some advanced SQL
 * (functions, triggers, views) are managed via custom SQL migrations
 * since they are not natively supported by Drizzle's DSL.
 *
 * @module db/schema
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  serial,
  timestamp,
  date,
  jsonb,
  decimal,
  real,
  uniqueIndex,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================
// Custom Types
// ============================================

/** Custom bytea type for encrypted columns */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Custom numeric(10,6) type — Drizzle's decimal() maps to `numeric` but we
 * want explicit precision for cost tracking columns.
 */
const numeric106 = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'numeric(10,6)';
  },
});

// ============================================
// PLATFORM TABLES
// ============================================

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  privyId: text('privy_id').notNull().unique(),
  email: text('email'),
  walletAddress: text('wallet_address'),
  tier: text('tier', { enum: ['free', 'paid', 'admin'] }).notNull().default('free'),
  settings: jsonb('settings').default({}),
  // AI usage tracking
  aiCallsToday: integer('ai_calls_today').default(0),
  aiCallsTodayResetAt: date('ai_calls_today_reset_at').default(sql`CURRENT_DATE`),
  // Token budget tracking
  tokensUsedToday: integer('tokens_used_today').default(0),
  tokensUsedTodayResetAt: date('tokens_used_today_reset_at').default(sql`CURRENT_DATE`),
  estimatedCostTodayCents: integer('estimated_cost_today_cents').default(0),
  // Free run tracking
  freeRunUsedAt: date('free_run_used_at'),
  // Admin: ban tracking
  isBanned: boolean('is_banned').default(false),
  bannedAt: timestamp('banned_at', { withTimezone: true }),
  bannedReason: text('banned_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_users_privy').on(table.privyId),
  index('idx_users_wallet').on(table.walletAddress),
  index('idx_users_tier').on(table.tier),
  index('idx_users_email').on(table.email),
  index('idx_users_ai_reset').on(table.aiCallsTodayResetAt),
  index('idx_users_free_run').on(table.freeRunUsedAt),
]);

export const configs = pgTable('configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  visibility: text('visibility', { enum: ['public', 'private', 'shared', 'unlisted'] }).notNull().default('private'),
  // Storage configuration
  storageType: text('storage_type', { enum: ['platform', 'external'] }).notNull().default('platform'),
  externalDbUrl: text('external_db_url'),
  externalDbValid: boolean('external_db_valid'),
  externalDbError: text('external_db_error'),
  // Monetization
  monetizationEnabled: boolean('monetization_enabled').default(false),
  pricePerQuery: decimal('price_per_query', { precision: 10, scale: 6 }).default('0.001'),
  ownerWallet: text('owner_wallet'),
  // Config definition
  configJson: jsonb('config_json').notNull(),
  secrets: bytea('secrets'),
  // Status
  status: text('status', { enum: ['idle', 'running', 'error', 'paused'] }).default('idle'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunDurationMs: integer('last_run_duration_ms'),
  lastError: text('last_error'),
  // Continuous run settings
  globalInterval: integer('global_interval'),
  activeJobId: uuid('active_job_id'),
  // Cron scheduling
  cronExpression: text('cron_expression'),
  scheduleTimezone: text('schedule_timezone').default('UTC'),
  // Limits tracking
  runsToday: integer('runs_today').default(0),
  runsTodayResetAt: date('runs_today_reset_at').default(sql`CURRENT_DATE`),
  // Stats
  totalItems: integer('total_items').default(0),
  totalQueries: integer('total_queries').default(0),
  totalRevenue: decimal('total_revenue', { precision: 12, scale: 6 }).default('0'),
  // Local execution
  isLocalExecution: boolean('is_local_execution').default(false),
  backendUrl: text('backend_url'),
  dataAccessToken: text('data_access_token'),
  // Data access
  hideItems: boolean('hide_items').default(false),
  // Admin: featured
  isFeatured: boolean('is_featured').default(false),
  featuredAt: timestamp('featured_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('configs_user_id_name_key').on(table.userId, table.name),
  index('idx_configs_user').on(table.userId),
  index('idx_configs_slug').on(table.slug),
  index('idx_configs_visibility').on(table.visibility),
  index('idx_configs_status').on(table.status),
]);

export const configShares = pgTable('config_shares', {
  id: uuid('id').defaultRandom().primaryKey(),
  configId: uuid('config_id').notNull().references(() => configs.id, { onDelete: 'cascade' }),
  sharedWithUserId: uuid('shared_with_user_id').references(() => users.id, { onDelete: 'cascade' }),
  sharedWithWallet: text('shared_with_wallet'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_config_shares_config').on(table.configId),
  index('idx_config_shares_user').on(table.sharedWithUserId),
  index('idx_config_shares_wallet').on(table.sharedWithWallet),
]);

// ============================================
// DISCORD INTEGRATION
// ============================================

export const discordGuildConnections = pgTable('discord_guild_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  guildId: text('guild_id').notNull(),
  guildName: text('guild_name').notNull(),
  guildIcon: text('guild_icon'),
  botPermissions: bigint('bot_permissions', { mode: 'number' }).default(0),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
  isActive: boolean('is_active').default(true),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('discord_guild_connections_user_id_guild_id_key').on(table.userId, table.guildId),
  index('idx_discord_guild_connections_user').on(table.userId),
  index('idx_discord_guild_connections_guild').on(table.guildId),
]);

export const discordGuildChannels = pgTable('discord_guild_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  guildConnectionId: uuid('guild_connection_id').notNull().references(() => discordGuildConnections.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  channelName: text('channel_name').notNull(),
  channelType: integer('channel_type').notNull(),
  categoryId: text('category_id'),
  categoryName: text('category_name'),
  position: integer('position').default(0),
  isAccessible: boolean('is_accessible').default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('discord_guild_channels_guild_connection_id_channel_id_key').on(table.guildConnectionId, table.channelId),
  index('idx_discord_guild_channels_connection').on(table.guildConnectionId),
]);

export const discordOauthStates = pgTable('discord_oauth_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  state: text('state').notNull().unique(),
  redirectUrl: text('redirect_url'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_discord_oauth_states_expires').on(table.expiresAt),
  index('idx_discord_oauth_states_user').on(table.userId),
]);

// ============================================
// API USAGE & PAYMENTS
// ============================================

export const apiUsage = pgTable('api_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  configId: uuid('config_id').references(() => configs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  walletAddress: text('wallet_address'),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull(),
  queryParams: jsonb('query_params'),
  statusCode: integer('status_code'),
  responseTimeMs: integer('response_time_ms'),
  paymentId: uuid('payment_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_api_usage_config').on(table.configId),
  index('idx_api_usage_user').on(table.userId),
  index('idx_api_usage_created').on(table.createdAt),
]);

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  configId: uuid('config_id').notNull().references(() => configs.id, { onDelete: 'cascade' }),
  payerWallet: text('payer_wallet').notNull(),
  amount: decimal('amount', { precision: 12, scale: 6 }).notNull(),
  platformFee: decimal('platform_fee', { precision: 12, scale: 6 }).notNull(),
  ownerRevenue: decimal('owner_revenue', { precision: 12, scale: 6 }).notNull(),
  txSignature: text('tx_signature'),
  status: text('status', { enum: ['pending', 'verified', 'settled', 'failed'] }).default('pending'),
  facilitatorResponse: jsonb('facilitator_response'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (table) => [
  index('idx_payments_config').on(table.configId),
  index('idx_payments_payer').on(table.payerWallet),
  index('idx_payments_status').on(table.status),
  index('idx_payments_created').on(table.createdAt),
]);

// ============================================
// CONTENT TABLES
// ============================================

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  configId: uuid('config_id').notNull().references(() => configs.id, { onDelete: 'cascade' }),
  cid: text('cid'),
  type: text('type').notNull(),
  source: text('source').notNull(),
  title: text('title'),
  text: text('text'),
  link: text('link'),
  topics: text('topics').array(),
  date: bigint('date', { mode: 'number' }),
  metadata: jsonb('metadata'),
  // embedding: vector(1536) — managed via custom SQL migration
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('items_config_id_cid_key').on(table.configId, table.cid),
  index('idx_items_config').on(table.configId),
  index('idx_items_config_type').on(table.configId, table.type),
  index('idx_items_config_source').on(table.configId, table.source),
]);

export const summaries = pgTable('summaries', {
  id: serial('id').primaryKey(),
  configId: uuid('config_id').notNull().references(() => configs.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title'),
  categories: jsonb('categories'),
  markdown: text('markdown'),
  date: bigint('date', { mode: 'number' }),
  contentHash: text('content_hash'),
  startDate: bigint('start_date', { mode: 'number' }),
  endDate: bigint('end_date', { mode: 'number' }),
  granularity: text('granularity').default('daily'),
  metadata: jsonb('metadata'),
  tokensUsed: integer('tokens_used'),
  estimatedCostUsd: real('estimated_cost_usd'),
  // embedding: vector(1536) — managed via custom SQL migration
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_summaries_config').on(table.configId),
  index('idx_summaries_config_type').on(table.configId, table.type),
]);

export const cursors = pgTable('cursors', {
  id: serial('id').primaryKey(),
  configId: uuid('config_id').notNull().references(() => configs.id, { onDelete: 'cascade' }),
  cid: text('cid').notNull(),
  messageId: text('message_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('cursors_config_id_cid_key').on(table.configId, table.cid),
  index('idx_cursors_config').on(table.configId),
]);

export const tempRetention = pgTable('temp_retention', {
  id: uuid('id').defaultRandom().primaryKey(),
  configId: uuid('config_id').notNull().references(() => configs.id, { onDelete: 'cascade' }),
  dataType: text('data_type', { enum: ['items', 'summary'] }).notNull(),
  data: jsonb('data').notNull(),
  reason: text('reason'),
  retryCount: integer('retry_count').default(0),
  lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),
  lastRetryError: text('last_retry_error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).default(sql`NOW() + INTERVAL '7 days'`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_temp_retention_config').on(table.configId),
  index('idx_temp_retention_expires').on(table.expiresAt),
]);

// ============================================
// BACKGROUND JOBS
// ============================================

export const aggregationJobs = pgTable('aggregation_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  configId: uuid('config_id').notNull().references(() => configs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobType: text('job_type', { enum: ['one-time', 'continuous'] }).default('one-time'),
  globalInterval: integer('global_interval'),
  status: text('status', { enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] }).default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  itemsFetched: integer('items_fetched').default(0),
  itemsProcessed: integer('items_processed').default(0),
  runCount: integer('run_count').default(1),
  lastFetchAt: timestamp('last_fetch_at', { withTimezone: true }),
  // AI token usage
  totalPromptTokens: integer('total_prompt_tokens').default(0),
  totalCompletionTokens: integer('total_completion_tokens').default(0),
  totalAiCalls: integer('total_ai_calls').default(0),
  estimatedCostUsd: numeric106('estimated_cost_usd').default('0'),
  // Error handling
  errorMessage: text('error_message'),
  logs: jsonb('logs').default([]),
  // Encrypted resolved config
  resolvedConfigEncrypted: bytea('resolved_config_encrypted'),
  resolvedSecretsEncrypted: bytea('resolved_secrets_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_aggregation_jobs_config').on(table.configId),
  index('idx_aggregation_jobs_status').on(table.status),
  index('idx_aggregation_jobs_user').on(table.userId),
]);

// ============================================
// WEBHOOK TABLES
// ============================================

export const webhookBuffer = pgTable('webhook_buffer', {
  id: uuid('id').defaultRandom().primaryKey(),
  webhookId: text('webhook_id').notNull(),
  payload: jsonb('payload').notNull(),
  contentType: text('content_type'),
  headers: jsonb('headers'),
  sourceIp: text('source_ip'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processed: boolean('processed').default(false),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => [
  index('idx_webhook_buffer_received').on(table.webhookId, table.receivedAt),
]);

export const webhookConfigs = pgTable('webhook_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  webhookId: text('webhook_id').notNull().unique(),
  webhookSecret: text('webhook_secret').notNull(),
  configId: uuid('config_id').references(() => configs.id, { onDelete: 'cascade' }),
  sourceName: text('source_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_webhook_configs_webhook_id').on(table.webhookId),
  index('idx_webhook_configs_config').on(table.configId),
]);

export const outboundWebhooks = pgTable('outbound_webhooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  configId: uuid('config_id').references(() => configs.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  events: text('events').array().notNull().default(sql`'{job.completed,job.failed}'`),
  signingSecret: text('signing_secret').notNull(),
  isActive: boolean('is_active').default(true),
  description: text('description'),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').default(0),
  totalDeliveries: integer('total_deliveries').default(0),
  totalSuccesses: integer('total_successes').default(0),
  totalFailures: integer('total_failures').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_outbound_webhooks_user').on(table.userId),
  index('idx_outbound_webhooks_config').on(table.configId),
]);

export const outboundWebhookDeliveries = pgTable('outbound_webhook_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  webhookId: uuid('webhook_id').notNull().references(() => outboundWebhooks.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_outbound_webhook_deliveries_webhook').on(table.webhookId),
  index('idx_outbound_webhook_deliveries_delivered').on(table.deliveredAt),
]);

// ============================================
// EXTERNAL CONNECTIONS (Multi-tenant platform connections)
// ============================================

export const externalConnections = pgTable('external_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  externalId: text('external_id').notNull(),
  externalName: text('external_name'),
  externalIcon: text('external_icon'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
  isActive: boolean('is_active').default(true),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('external_connections_user_platform_external_key').on(table.userId, table.platform, table.externalId),
  index('idx_external_connections_user').on(table.userId),
  index('idx_external_connections_platform').on(table.platform),
]);

export const externalChannels = pgTable('external_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  connectionId: uuid('connection_id').notNull().references(() => externalConnections.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  channelName: text('channel_name').notNull(),
  channelType: text('channel_type'),
  categoryId: text('category_id'),
  categoryName: text('category_name'),
  position: integer('position').default(0),
  isAccessible: boolean('is_accessible').default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('external_channels_connection_channel_key').on(table.connectionId, table.channelId),
  index('idx_external_channels_connection').on(table.connectionId),
]);

export const externalOauthStates = pgTable('external_oauth_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  state: text('state').notNull().unique(),
  redirectUrl: text('redirect_url'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_external_oauth_states_expires').on(table.expiresAt),
  index('idx_external_oauth_states_user').on(table.userId),
]);

export const telegramMessageCache = pgTable('telegram_message_cache', {
  id: uuid('id').defaultRandom().primaryKey(),
  connectionId: uuid('connection_id').notNull().references(() => externalConnections.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull(),
  messageId: text('message_id').notNull(),
  senderId: text('sender_id'),
  senderName: text('sender_name'),
  text: text('text'),
  messageDate: timestamp('message_date', { withTimezone: true }).notNull(),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('telegram_message_cache_connection_chat_message_key').on(table.connectionId, table.chatId, table.messageId),
  index('idx_telegram_message_cache_connection_chat').on(table.connectionId, table.chatId),
  index('idx_telegram_message_cache_date').on(table.messageDate),
]);

// ============================================
// SITE PARSERS (cached LLM-generated HTML parsers)
// ============================================

export const siteParsers = pgTable('site_parsers', {
  id: serial('id').primaryKey(),
  domain: text('domain').notNull(),
  pathPattern: text('path_pattern').notNull(),
  parserCode: text('parser_code').notNull(),
  objectTypeString: text('object_type_string'),
  version: integer('version').default(1),
  consecutiveFailures: integer('consecutive_failures').default(0),
  lastSuccessAt: bigint('last_success_at', { mode: 'number' }),
  lastFailureAt: bigint('last_failure_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  sampleUrl: text('sample_url'),
  metadata: jsonb('metadata'),
}, (table) => [
  index('idx_site_parsers_domain').on(table.domain),
  index('idx_site_parsers_lookup').on(table.domain, table.pathPattern),
]);
