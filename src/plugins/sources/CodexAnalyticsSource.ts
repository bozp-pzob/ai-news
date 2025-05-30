/**
 * @fileoverview Implementation of a content source for fetching token analytics data from Codex API
 * Handles token price, volume, and market data retrieval through GraphQL queries
 */

import { ContentItem } from "../../types";
import { ContentSource } from "./ContentSource";
import fetch from "node-fetch";
import { delay } from "../../helpers/generalHelper";

/**
 * Configuration interface for CodexAnalyticsSource
 * @interface CodexAnalyticsSourceConfig
 * @property {string} name - The name identifier for this analytics source
 * @property {string} apiKey - The API key for Codex API authentication
 * @property {string[]} tokenAddresses - Array of token contract addresses to track
 */
interface CodexAnalyticsSourceConfig {
  name: string;
  apiKey: string;
  tokenAddresses: string[];
}

/**
 * CodexAnalyticsSource class that implements ContentSource interface for token analytics
 * Fetches and processes token market data from Codex API using GraphQL
 * @implements {ContentSource}
 */
export class CodexAnalyticsSource implements ContentSource {
  /** Name identifier for this analytics source */
  public name: string;
  /** API key for authentication */
  private apiKey: string;
  /** List of token addresses to track */
  private tokenAddresses: string[];

  private static lastRequestTime: number = 0;
  private static readonly MIN_INTERVAL: number = 1000 / 4; // 4 requests per second

  /**
   * Creates a new CodexAnalyticsSource instance
   * @param {CodexAnalyticsSourceConfig} config - Configuration object for the analytics source
   */
  constructor(config: CodexAnalyticsSourceConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.tokenAddresses = config.tokenAddresses;
  }

  /**
   * Fetches current token analytics data for configured tokens
   * @returns {Promise<ContentItem[]>} Array of content items containing token analytics
   */
  async fetchItems(): Promise<ContentItem[]> {
    const codexResponse: ContentItem[] = [];

    try {
        let analytics = await this.getTokenDetails(this.tokenAddresses);

        if ( analytics && analytics.length > 0 ) {
            for (const analytic of analytics) {
                if ( analytic.token.cmcId ) {
                    const summaryItem: ContentItem = {
                    type: "codexTokenAnalytics",
                    title: `Daily Analytics for ${analytic.token.symbol}`,
                    cid: `analytics-${analytic.token.address}-${new Date().getDate()}`,
                    source: this.name,
                    text: `Symbol: ${analytic.token.symbol}\n Current Price: $${analytic.priceUSD}\nVolume (24h): $${analytic.volume24}\nMarket Cap: $${analytic.marketCap}\nDaily Change: ${analytic.change24}`,
                    date: Math.floor(Date.now() / 1000),
                    link: '',
                    metadata: {
                        price: analytic.priceUSD,
                        volume_24h: analytic.volume24,
                        market_cap: analytic.marketCap,
                        price_change_percentage_24h: analytic.change24,
                        buy_txns_24h: analytic.buyCount24,
                        sell_txns_24h: analytic.sellCount24,
                    },
                    };

                    codexResponse.push(summaryItem);
                }
            }
        }
    } catch (error) {
        console.error("Error fetching analytics data:", error);
    }
    
    return codexResponse;
  }

  /**
   * Fetches historical token analytics data for a specific date
   * @param {string} date - ISO date string to fetch historical data for
   * @returns {Promise<ContentItem[]>} Array of content items containing historical token analytics
   */
  async fetchHistorical(date:string): Promise<ContentItem[]> {
    const targetDate = new Date(date).getTime() / 1000;
    const codexResponse: ContentItem[] = [];

    try {
        let analytics = await this.getTokenDetails(this.tokenAddresses);
        let prices = await this.getTokenPrices(analytics.map((analytic) => {if (analytic.token.cmcId ) return {"address": analytic.token.address, "networkId": analytic.token.networkId, "timestamp": targetDate}}).filter((analytic:any) => { return !!analytic }))
        
        if ( analytics && analytics.length > 0 ) {
            for (const analytic of analytics) {
                if ( analytic.token.cmcId ) {
                    let price = prices.find((_price:any) => _price.address === analytic.token.address);

                    if ( price ) {
                        const summaryItem: ContentItem = {
                            type: "codexTokenAnalytics",
                            title: `Daily Analytics for ${analytic.token.symbol}`,
                            cid: `analytics-${analytic.token.address}-${date.substring(8,10)}`,
                            source: this.name,
                            text: `Symbol: ${analytic.token.symbol}\n Current Price: $${price.priceUsd}`,
                            date: targetDate,
                            link: '',
                            metadata: {
                                price: price.priceUsd,
                            },
                        };

                        codexResponse.push(summaryItem);
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error fetching analytics data:", error);
    }
    
    return codexResponse;
  }

  /**
   * Fetches token prices for specified addresses and timestamps
   * @param {Array<{address: string, networkId: string, timestamp: number}>} addresses - Array of token addresses with network IDs and timestamps
   * @returns {Promise<Array<{address: string, networkId: string, priceUsd: number}>>} Array of token prices
   * @private
   */
  private async getTokenPrices(addresses:any[]): Promise<any[]> {
    const query = `
    {
        getTokenPrices(
            inputs: ${JSON.stringify(addresses).replace(/"([^(")"]+)":/g,"$1:")}
        ) {
            address
            networkId
            priceUsd
        }
    }
    `;

    try {
        const responseData : any = await this.makeGraphQLQuery(query);
        let prices = responseData?.data?.getTokenPrices || [];
        return prices
    } catch (error) {
        return [];
    }
  }

  /**
   * Fetches detailed token information for specified addresses
   * @param {string[]} addresses - Array of token contract addresses
   * @returns {Promise<Array<any>>} Array of token details including price, volume, and market data
   * @private
   */
  private async getTokenDetails(addresses:string[]): Promise<any[]> {
    const query = `
    {
        filterTokens(tokens: ${JSON.stringify(this.tokenAddresses)}) {
            results {
                change24
                high24
                low24
                volume24
                volumeChange24
                liquidity
                marketCap
                priceUSD
                sellCount24
                buyCount24
                token {
                    cmcId
                    address
                    decimals
                    name
                    networkId
                    symbol
                }
            }
        }
    }
    `;

    try {
        const responseData : any = await this.makeGraphQLQuery(query);
        let analytics = responseData?.data?.filterTokens?.results || [];
        return analytics;
    } catch (error) {
        return [];
    }
  }

  /**
   * Makes a GraphQL query to the Codex API
   * @param {string} query - GraphQL query string
   * @returns {Promise<any>} Query response data
   * @private
   */
  private async makeGraphQLQuery(query:string): Promise<any> {
    try {
        const now = Date.now();
        const timeSinceLastRequest = now - CodexAnalyticsSource.lastRequestTime;

        if (timeSinceLastRequest < CodexAnalyticsSource.MIN_INTERVAL) {
            const timeToWait = CodexAnalyticsSource.MIN_INTERVAL - timeSinceLastRequest;
            await delay(timeToWait);
        }

        CodexAnalyticsSource.lastRequestTime = Date.now();

        const response = await fetch("https://graph.codex.io/graphql", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `${this.apiKey}`,
            },
            body: JSON.stringify({ "query": query }),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch data: ${response.statusText}`);
        }

        const responseData : any = await response.json();

        if (responseData.errors) {
            console.error("GraphQL errors:", responseData.errors);
            throw new Error("GraphQL error occurred.");
        }

        return responseData;
    } catch (error) {
        console.error(error);
        return;
    }
  }
}
