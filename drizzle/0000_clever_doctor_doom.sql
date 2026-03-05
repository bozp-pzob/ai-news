CREATE TABLE "aggregation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"job_type" text DEFAULT 'one-time',
	"global_interval" integer,
	"status" text DEFAULT 'pending',
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"items_fetched" integer DEFAULT 0,
	"items_processed" integer DEFAULT 0,
	"run_count" integer DEFAULT 1,
	"last_fetch_at" timestamp with time zone,
	"total_prompt_tokens" integer DEFAULT 0,
	"total_completion_tokens" integer DEFAULT 0,
	"total_ai_calls" integer DEFAULT 0,
	"estimated_cost_usd" numeric(10,6) DEFAULT '0',
	"error_message" text,
	"logs" jsonb DEFAULT '[]'::jsonb,
	"resolved_config_encrypted" "bytea",
	"resolved_secrets_encrypted" "bytea",
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid,
	"user_id" uuid,
	"wallet_address" text,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"query_params" jsonb,
	"status_code" integer,
	"response_time_ms" integer,
	"payment_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "config_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"shared_with_user_id" uuid,
	"shared_with_wallet" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"storage_type" text DEFAULT 'platform' NOT NULL,
	"external_db_url" text,
	"external_db_valid" boolean,
	"external_db_error" text,
	"monetization_enabled" boolean DEFAULT false,
	"price_per_query" numeric(10, 6) DEFAULT '0.001',
	"owner_wallet" text,
	"config_json" jsonb NOT NULL,
	"secrets" "bytea",
	"status" text DEFAULT 'idle',
	"last_run_at" timestamp with time zone,
	"last_run_duration_ms" integer,
	"last_error" text,
	"global_interval" integer,
	"active_job_id" uuid,
	"cron_expression" text,
	"schedule_timezone" text DEFAULT 'UTC',
	"runs_today" integer DEFAULT 0,
	"runs_today_reset_at" date DEFAULT CURRENT_DATE,
	"total_items" integer DEFAULT 0,
	"total_queries" integer DEFAULT 0,
	"total_revenue" numeric(12, 6) DEFAULT '0',
	"is_local_execution" boolean DEFAULT false,
	"hide_items" boolean DEFAULT false,
	"is_featured" boolean DEFAULT false,
	"featured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "configs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cursors" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" uuid NOT NULL,
	"cid" text NOT NULL,
	"message_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discord_guild_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_connection_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"channel_type" integer NOT NULL,
	"category_id" text,
	"category_name" text,
	"position" integer DEFAULT 0,
	"is_accessible" boolean DEFAULT true,
	"last_synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discord_guild_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"guild_icon" text,
	"bot_permissions" bigint DEFAULT 0,
	"added_at" timestamp with time zone DEFAULT now(),
	"is_active" boolean DEFAULT true,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discord_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"redirect_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "discord_oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "external_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"channel_type" text,
	"category_id" text,
	"category_name" text,
	"position" integer DEFAULT 0,
	"is_accessible" boolean DEFAULT true,
	"last_synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "external_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"external_name" text,
	"external_icon" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "external_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"state" text NOT NULL,
	"redirect_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "external_oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" uuid NOT NULL,
	"cid" text,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"title" text,
	"text" text,
	"link" text,
	"topics" text[],
	"date" bigint,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outbound_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"response_body" text,
	"error" text,
	"duration_ms" integer,
	"delivered_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outbound_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"config_id" uuid,
	"url" text NOT NULL,
	"events" text[] DEFAULT '{job.completed,job.failed}' NOT NULL,
	"signing_secret" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"description" text,
	"last_triggered_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0,
	"total_deliveries" integer DEFAULT 0,
	"total_successes" integer DEFAULT 0,
	"total_failures" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"payer_wallet" text NOT NULL,
	"amount" numeric(12, 6) NOT NULL,
	"platform_fee" numeric(12, 6) NOT NULL,
	"owner_revenue" numeric(12, 6) NOT NULL,
	"tx_signature" text,
	"status" text DEFAULT 'pending',
	"facilitator_response" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_parsers" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"path_pattern" text NOT NULL,
	"parser_code" text NOT NULL,
	"object_type_string" text,
	"version" integer DEFAULT 1,
	"consecutive_failures" integer DEFAULT 0,
	"last_success_at" bigint,
	"last_failure_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"sample_url" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"categories" jsonb,
	"markdown" text,
	"date" bigint,
	"content_hash" text,
	"start_date" bigint,
	"end_date" bigint,
	"granularity" text DEFAULT 'daily',
	"metadata" jsonb,
	"tokens_used" integer,
	"estimated_cost_usd" real,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "telegram_message_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"sender_id" text,
	"sender_name" text,
	"text" text,
	"message_date" timestamp with time zone NOT NULL,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "temp_retention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"data_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"reason" text,
	"retry_count" integer DEFAULT 0,
	"last_retry_at" timestamp with time zone,
	"last_retry_error" text,
	"expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '7 days',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_id" text NOT NULL,
	"email" text,
	"wallet_address" text,
	"tier" text DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"ai_calls_today" integer DEFAULT 0,
	"ai_calls_today_reset_at" date DEFAULT CURRENT_DATE,
	"tokens_used_today" integer DEFAULT 0,
	"tokens_used_today_reset_at" date DEFAULT CURRENT_DATE,
	"estimated_cost_today_cents" integer DEFAULT 0,
	"free_run_used_at" date,
	"is_banned" boolean DEFAULT false,
	"banned_at" timestamp with time zone,
	"banned_reason" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_privy_id_unique" UNIQUE("privy_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_buffer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_type" text,
	"headers" jsonb,
	"source_ip" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed" boolean DEFAULT false,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"config_id" uuid,
	"source_name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "webhook_configs_webhook_id_unique" UNIQUE("webhook_id")
);
--> statement-breakpoint
ALTER TABLE "aggregation_jobs" ADD CONSTRAINT "aggregation_jobs_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregation_jobs" ADD CONSTRAINT "aggregation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_shares" ADD CONSTRAINT "config_shares_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_shares" ADD CONSTRAINT "config_shares_shared_with_user_id_users_id_fk" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configs" ADD CONSTRAINT "configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cursors" ADD CONSTRAINT "cursors_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_guild_channels" ADD CONSTRAINT "discord_guild_channels_guild_connection_id_discord_guild_connections_id_fk" FOREIGN KEY ("guild_connection_id") REFERENCES "public"."discord_guild_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_guild_connections" ADD CONSTRAINT "discord_guild_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_oauth_states" ADD CONSTRAINT "discord_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_channels" ADD CONSTRAINT "external_channels_connection_id_external_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_connections" ADD CONSTRAINT "external_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_oauth_states" ADD CONSTRAINT "external_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhook_deliveries" ADD CONSTRAINT "outbound_webhook_deliveries_webhook_id_outbound_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."outbound_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_message_cache" ADD CONSTRAINT "telegram_message_cache_connection_id_external_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temp_retention" ADD CONSTRAINT "temp_retention_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_aggregation_jobs_config" ON "aggregation_jobs" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_aggregation_jobs_status" ON "aggregation_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_aggregation_jobs_user" ON "aggregation_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_api_usage_config" ON "api_usage" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_api_usage_user" ON "api_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_api_usage_created" ON "api_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_config_shares_config" ON "config_shares" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_config_shares_user" ON "config_shares" USING btree ("shared_with_user_id");--> statement-breakpoint
CREATE INDEX "idx_config_shares_wallet" ON "config_shares" USING btree ("shared_with_wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "configs_user_id_name_key" ON "configs" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "idx_configs_user" ON "configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_configs_slug" ON "configs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_configs_visibility" ON "configs" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_configs_status" ON "configs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cursors_config_id_cid_key" ON "cursors" USING btree ("config_id","cid");--> statement-breakpoint
CREATE INDEX "idx_cursors_config" ON "cursors" USING btree ("config_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_guild_channels_guild_connection_id_channel_id_key" ON "discord_guild_channels" USING btree ("guild_connection_id","channel_id");--> statement-breakpoint
CREATE INDEX "idx_discord_guild_channels_connection" ON "discord_guild_channels" USING btree ("guild_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_guild_connections_user_id_guild_id_key" ON "discord_guild_connections" USING btree ("user_id","guild_id");--> statement-breakpoint
CREATE INDEX "idx_discord_guild_connections_user" ON "discord_guild_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_discord_guild_connections_guild" ON "discord_guild_connections" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_discord_oauth_states_expires" ON "discord_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_discord_oauth_states_user" ON "discord_oauth_states" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_channels_connection_channel_key" ON "external_channels" USING btree ("connection_id","channel_id");--> statement-breakpoint
CREATE INDEX "idx_external_channels_connection" ON "external_channels" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_connections_user_platform_external_key" ON "external_connections" USING btree ("user_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "idx_external_connections_user" ON "external_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_external_connections_platform" ON "external_connections" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_external_oauth_states_expires" ON "external_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_external_oauth_states_user" ON "external_oauth_states" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_config_id_cid_key" ON "items" USING btree ("config_id","cid");--> statement-breakpoint
CREATE INDEX "idx_items_config" ON "items" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_items_config_type" ON "items" USING btree ("config_id","type");--> statement-breakpoint
CREATE INDEX "idx_items_config_source" ON "items" USING btree ("config_id","source");--> statement-breakpoint
CREATE INDEX "idx_outbound_webhook_deliveries_webhook" ON "outbound_webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_outbound_webhook_deliveries_delivered" ON "outbound_webhook_deliveries" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "idx_outbound_webhooks_user" ON "outbound_webhooks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_outbound_webhooks_config" ON "outbound_webhooks" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_payments_config" ON "payments" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_payments_payer" ON "payments" USING btree ("payer_wallet");--> statement-breakpoint
CREATE INDEX "idx_payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payments_created" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_site_parsers_domain" ON "site_parsers" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_site_parsers_lookup" ON "site_parsers" USING btree ("domain","path_pattern");--> statement-breakpoint
CREATE INDEX "idx_summaries_config" ON "summaries" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_summaries_config_type" ON "summaries" USING btree ("config_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_message_cache_connection_chat_message_key" ON "telegram_message_cache" USING btree ("connection_id","chat_id","message_id");--> statement-breakpoint
CREATE INDEX "idx_telegram_message_cache_connection_chat" ON "telegram_message_cache" USING btree ("connection_id","chat_id");--> statement-breakpoint
CREATE INDEX "idx_telegram_message_cache_date" ON "telegram_message_cache" USING btree ("message_date");--> statement-breakpoint
CREATE INDEX "idx_temp_retention_config" ON "temp_retention" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_temp_retention_expires" ON "temp_retention" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_users_privy" ON "users" USING btree ("privy_id");--> statement-breakpoint
CREATE INDEX "idx_users_wallet" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_users_tier" ON "users" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_ai_reset" ON "users" USING btree ("ai_calls_today_reset_at");--> statement-breakpoint
CREATE INDEX "idx_users_free_run" ON "users" USING btree ("free_run_used_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_buffer_received" ON "webhook_buffer" USING btree ("webhook_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_configs_webhook_id" ON "webhook_configs" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_configs_config" ON "webhook_configs" USING btree ("config_id");