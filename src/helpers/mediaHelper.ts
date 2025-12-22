/**
 * Shared media processing utilities for Discord content.
 * Provides common functions for processing attachments, embeds, and stickers
 * to eliminate code duplication between different modules.
 * 
 * @module helpers/mediaHelper
 */

import { DiscordAttachment, DiscordEmbed, DiscordSticker, MediaDownloadItem } from "../types";
import { extractFilenameFromUrl } from "./fileHelper";

/**
 * Process a Discord attachment into standardized format
 * @param attachment - Raw attachment data from Discord.js or parsed JSON
 * @returns Standardized DiscordAttachment object
 */
export const processDiscordAttachment = (attachment: any): DiscordAttachment => {
  return {
    id: attachment.id,
    filename: attachment.name || attachment.filename || 'unknown',
    title: attachment.title || undefined,
    description: attachment.description || undefined,
    content_type: attachment.contentType || attachment.content_type || undefined,
    size: attachment.size,
    url: attachment.url,
    proxy_url: attachment.proxyURL || attachment.proxy_url,
    height: attachment.height || undefined,
    width: attachment.width || undefined,
    duration_secs: attachment.duration || attachment.duration_secs || undefined,
    waveform: attachment.waveform || undefined,
    ephemeral: attachment.ephemeral || undefined,
    flags: attachment.flags?.bitfield || attachment.flags || undefined
  };
};

/**
 * Process a Discord embed into standardized format
 * @param embed - Raw embed data from Discord.js or parsed JSON
 * @returns Standardized DiscordEmbed object
 */
export const processDiscordEmbed = (embed: any): DiscordEmbed => {
  return {
    title: embed.title || undefined,
    description: embed.description || undefined,
    url: embed.url || undefined,
    color: embed.color || undefined,
    image: embed.image ? {
      url: embed.image.url,
      proxy_url: embed.image.proxyURL || embed.image.proxy_url || undefined,
      height: embed.image.height || undefined,
      width: embed.image.width || undefined
    } : undefined,
    thumbnail: embed.thumbnail ? {
      url: embed.thumbnail.url,
      proxy_url: embed.thumbnail.proxyURL || embed.thumbnail.proxy_url || undefined,
      height: embed.thumbnail.height || undefined,
      width: embed.thumbnail.width || undefined
    } : undefined,
    video: embed.video ? {
      url: embed.video.url || undefined,
      proxy_url: embed.video.proxyURL || embed.video.proxy_url || undefined,
      height: embed.video.height || undefined,
      width: embed.video.width || undefined
    } : undefined
  };
};

/**
 * Process a Discord sticker into standardized format
 * @param sticker - Raw sticker data from Discord.js or parsed JSON
 * @returns Standardized DiscordSticker object
 */
export const processDiscordSticker = (sticker: any): DiscordSticker => {
  return {
    id: sticker.id,
    name: sticker.name,
    format_type: sticker.format || sticker.format_type,
    description: sticker.description || undefined
  };
};

/**
 * Extract media download items from a Discord attachment
 * @param attachment - Discord attachment object
 * @param messageId - ID of the message containing the attachment
 * @param messageDate - Timestamp of the message
 * @param channelName - Name of the channel
 * @param guildName - Name of the guild/server
 * @returns MediaDownloadItem if attachment has downloadable media, undefined otherwise
 */
export const extractAttachmentMedia = (
  attachment: any,
  messageId: string,
  messageDate: string,
  channelName: string,
  guildName: string
): MediaDownloadItem | undefined => {
  if (!attachment.url) {
    return undefined;
  }

  return {
    url: attachment.url,
    filename: attachment.filename || attachment.name || 'unknown',
    contentType: attachment.content_type || attachment.contentType,
    messageId,
    messageDate,
    channelName,
    guildName,
    mediaType: 'attachment'
  };
};

/**
 * Extract media download items from a Discord embed
 * @param embed - Discord embed object
 * @param messageId - ID of the message containing the embed
 * @param messageDate - Timestamp of the message
 * @param channelName - Name of the channel
 * @param guildName - Name of the guild/server
 * @returns Array of MediaDownloadItem objects for all media in the embed
 */
export const extractEmbedMedia = (
  embed: any,
  messageId: string,
  messageDate: string,
  channelName: string,
  guildName: string
): MediaDownloadItem[] => {
  const mediaItems: MediaDownloadItem[] = [];

  // Extract image
  if (embed.image?.url) {
    mediaItems.push({
      url: embed.image.url,
      filename: extractFilenameFromUrl(embed.image.url),
      messageId,
      messageDate,
      channelName,
      guildName,
      mediaType: 'embed_image'
    });
  }

  // Extract thumbnail
  if (embed.thumbnail?.url) {
    mediaItems.push({
      url: embed.thumbnail.url,
      filename: extractFilenameFromUrl(embed.thumbnail.url),
      messageId,
      messageDate,
      channelName,
      guildName,
      mediaType: 'embed_thumbnail'
    });
  }

  // Extract video
  if (embed.video?.url) {
    mediaItems.push({
      url: embed.video.url,
      filename: extractFilenameFromUrl(embed.video.url),
      messageId,
      messageDate,
      channelName,
      guildName,
      mediaType: 'embed_video'
    });
  }

  return mediaItems;
};

/**
 * Extract media download items from a Discord sticker
 * @param sticker - Discord sticker object
 * @param messageId - ID of the message containing the sticker
 * @param messageDate - Timestamp of the message
 * @param channelName - Name of the channel
 * @param guildName - Name of the guild/server
 * @returns MediaDownloadItem if sticker has downloadable media, undefined otherwise
 */
export const extractStickerMedia = (
  sticker: any,
  messageId: string,
  messageDate: string,
  channelName: string,
  guildName: string
): MediaDownloadItem | undefined => {
  if (!sticker.url) {
    return undefined;
  }

  return {
    url: sticker.url,
    filename: `${sticker.name}.${sticker.format_type === 1 ? 'png' : 'gif'}`,
    messageId,
    messageDate,
    channelName,
    guildName,
    mediaType: 'sticker'
  };
};