import { ContentItem } from "../../types";
import { ContentSource } from "./ContentSource"; // Assuming the ContentSource is in the same folder
import fetch from "node-fetch";

interface SolanaTokenAnalyticsSourceConfig {
  name: string;
  apiKey: string;
  tokenAddresses: string[];
}

export class SolanaAnalyticsSource implements ContentSource {
  public name: string;
  private apiKey: string;
  private tokenAddresses: string[];

  static constructorInterface = {
    parameters: [
      {
        name: 'name',
        type: 'string',
        required: true,
        description: 'Name of the Solana Analytics source'
      },
      {
        name: 'apiKey',
        type: 'string',
        required: true,
        description: 'API key for Solana Analytics'
      },
      {
        name: 'tokenAddresses',
        type: 'string[]',
        required: true,
        description: 'Array of Solana token addresses to track'
      }
    ]
  };

  constructor(config : SolanaTokenAnalyticsSourceConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.tokenAddresses = config.tokenAddresses;
  }

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
