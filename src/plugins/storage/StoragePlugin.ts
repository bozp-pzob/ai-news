// src/plugins/storage/StoragePlugin.ts

import { ContentItem, SummaryItem } from "../../types";

export interface StoragePlugin {
  init(): Promise<void>;
  close(): Promise<void>;
  saveContentItems(items: ContentItem[]): Promise<ContentItem[]>;
  getContentItem(cid: string): Promise<ContentItem | null>;
  getContentItemByLink(link: string): Promise<ContentItem | null>;
  saveSummaryItem(item: SummaryItem): Promise<void>;
  getSummaryBetweenEpoch(startEpoch: number,endEpoch: number,excludeType?: string): Promise<SummaryItem[]>;
}