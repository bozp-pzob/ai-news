import { delay } from "../../helpers/generalHelper";
import { ContentItem } from "../../types";
import { ContentSource } from "./ContentSource"; // Assuming the ContentSource is in the same folder
import fetch from "node-fetch";

interface CoinGeckoAnalyticsSourceConfig {
    name: string;
    tokenSymbols: string[];
}

export class CoinGeckoAnalyticsSource implements ContentSource {
    public name: string;
    private tokenSymbols: string[];
  
    static constructorInterface = {
      parameters: [
        {
          name: 'tokenSymbols',
          type: 'string[]',
          required: true,
          description: 'Array of cryptocurrency symbols to track (e.g., ["bitcoin", "ethereum"])'
        }
      ]
    };
  
    constructor(config : CoinGeckoAnalyticsSourceConfig) {
        this.name = config.name;
        this.tokenSymbols = config.tokenSymbols;
    }
  
    async fetchItems(): Promise<ContentItem[]> {
        let marketResponse : any[] = [];

        for (const symbol of this.tokenSymbols) {
            const apiUrl = `https://api.coingecko.com/api/v3/coins/${symbol}`;
    
            try {
                const response = await fetch(apiUrl);
        
                if (!response.ok) {
                throw new Error(`Failed to fetch market data: ${response.statusText}`);
                }
        
                const data : any = await response.json();
        
                if (!data || !data.market_data) {
                throw new Error("Invalid market data format received from API.");
                }
        
                const marketData = data.market_data;
        
                const summaryItem: ContentItem = {
                    type: "coinGeckoMarketAnalytics",
                    title: `Market Analytics for ${data.name} (${data.symbol.toUpperCase()})`,
                    cid: `analytics-${symbol}-${new Date().getDate()}`,
                    source: this.name,
                    text: `Symbol: ${symbol} Current Price: $${marketData.current_price.usd}\nVolume (24h): $${marketData.total_volume.usd}\nMarket Cap: $${marketData.market_cap.usd}\nDaily Change: ${marketData.price_change_24h}.`,
                    date: Math.floor(new Date().getTime() / 1000),
                    link: `https://www.coingecko.com/en/coins/${symbol}`,
                    metadata: {
                        price: marketData.current_price.usd,
                        volume_24h: marketData.total_volume.usd,
                        market_cap: marketData.market_cap.usd,
                        price_change_24h: marketData.price_change_24h,
                        price_change_percentage_24h: marketData.price_change_percentage_24h,
                        high_24h: marketData.high_24h.usd,
                        low_24h: marketData.low_24h.usd,
                    },
                };
        
                marketResponse.push(summaryItem);

                await delay(2000);
            } catch (error) {
                await delay(2000);
                console.error("Error fetching market data:", error);
            }
        }
        return marketResponse;
    }
  }