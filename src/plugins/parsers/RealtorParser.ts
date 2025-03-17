import { AiProvider, ContentItem, ParserConfig } from "../../types";
import { ContentParser } from "./ContentParser";
import { cleanHTML } from "../../helpers/promptHelper";
import * as puppeteer from "puppeteer";

interface PropertyDetails {
  listingDate: Date;
  squareFeet: number;
  bedrooms: number;
  bathrooms: number;
  price: number;
  pricePerSqft: number;
  location: {
    address: string;
    city: string;
    state: string;
    zipCode: string;
  };
  priceHistory: Array<{ date: string; price: string; event: string; }>;
  taxHistory: Array<{ year: string; taxAmount: string; assessedValue: string; }>;
  schoolRatings: Array<{ name: string; rating: string; }>;
  gps: any;
  propertyType: string;
  yearBuilt: number;
  lotSize: number;
  description: string;
  images: string[];
  hoaFees: number;
  environmentRisks: string;
  localLogicData: string;
  url?: string;
  mlsId?: string;
  mlsSource: string;
  parcelNumber?: string;
  misc: Object;
}

export class RealtorParser implements ContentParser {
  public name: string = "RealtorParser";
  private provider: AiProvider | undefined;

  constructor(config: ParserConfig) {
    this.provider = config.provider;
  }

  public async parseDetails(url: string, headers: any, title: string): Promise<ContentItem | undefined> {
    try {
      const browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders(headers);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector("[data-testid='ldp-page-container']", { timeout: 10000 });
      const html = await page.evaluate(() => document.body.innerHTML);
      const cleanHtml = cleanHTML(html);
      const prompt = this.formatStructuredPrompt(cleanHtml);
      const summary = await this.provider?.summarize(prompt)
      if (summary) {
        const item = JSON.parse(summary.replace(/```json\n|```/g, "")) as PropertyDetails;
      
        let content : ContentItem = {
          cid: `${item.mlsId}-${item.mlsSource}`,
          type: "realtor",
          source: this.name,
          text: item.description,
          title: title,
          link: url,
          date: item.listingDate ? new Date(item.listingDate).getTime() / 1000 : Math.floor(Date.now() / 1000),
          metadata: {
            ...item,
            modified: new Date().getTime()/1000,
            listingHistory: [item.price],
            status: 'active',
          },
        }

        await browser.close();
        return content;
      }
      await browser.close();
    } catch (error) {
      console.error("Error parsing Realtor.com property:", error);
      throw error;
    }
    return;
  }

  
  private formatStructuredPrompt(transcript: string): string {
    return `Analyze this HTML Page and provide a succinct analysis on the available data points:

Typescript Type:
{
  listingDate: Date;
  squareFeet: number;
  bedrooms: number;
  bathrooms: number;
  price: number;
  pricePerSqft: number;
  location: {
    address: string;
    city: string;
    state: string;
    zipCode: string;
  };
  priceHistory: Array<{ date: string; price: string; event: string; }>;
  taxHistory: Array<{ year: string; taxAmount: string; assessedValue: string; }>;
  schoolRatings: Array<{ name: string; rating: string; }>;
  gps: Object<{ latitude: number, longitude: number }>;
  propertyType: string;
  yearBuilt: number;
  lotSize: number;
  description: string;
  images: string[];
  hoaFees: number;
  environmentRisks: string;
  localLogicData: string;
  url?: string;
  mlsId?: string;
  mlsSource: string;
  parcelNumber?: string;
  misc: Object;
}

HTML Transcript:
${transcript}

##
IF there is important data points, that don't fit the structured typescript interface, add
a field under misc and store it in there. Exclude these topics: [mortgageBreakdown, mortgageDetails, mortgageEstimate]

Return the analysis in as valid JSON format provided.`;
  }
}
