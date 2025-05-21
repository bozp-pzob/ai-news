import { AiProvider, ContentItem, ParserConfig } from "../../types";
import { ContentParser } from "./ContentParser";
import { cleanHTML } from "../../helpers/promptHelper";
import * as puppeteer from "puppeteer"; // puppeteer import should be fine as is
import { Page } from "puppeteer"; // Explicitly import Page type for clarity

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

  public async parseDetails(url: string, page: Page, title: string): Promise<ContentItem | undefined> {
    // Removed headers parameter, page object is expected to be pre-configured
    console.log(`[RealtorParser] parseDetails called for URL: ${url}. Page object is ${page ? 'valid' : 'invalid'}`);
    if (page) {
      console.log(`[RealtorParser] Initial page URL before navigation: ${page.url()}`);
    }
    try {
      // Browser launch and page creation are removed, as 'page' is now passed in.
      // await page.setExtraHTTPHeaders(headers); // Removed: page should have session state. Static headers might conflict.

      // Ensure navigation occurs on the passed-in page object
      // Check if we are already on the target URL, or if navigation is needed.
      // For simplicity, let's assume we always need to navigate to the item's specific URL.
      console.log(`[RealtorParser] Navigating to URL: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); // Increased timeout
      
      // It's possible the selector might not always be present, especially if the page structure changes.
      // Adding a try-catch for waitForSelector or making it more flexible might be needed in the future.
      try {
        await page.waitForSelector("[data-testid='ldp-page-container']", { timeout: 10000 });
      } catch (selectorError : any) {
        console.warn(`[RealtorParser] Selector "[data-testid='ldp-page-container']" not found for URL: ${url}. Attempting to proceed. Error: ${selectorError.message}`);
        // Optionally, take a screenshot here for debugging if the page content is not as expected.
        // await page.screenshot({ path: `realtor_parser_selector_error_${Date.now()}.png` });
      }
      
      const html = await page.evaluate(() => document.body.innerHTML);
      const cleanHtml = cleanHTML(html);
      const prompt = this.formatStructuredPrompt(cleanHtml);
      const summary = await this.provider?.summarize(prompt);

      if (summary) {
        const item = JSON.parse(summary.replace(/```json\n|```/g, "")) as PropertyDetails;
      
        let content : ContentItem = {
          cid: item.mlsId && item.mlsSource ? `${item.mlsId}-${item.mlsSource}` : `${url}-${Date.now()}`, // Fallback CID
          type: "realtor",
          source: this.name,
          text: item.description || "",
          title: title,
          link: url,
          date: item.listingDate ? new Date(item.listingDate).getTime() / 1000 : Math.floor(Date.now() / 1000),
          metadata: {
            ...item,
            modified: new Date().getTime()/1000,
            // listingHistory: [item.price], // item.price is a single value, not an array. Price history is separate.
            status: 'active', // This might need to be dynamically determined
          },
        };

        // Do not close the browser here; its lifecycle is managed by RSSSource
        return content;
      }
      // Do not close the browser here
    } catch (error) {
      console.error(`[RealtorParser] Error parsing content for URL ${url}:`, error);
      // To prevent cascading failures, return undefined as per subtask requirements.
      return undefined;
    }
    // Ensure a value is returned if summary is not processed (e.g. provider issue, or empty summary)
    // This path is reached if 'summary' is falsy.
    console.warn(`[RealtorParser] No summary could be generated for URL: ${url}. Returning undefined.`);
    return undefined; 
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
