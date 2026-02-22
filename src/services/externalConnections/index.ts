/**
 * External Connections - Main module export
 * 
 * Platform-agnostic connection system for Discord, Telegram, Slack, etc.
 */

// Types
export * from './types';

// Adapters
export { BaseAdapter, discordAdapter, telegramAdapter } from './adapters';

// Main service
export { externalConnectionService } from './ExternalConnectionService';
