/**
 * Discord Channel Registry
 *
 * Manages a normalized registry of Discord channels with:
 * - Channel metadata and settings tracking
 * - Activity metrics and velocity calculation
 * - Name/topic/category change history
 * - AI-generated channel insights
 *
 * This eliminates scattered channel data and provides a single source
 * of truth for Discord channel information and analytics.
 */

import { Database } from "sqlite";
import sqlite3 from "sqlite3";

// ============================================================================
// Types
// ============================================================================

export interface DiscordChannel {
  // Identity
  id: string;
  guildId: string;
  guildName: string;

  // Current State
  name: string;
  topic: string | null;
  categoryId: string | null;
  categoryName: string | null;

  // Discord Metadata
  type: number;
  position: number | null;
  nsfw: boolean;
  rateLimitPerUser: number;
  createdAt: number;

  // Tracking State
  isTracked: boolean;
  isMuted: boolean;
  firstSeen: number;
  lastSeen: number;

  // Activity Metrics
  currentVelocity: number;
  lastActivityAt: number | null;
  totalMessages: number;

  // Change History
  nameChanges: ChannelNameChange[];
  topicChanges: ChannelTopicChange[];
  categoryChanges: ChannelCategoryChange[];
  activityHistory: ChannelActivitySnapshot[];

  // AI Insights
  aiSummary: string | null;
  aiMannerisms: string | null;
  aiLastAnalyzed: number | null;

  // User Notes
  notes: string | null;

  // Timestamps
  createdAt_registry: number;
  updatedAt: number;
}

export interface ChannelNameChange {
  name: string;
  observedAt: string; // YYYY-MM-DD
}

export interface ChannelTopicChange {
  topic: string | null;
  observedAt: string; // YYYY-MM-DD
}

export interface ChannelCategoryChange {
  categoryId: string | null;
  categoryName: string | null;
  observedAt: string; // YYYY-MM-DD
}

export interface ChannelActivitySnapshot {
  date: string; // YYYY-MM-DD
  messageCount: number;
  velocity: number; // msgs/day
}

interface DiscordChannelRow {
  id: string;
  guildId: string;
  guildName: string;
  name: string;
  topic: string | null;
  categoryId: string | null;
  categoryName: string | null;
  type: number;
  position: number | null;
  nsfw: number;
  rateLimitPerUser: number;
  createdAt: number;
  isTracked: number;
  isMuted: number;
  firstSeen: number;
  lastSeen: number;
  currentVelocity: number;
  lastActivityAt: number | null;
  totalMessages: number;
  nameChanges: string;
  topicChanges: string;
  categoryChanges: string;
  activityHistory: string;
  aiSummary: string | null;
  aiMannerisms: string | null;
  aiLastAnalyzed: number | null;
  notes: string | null;
  createdAt_registry: number;
  updatedAt: number;
}

export interface RegistryStats {
  totalChannels: number;
  totalGuilds: number;
  trackedChannels: number;
  mutedChannels: number;
  hotChannels: number;      // >50 msgs/day
  activeChannels: number;   // 7-50 msgs/day
  moderateChannels: number; // 1.5-7 msgs/day
  quietChannels: number;    // <1.5 msgs/day
  channelsWithNameChanges: number;
  channelsWithTopicChanges: number;
  channelsWithCategoryChanges: number;
  totalMessages: number;
  mostActiveChannel: { name: string; velocity: number } | null;
}

// ============================================================================
// Discord Channel Registry
// ============================================================================

export class DiscordChannelRegistry {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Initialize the discord_channels table
   */
  async initialize(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS discord_channels (
        id TEXT PRIMARY KEY,
        guildId TEXT NOT NULL,
        guildName TEXT NOT NULL,
        name TEXT NOT NULL,
        topic TEXT,
        categoryId TEXT,
        categoryName TEXT,
        type INTEGER NOT NULL,
        position INTEGER,
        nsfw INTEGER DEFAULT 0,
        rateLimitPerUser INTEGER DEFAULT 0,
        createdAt INTEGER NOT NULL,
        isTracked INTEGER DEFAULT 0,
        isMuted INTEGER DEFAULT 0,
        firstSeen INTEGER NOT NULL,
        lastSeen INTEGER NOT NULL,
        currentVelocity REAL DEFAULT 0,
        lastActivityAt INTEGER,
        totalMessages INTEGER DEFAULT 0,
        nameChanges TEXT NOT NULL DEFAULT '[]',
        topicChanges TEXT NOT NULL DEFAULT '[]',
        categoryChanges TEXT NOT NULL DEFAULT '[]',
        activityHistory TEXT NOT NULL DEFAULT '[]',
        aiSummary TEXT,
        aiMannerisms TEXT,
        aiLastAnalyzed INTEGER,
        notes TEXT,
        createdAt_registry INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_discord_channels_guildId ON discord_channels(guildId);
      CREATE INDEX IF NOT EXISTS idx_discord_channels_isTracked ON discord_channels(isTracked);
      CREATE INDEX IF NOT EXISTS idx_discord_channels_categoryId ON discord_channels(categoryId);
      CREATE INDEX IF NOT EXISTS idx_discord_channels_lastActivityAt ON discord_channels(lastActivityAt);
      CREATE INDEX IF NOT EXISTS idx_discord_channels_currentVelocity ON discord_channels(currentVelocity);
    `);
  }

  /**
   * Upsert a channel, tracking name/topic/category changes
   */
  async upsertChannel(params: {
    id: string;
    guildId: string;
    guildName: string;
    name: string;
    topic?: string | null;
    categoryId?: string | null;
    categoryName?: string | null;
    type: number;
    position?: number | null;
    nsfw?: boolean;
    rateLimitPerUser?: number;
    createdAt: number;
    observedAt: string; // YYYY-MM-DD
    isTracked?: boolean;
    isMuted?: boolean;
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const observedTimestamp = Math.floor(new Date(params.observedAt).getTime() / 1000);

    // Check if channel exists
    const existing = await this.getChannelById(params.id);

    if (!existing) {
      // New channel - create initial record
      await this.db.run(
        `INSERT INTO discord_channels (
          id, guildId, guildName, name, topic, categoryId, categoryName,
          type, position, nsfw, rateLimitPerUser, createdAt,
          isTracked, isMuted, firstSeen, lastSeen,
          currentVelocity, lastActivityAt, totalMessages,
          nameChanges, topicChanges, categoryChanges, activityHistory,
          aiSummary, aiMannerisms, aiLastAnalyzed, notes,
          createdAt_registry, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.id,
          params.guildId,
          params.guildName,
          params.name,
          params.topic ?? null,
          params.categoryId ?? null,
          params.categoryName ?? null,
          params.type,
          params.position ?? null,
          params.nsfw ? 1 : 0,
          params.rateLimitPerUser ?? 0,
          params.createdAt,
          params.isTracked ? 1 : 0,
          params.isMuted ? 1 : 0,
          observedTimestamp,
          observedTimestamp,
          0, // currentVelocity
          null, // lastActivityAt
          0, // totalMessages
          JSON.stringify([{ name: params.name, observedAt: params.observedAt }]),
          JSON.stringify([{ topic: params.topic ?? null, observedAt: params.observedAt }]),
          JSON.stringify([{ categoryId: params.categoryId ?? null, categoryName: params.categoryName ?? null, observedAt: params.observedAt }]),
          JSON.stringify([]), // activityHistory
          null, // aiSummary
          null, // aiMannerisms
          null, // aiLastAnalyzed
          null, // notes
          now,
          now
        ]
      );
    } else {
      // Existing channel - check for changes
      const updates: string[] = [];
      const values: any[] = [];

      // Update guildName if changed
      if (params.guildName !== existing.guildName) {
        updates.push("guildName = ?");
        values.push(params.guildName);
      }

      // Track name change if different
      let nameChanges = existing.nameChanges;
      if (params.name !== existing.name) {
        nameChanges = [
          { name: params.name, observedAt: params.observedAt },
          ...nameChanges
        ];
        updates.push("nameChanges = ?");
        values.push(JSON.stringify(nameChanges));
        updates.push("name = ?");
        values.push(params.name);
      }

      // Track topic change if different
      let topicChanges = existing.topicChanges;
      const newTopic = params.topic ?? null;
      if (newTopic !== existing.topic) {
        topicChanges = [
          { topic: newTopic, observedAt: params.observedAt },
          ...topicChanges
        ];
        updates.push("topicChanges = ?");
        values.push(JSON.stringify(topicChanges));
        updates.push("topic = ?");
        values.push(newTopic);
      }

      // Track category change if different
      let categoryChanges = existing.categoryChanges;
      const newCategoryId = params.categoryId ?? null;
      const newCategoryName = params.categoryName ?? null;
      if (newCategoryId !== existing.categoryId || newCategoryName !== existing.categoryName) {
        categoryChanges = [
          { categoryId: newCategoryId, categoryName: newCategoryName, observedAt: params.observedAt },
          ...categoryChanges
        ];
        updates.push("categoryChanges = ?");
        values.push(JSON.stringify(categoryChanges));
        updates.push("categoryId = ?");
        values.push(newCategoryId);
        updates.push("categoryName = ?");
        values.push(newCategoryName);
      }

      // Update other metadata if provided
      if (params.type !== undefined && params.type !== existing.type) {
        updates.push("type = ?");
        values.push(params.type);
      }

      if (params.position !== undefined && params.position !== existing.position) {
        updates.push("position = ?");
        values.push(params.position);
      }

      if (params.nsfw !== undefined && params.nsfw !== existing.nsfw) {
        updates.push("nsfw = ?");
        values.push(params.nsfw ? 1 : 0);
      }

      if (params.rateLimitPerUser !== undefined && params.rateLimitPerUser !== existing.rateLimitPerUser) {
        updates.push("rateLimitPerUser = ?");
        values.push(params.rateLimitPerUser);
      }

      if (params.isTracked !== undefined && params.isTracked !== existing.isTracked) {
        updates.push("isTracked = ?");
        values.push(params.isTracked ? 1 : 0);
      }

      if (params.isMuted !== undefined && params.isMuted !== existing.isMuted) {
        updates.push("isMuted = ?");
        values.push(params.isMuted ? 1 : 0);
      }

      // Update lastSeen if this observation is newer
      if (observedTimestamp > existing.lastSeen) {
        updates.push("lastSeen = ?");
        values.push(observedTimestamp);
      }

      // Update firstSeen if this observation is older
      if (observedTimestamp < existing.firstSeen) {
        updates.push("firstSeen = ?");
        values.push(observedTimestamp);
      }

      updates.push("updatedAt = ?");
      values.push(now);

      if (updates.length > 0) {
        values.push(params.id);
        await this.db.run(
          `UPDATE discord_channels SET ${updates.join(", ")} WHERE id = ?`,
          values
        );
      }
    }
  }

  /**
   * Record daily activity and recalculate velocity
   */
  async recordActivity(channelId: string, date: string, messageCount: number): Promise<void> {
    const channel = await this.getChannelById(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found in registry`);
    }

    // Add or update activity snapshot for this date
    let activityHistory = channel.activityHistory;
    const existingIndex = activityHistory.findIndex(a => a.date === date);

    if (existingIndex >= 0) {
      // Update existing entry
      activityHistory[existingIndex].messageCount = messageCount;
    } else {
      // Add new entry
      activityHistory = [
        { date, messageCount, velocity: 0 },
        ...activityHistory
      ];
    }

    // Sort by date descending
    activityHistory.sort((a, b) => b.date.localeCompare(a.date));

    // Limit to 90 days
    activityHistory = activityHistory.slice(0, 90);

    // Calculate rolling 7-day velocity
    const recentActivity = activityHistory.slice(0, 7);
    let totalMessages = 0;
    let oldestDate: string | null = null;
    let newestDate: string | null = null;

    for (const snapshot of recentActivity) {
      totalMessages += snapshot.messageCount;
      if (!newestDate || snapshot.date > newestDate) newestDate = snapshot.date;
      if (!oldestDate || snapshot.date < oldestDate) oldestDate = snapshot.date;
    }

    let velocity = 0;
    if (newestDate && oldestDate) {
      const daysDiff = Math.max(1, (new Date(newestDate).getTime() - new Date(oldestDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      velocity = totalMessages / daysDiff;
    }

    // Update activity history with calculated velocities
    for (let i = 0; i < activityHistory.length; i++) {
      const window = activityHistory.slice(i, Math.min(i + 7, activityHistory.length));
      if (window.length > 0) {
        const windowTotal = window.reduce((sum, s) => sum + s.messageCount, 0);
        const windowDays = window.length;
        activityHistory[i].velocity = windowTotal / windowDays;
      }
    }

    // Update database
    const dateTimestamp = Math.floor(new Date(date).getTime() / 1000);
    await this.db.run(
      `UPDATE discord_channels
       SET activityHistory = ?,
           currentVelocity = ?,
           lastActivityAt = ?,
           totalMessages = totalMessages + ?,
           updatedAt = ?
       WHERE id = ?`,
      [
        JSON.stringify(activityHistory),
        velocity,
        dateTimestamp,
        messageCount,
        Math.floor(Date.now() / 1000),
        channelId
      ]
    );
  }

  /**
   * Get channel by ID
   */
  async getChannelById(id: string): Promise<DiscordChannel | null> {
    const row = await this.db.get<DiscordChannelRow>(
      "SELECT * FROM discord_channels WHERE id = ?",
      id
    );

    return row ? this.parseChannelRow(row) : null;
  }

  /**
   * Get all channels for a guild
   */
  async getChannelsByGuild(guildId: string): Promise<DiscordChannel[]> {
    const rows = await this.db.all<DiscordChannelRow[]>(
      "SELECT * FROM discord_channels WHERE guildId = ? ORDER BY position ASC, name ASC",
      guildId
    );

    return rows.map(row => this.parseChannelRow(row));
  }

  /**
   * Get all tracked channels
   */
  async getTrackedChannels(): Promise<DiscordChannel[]> {
    const rows = await this.db.all<DiscordChannelRow[]>(
      "SELECT * FROM discord_channels WHERE isTracked = 1 ORDER BY currentVelocity DESC"
    );

    return rows.map(row => this.parseChannelRow(row));
  }

  /**
   * Get active channels (above velocity threshold)
   */
  async getActiveChannels(minVelocity: number = 1.5): Promise<DiscordChannel[]> {
    const rows = await this.db.all<DiscordChannelRow[]>(
      "SELECT * FROM discord_channels WHERE currentVelocity >= ? ORDER BY currentVelocity DESC",
      minVelocity
    );

    return rows.map(row => this.parseChannelRow(row));
  }

  /**
   * Get inactive channels (no activity in X days)
   */
  async getInactiveChannels(daysSinceActivity: number = 90): Promise<DiscordChannel[]> {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - (daysSinceActivity * 24 * 60 * 60);
    const rows = await this.db.all<DiscordChannelRow[]>(
      `SELECT * FROM discord_channels
       WHERE lastActivityAt IS NULL OR lastActivityAt < ?
       ORDER BY lastActivityAt DESC`,
      cutoffTimestamp
    );

    return rows.map(row => this.parseChannelRow(row));
  }

  /**
   * Update AI-generated insights
   */
  async updateAISummary(channelId: string, summary: string, mannerisms: string): Promise<void> {
    await this.db.run(
      `UPDATE discord_channels
       SET aiSummary = ?, aiMannerisms = ?, aiLastAnalyzed = ?, updatedAt = ?
       WHERE id = ?`,
      [summary, mannerisms, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), channelId]
    );
  }

  /**
   * Set tracked status
   */
  async setTracked(channelId: string, tracked: boolean): Promise<void> {
    await this.db.run(
      "UPDATE discord_channels SET isTracked = ?, updatedAt = ? WHERE id = ?",
      [tracked ? 1 : 0, Math.floor(Date.now() / 1000), channelId]
    );
  }

  /**
   * Set muted status
   */
  async setMuted(channelId: string, muted: boolean): Promise<void> {
    await this.db.run(
      "UPDATE discord_channels SET isMuted = ?, updatedAt = ? WHERE id = ?",
      [muted ? 1 : 0, Math.floor(Date.now() / 1000), channelId]
    );
  }

  /**
   * Update user notes
   */
  async updateNotes(channelId: string, notes: string): Promise<void> {
    await this.db.run(
      "UPDATE discord_channels SET notes = ?, updatedAt = ? WHERE id = ?",
      [notes, Math.floor(Date.now() / 1000), channelId]
    );
  }

  /**
   * Get registry statistics
   */
  async getStats(): Promise<RegistryStats> {
    const totalChannels = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels"
    );

    const totalGuilds = await this.db.get<{ count: number }>(
      "SELECT COUNT(DISTINCT guildId) as count FROM discord_channels"
    );

    const trackedChannels = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE isTracked = 1"
    );

    const mutedChannels = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE isMuted = 1"
    );

    const hotChannels = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE currentVelocity > 50"
    );

    const activeChannels = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE currentVelocity >= 7 AND currentVelocity <= 50"
    );

    const moderateChannels = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE currentVelocity >= 1.5 AND currentVelocity < 7"
    );

    const quietChannels = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE currentVelocity < 1.5"
    );

    const channelsWithNameChanges = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE json_array_length(nameChanges) > 1"
    );

    const channelsWithTopicChanges = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE json_array_length(topicChanges) > 1"
    );

    const channelsWithCategoryChanges = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_channels WHERE json_array_length(categoryChanges) > 1"
    );

    const totalMessages = await this.db.get<{ total: number }>(
      "SELECT SUM(totalMessages) as total FROM discord_channels"
    );

    const mostActive = await this.db.get<{ name: string; currentVelocity: number }>(
      "SELECT name, currentVelocity FROM discord_channels ORDER BY currentVelocity DESC LIMIT 1"
    );

    return {
      totalChannels: totalChannels?.count || 0,
      totalGuilds: totalGuilds?.count || 0,
      trackedChannels: trackedChannels?.count || 0,
      mutedChannels: mutedChannels?.count || 0,
      hotChannels: hotChannels?.count || 0,
      activeChannels: activeChannels?.count || 0,
      moderateChannels: moderateChannels?.count || 0,
      quietChannels: quietChannels?.count || 0,
      channelsWithNameChanges: channelsWithNameChanges?.count || 0,
      channelsWithTopicChanges: channelsWithTopicChanges?.count || 0,
      channelsWithCategoryChanges: channelsWithCategoryChanges?.count || 0,
      totalMessages: totalMessages?.total || 0,
      mostActiveChannel: mostActive ? { name: mostActive.name, velocity: mostActive.currentVelocity } : null
    };
  }

  /**
   * Get all channels
   */
  async getAllChannels(): Promise<DiscordChannel[]> {
    const rows = await this.db.all<DiscordChannelRow[]>(
      "SELECT * FROM discord_channels ORDER BY guildName, categoryName, position, name"
    );

    return rows.map(row => this.parseChannelRow(row));
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private parseChannelRow(row: DiscordChannelRow): DiscordChannel {
    return {
      id: row.id,
      guildId: row.guildId,
      guildName: row.guildName,
      name: row.name,
      topic: row.topic,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      type: row.type,
      position: row.position,
      nsfw: row.nsfw === 1,
      rateLimitPerUser: row.rateLimitPerUser,
      createdAt: row.createdAt,
      isTracked: row.isTracked === 1,
      isMuted: row.isMuted === 1,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      currentVelocity: row.currentVelocity,
      lastActivityAt: row.lastActivityAt,
      totalMessages: row.totalMessages,
      nameChanges: JSON.parse(row.nameChanges),
      topicChanges: JSON.parse(row.topicChanges),
      categoryChanges: JSON.parse(row.categoryChanges),
      activityHistory: JSON.parse(row.activityHistory),
      aiSummary: row.aiSummary,
      aiMannerisms: row.aiMannerisms,
      aiLastAnalyzed: row.aiLastAnalyzed,
      notes: row.notes,
      createdAt_registry: row.createdAt_registry,
      updatedAt: row.updatedAt
    };
  }
}
