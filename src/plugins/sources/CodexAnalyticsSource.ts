import { ContentItem } from "../../types";
import { ContentSource } from "./ContentSource";
import fetch from "node-fetch";

interface CodexAnalyticsSourceConfig {
  name: string;
  apiKey: string;
  tokenAddresses: string[];
}

export class CodexAnalyticsSource implements ContentSource {
  public name: string;
  private apiKey: string;
  private tokenAddresses: string[];

  constructor(config: CodexAnalyticsSourceConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.tokenAddresses = config.tokenAddresses;
  }

  async fetchItems(): Promise<ContentItem[]> {
    const codexResponse: ContentItem[] = [];

    for (const tokenAddress of this.tokenAddresses) {
      const query = `
        {
            filterTokens(phrase: "${tokenAddress}") {
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

        let analytics = responseData?.data?.filterTokens?.results || [];
 
        if ( analytics && analytics.length > 0 ) {
            analytics = analytics[0]
            const summaryItem: ContentItem = {
              type: "solanaTokenAnalytics",
              title: `Daily Analytics for ${analytics.token.symbol}`,
              cid: `analytics-${tokenAddress}-${new Date().getDate()}`,
              source: this.name,
              text: `Symbol: ${analytics.token.symbol} Current Price: $${analytics.priceUSD}\nVolume (24h): $${analytics.volume24}\nMarket Cap: $${analytics.marketCap}\nDaily Change: ${analytics.change24}`,
              date: Math.floor(Date.now() / 1000),
              link: `https://dexscreener.com/solana/${tokenAddress}`,
              metadata: {
                price: analytics.priceUSD,
                volume_24h: analytics.volume24,
                market_cap: analytics.marketCap,
                price_change_percentage_24h: analytics.change24,
                buy_txns_24h: analytics.buyCount24,
                sell_txns_24h: analytics.sellCount24,
              },
            };

            codexResponse.push(summaryItem);
        }
      } catch (error) {
        console.error("Error fetching analytics data:", error);
      }
    }

    return codexResponse;
  }
}
