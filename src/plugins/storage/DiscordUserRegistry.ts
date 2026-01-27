/**
 * Discord User Registry
 *
 * Manages a normalized registry of Discord users with:
 * - Username/nickname tracking over time
 * - Role progression history
 * - Message activity statistics
 * - Human annotations and metadata
 *
 * This eliminates redundant nicknameMap data in JSON files and provides
 * a single source of truth for Discord user information.
 */

import { Database } from "sqlite";
import sqlite3 from "sqlite3";

// ============================================================================
// Types
// ============================================================================

export interface DiscordUser {
  id: string;                    // Discord user ID
  username: string;              // Current Discord username
  displayName: string | null;    // Current display name (nickname)
  roles: string[];               // Current roles (parsed from JSON)
  nicknameChanges: NicknameChange[];  // History of nickname changes
  roleChanges: RoleChange[];     // History of role changes
  avatarUrl: string | null;
  firstSeen: number;             // Unix timestamp
  lastSeen: number;              // Unix timestamp
  totalMessages: number;
  notes: string | null;          // Human annotations
  metadata: Record<string, any> | null;  // Structured metadata
  createdAt: number;             // Unix timestamp
  updatedAt: number;             // Unix timestamp
}

export interface NicknameChange {
  nickname: string;
  observedAt: string;  // ISO date: YYYY-MM-DD
}

export interface RoleChange {
  roles: string[];
  observedAt: string;  // ISO date: YYYY-MM-DD
}

interface DiscordUserRow {
  id: string;
  username: string;
  displayName: string | null;
  roles: string;                 // JSON string
  nicknameChanges: string;       // JSON string
  roleChanges: string;           // JSON string
  avatarUrl: string | null;
  firstSeen: number;
  lastSeen: number;
  totalMessages: number;
  notes: string | null;
  metadata: string | null;       // JSON string
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Discord User Registry
// ============================================================================

export class DiscordUserRegistry {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Initialize the discord_users table
   */
  async initialize(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS discord_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        displayName TEXT,
        roles TEXT NOT NULL,
        nicknameChanges TEXT NOT NULL,
        roleChanges TEXT NOT NULL,
        avatarUrl TEXT,
        firstSeen INTEGER NOT NULL,
        lastSeen INTEGER NOT NULL,
        totalMessages INTEGER DEFAULT 0,
        notes TEXT,
        metadata TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_discord_users_username ON discord_users(username);
      CREATE INDEX IF NOT EXISTS idx_discord_users_displayName ON discord_users(displayName);
      CREATE INDEX IF NOT EXISTS idx_discord_users_lastSeen ON discord_users(lastSeen);
    `);
  }

  /**
   * Upsert a user, tracking nickname and role changes
   */
  async upsertUser(params: {
    id: string;
    username: string;
    displayName: string | null;
    roles: string[];
    observedAt: string;  // ISO date: YYYY-MM-DD
    messageCount?: number;
    avatarUrl?: string | null;
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const observedTimestamp = Math.floor(new Date(params.observedAt).getTime() / 1000);

    // Check if user exists
    const existing = await this.getUserById(params.id);

    if (!existing) {
      // New user - create initial record
      await this.db.run(
        `INSERT INTO discord_users (
          id, username, displayName, roles, nicknameChanges, roleChanges,
          avatarUrl, firstSeen, lastSeen, totalMessages, notes, metadata, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        [
          params.id,
          params.username,
          params.displayName,
          JSON.stringify(params.roles),
          JSON.stringify([{ nickname: params.displayName || params.username, observedAt: params.observedAt }]),
          JSON.stringify([{ roles: params.roles, observedAt: params.observedAt }]),
          params.avatarUrl || null,
          observedTimestamp,
          observedTimestamp,
          params.messageCount || 0,
          now,
          now
        ]
      );
    } else {
      // Existing user - check for changes
      const updates: string[] = [];
      const values: any[] = [];

      // Update username if changed
      if (params.username !== existing.username) {
        updates.push("username = ?");
        values.push(params.username);
      }

      // Track nickname change if different
      let nicknameChanges = existing.nicknameChanges;
      const currentNickname = params.displayName || params.username;
      const lastNickname = nicknameChanges[0]?.nickname;

      if (currentNickname !== lastNickname) {
        nicknameChanges = [
          { nickname: currentNickname, observedAt: params.observedAt },
          ...nicknameChanges
        ];
        updates.push("nicknameChanges = ?");
        values.push(JSON.stringify(nicknameChanges));
      }

      // Track role change if different
      let roleChanges = existing.roleChanges;
      const rolesEqual =
        params.roles.length === existing.roles.length &&
        params.roles.every(r => existing.roles.includes(r));

      if (!rolesEqual) {
        roleChanges = [
          { roles: params.roles, observedAt: params.observedAt },
          ...roleChanges
        ];
        updates.push("roleChanges = ?");
        values.push(JSON.stringify(roleChanges));
      }

      // Update current state
      updates.push("displayName = ?");
      values.push(params.displayName);

      updates.push("roles = ?");
      values.push(JSON.stringify(params.roles));

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

      // Increment message count
      if (params.messageCount) {
        updates.push("totalMessages = totalMessages + ?");
        values.push(params.messageCount);
      }

      // Update avatarUrl if provided
      if (params.avatarUrl !== undefined) {
        updates.push("avatarUrl = ?");
        values.push(params.avatarUrl);
      }

      updates.push("updatedAt = ?");
      values.push(now);

      if (updates.length > 0) {
        values.push(params.id);
        await this.db.run(
          `UPDATE discord_users SET ${updates.join(", ")} WHERE id = ?`,
          values
        );
      }
    }
  }

  /**
   * Get user by Discord ID
   */
  async getUserById(id: string): Promise<DiscordUser | null> {
    const row = await this.db.get<DiscordUserRow>(
      "SELECT * FROM discord_users WHERE id = ?",
      id
    );

    return row ? this.parseUserRow(row) : null;
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<DiscordUser | null> {
    const row = await this.db.get<DiscordUserRow>(
      "SELECT * FROM discord_users WHERE username = ?",
      username
    );

    return row ? this.parseUserRow(row) : null;
  }

  /**
   * Get user by nickname (current or historical)
   */
  async getUserByNickname(nickname: string, observedAt?: string): Promise<DiscordUser | null> {
    // If no date specified, match current displayName
    if (!observedAt) {
      const row = await this.db.get<DiscordUserRow>(
        "SELECT * FROM discord_users WHERE displayName = ?",
        nickname
      );
      return row ? this.parseUserRow(row) : null;
    }

    // Search through all users' nickname history
    const rows = await this.db.all<DiscordUserRow[]>(
      "SELECT * FROM discord_users"
    );

    for (const row of rows) {
      const user = this.parseUserRow(row);
      const nicknameOnDate = this.getNicknameOnDate(user, observedAt);
      if (nicknameOnDate === nickname) {
        return user;
      }
    }

    return null;
  }

  /**
   * Get all users
   */
  async getAllUsers(): Promise<DiscordUser[]> {
    const rows = await this.db.all<DiscordUserRow[]>(
      "SELECT * FROM discord_users ORDER BY lastSeen DESC"
    );

    return rows.map(row => this.parseUserRow(row));
  }

  /**
   * Get nickname for a user on a specific date
   */
  getNicknameOnDate(user: DiscordUser, date: string): string {
    // Find most recent nickname change before or on date
    const change = user.nicknameChanges.find(c => c.observedAt <= date);
    return change?.nickname || user.displayName || user.username;
  }

  /**
   * Get roles for a user on a specific date
   */
  getRolesOnDate(user: DiscordUser, date: string): string[] {
    // Find most recent role change before or on date
    const change = user.roleChanges.find(c => c.observedAt <= date);
    return change?.roles || user.roles;
  }

  /**
   * Build nickname map for a specific date (for backward compatibility with JSON files)
   */
  async buildNicknameMapForDate(date: string): Promise<Record<string, { id: string; username: string; roles: string[] }>> {
    const users = await this.getAllUsers();
    const nicknameMap: Record<string, { id: string; username: string; roles: string[] }> = {};

    for (const user of users) {
      // Only include users active on or before this date
      const userFirstSeen = new Date(user.firstSeen * 1000).toISOString().split('T')[0];
      if (userFirstSeen > date) continue;

      const nickname = this.getNicknameOnDate(user, date);
      const roles = this.getRolesOnDate(user, date);

      // Handle nickname conflicts - prefer user with more messages
      if (nicknameMap[nickname]) {
        const existingUser = await this.getUserById(nicknameMap[nickname].id);
        if (existingUser && user.totalMessages > existingUser.totalMessages) {
          nicknameMap[nickname] = { id: user.id, username: user.username, roles };
        }
      } else {
        nicknameMap[nickname] = { id: user.id, username: user.username, roles };
      }
    }

    return nicknameMap;
  }

  /**
   * Get registry statistics
   */
  async getStats(): Promise<{
    totalUsers: number;
    usersWithNicknameChanges: number;
    usersWithRoleChanges: number;
    totalMessages: number;
    mostActiveUser: { username: string; messages: number } | null;
  }> {
    const totalUsers = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_users"
    );

    const usersWithNicknameChanges = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_users WHERE json_array_length(nicknameChanges) > 1"
    );

    const usersWithRoleChanges = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM discord_users WHERE json_array_length(roleChanges) > 1"
    );

    const totalMessages = await this.db.get<{ total: number }>(
      "SELECT SUM(totalMessages) as total FROM discord_users"
    );

    const mostActive = await this.db.get<{ username: string; totalMessages: number }>(
      "SELECT username, totalMessages FROM discord_users ORDER BY totalMessages DESC LIMIT 1"
    );

    return {
      totalUsers: totalUsers?.count || 0,
      usersWithNicknameChanges: usersWithNicknameChanges?.count || 0,
      usersWithRoleChanges: usersWithRoleChanges?.count || 0,
      totalMessages: totalMessages?.total || 0,
      mostActiveUser: mostActive ? { username: mostActive.username, messages: mostActive.totalMessages } : null
    };
  }

  /**
   * Update user notes (for manual curation)
   */
  async updateNotes(userId: string, notes: string): Promise<void> {
    await this.db.run(
      "UPDATE discord_users SET notes = ?, updatedAt = ? WHERE id = ?",
      [notes, Math.floor(Date.now() / 1000), userId]
    );
  }

  /**
   * Update user metadata
   */
  async updateMetadata(userId: string, metadata: Record<string, any>): Promise<void> {
    await this.db.run(
      "UPDATE discord_users SET metadata = ?, updatedAt = ? WHERE id = ?",
      [JSON.stringify(metadata), Math.floor(Date.now() / 1000), userId]
    );
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private parseUserRow(row: DiscordUserRow): DiscordUser {
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      roles: JSON.parse(row.roles),
      nicknameChanges: JSON.parse(row.nicknameChanges),
      roleChanges: JSON.parse(row.roleChanges),
      avatarUrl: row.avatarUrl,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      totalMessages: row.totalMessages,
      notes: row.notes,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
