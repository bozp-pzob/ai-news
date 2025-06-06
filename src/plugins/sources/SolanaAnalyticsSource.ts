/**
 * @fileoverview Implementation of a content source for fetching Solana token analytics
 * Handles market data retrieval from DexScreener API for Solana tokens
 */

import { ContentItem } from "../../types";
import { ContentSource } from "./ContentSource"; // Assuming the ContentSource is in the same folder
import fetch from "node-fetch";

/**
 * Configuration interface for SolanaAnalyticsSource
 * @interface SolanaTokenAnalyticsSourceConfig
 * @property {string} name - The name identifier for this analytics source
 * @property {string} apiKey - The API key for DexScreener API authentication
 * @property {string[]} tokenAddresses - Array of Solana token addresses to track
 */
interface SolanaTokenAnalyticsSourceConfig {
  name: string;
  apiKey: string;
  tokenAddresses: string[];
}

/**
 * SolanaAnalyticsSource class that implements ContentSource interface for Solana token analytics
 * Fetches and processes market data from DexScreener API for Solana tokens
 * @implements {ContentSource}
 */
export class SolanaAnalyticsSource implements ContentSource {
  /** Name identifier for this analytics source */
  public name: string;
  /** API key for DexScreener authentication */
  private apiKey: string;
  /** List of Solana token addresses to track */
  private tokenAddresses: string[];

  /**
   * Creates a new SolanaAnalyticsSource instance
   * @param {SolanaTokenAnalyticsSourceConfig} config - Configuration object for the analytics source
   */
  constructor(config : SolanaTokenAnalyticsSourceConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.tokenAddresses = config.tokenAddresses;
  }

  /**
   * Fetches current market data for configured Solana tokens
   * Includes price, volume, market cap, and transaction counts
   * @returns {Promise<ContentItem[]>} Array of content items containing token market data
   */
  async fetchItems(): Promise<ContentItem[]> {
    let solanaResponse : any[] = [];

    for (const tokenAddress of this.tokenAddresses) {
      const apiUrl = `https://api.dexscreener.com/token-pairs/v1/solana/${tokenAddress}`;

      try {
        const response = await fetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch data: ${response.statusText}`);
        }

        const data : any = await response.json();

        if (!data) {
          throw new Error("Invalid Solana data format received.");
        }

        const solanaPair = data.find((pair : any) => pair.quoteToken.address === "So11111111111111111111111111111111111111112")

        const analytics = solanaPair;
        const summaryItem: ContentItem = {
          type: "solanaTokenAnalytics",
          title: `Daily Analytics for ${analytics.baseToken.symbol}/${analytics.quoteToken.symbol}`,
          cid: `analytics-${tokenAddress}-${new Date().getDate()}`,
          source: this.name,
          text: `Symbol: ${analytics.baseToken.symbol} Current Price: $${analytics.priceUsd}\nVolume (24h): $${analytics.volume.h24}\nMarket Cap: $${analytics.marketCap}\nDaily Change: ${analytics.priceChange.h24}`,
          date: Math.floor(new Date().getTime() / 1000),
          link: `https://dexscreener.com/solana/${tokenAddress}`,
          metadata: {
            price: analytics.priceUsd,
            volume_24h: analytics.volume.h24,
            market_cap: analytics.marketCap,
            price_change_percentage_24h: analytics.priceChange.h24,
            buy_txns_24h: analytics.txns.h24.buys,
            sell_txns_24h: analytics.txns.h24.sells,
          },
        };

        solanaResponse.push(summaryItem);
      } catch (error) {
        console.error("Error fetching analytics data:", error);
      }
    }

    return solanaResponse;
  }
}
