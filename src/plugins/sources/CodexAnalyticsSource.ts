import { ContentItem } from "../../types";
import { ContentSource } from "./ContentSource";
import fetch from "node-fetch";

interface Config {
  name: string;
  apiKey: string;
  tokenAddresses: string[];
}

export class CodexAnalyticsSource implements ContentSource {
  public name: string;
  private apiKey: string;
  private tokenAddresses: string[];

  static constructorInterface = {
    parameters: [
      {
        name: 'apiKey',
        type: 'string',
        required: true,
        description: 'API key for Codex Analytics'
      },
      {
        name: 'tokenAddresses',
        type: 'string[]',
        required: true,
        description: 'Array of token addresses to track'
      }
    ]
  };

  constructor(config: Config) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.tokenAddresses = config.tokenAddresses;
  }

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

  async getTokenPrices(addresses:any[]): Promise<any[]> {
    
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

  async getTokenDetails(addresses:string[]): Promise<any[]> {
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

  async makeGraphQLQuery(query:string): Promise<any> {
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

        return responseData;
    } catch (error) {
        console.error( error);
        return;
    }
  }
}
