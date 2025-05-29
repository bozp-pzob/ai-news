import { AiProvider, ContentItem, ParserConfig } from "../../types";
import { ContentParser } from "./ContentParser";
import { cleanHTML } from "../../helpers/promptHelper";
import { getPageHTML } from "../../helpers/patchrightHelper";

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

export class HTMLParser implements ContentParser {
  public name: string = "HTMLParser";
  private provider: AiProvider | undefined;

  constructor(config: ParserConfig) {
    this.provider = config.provider;
  }

  public async parseDetails(url: string, title: string, type: string, objectString: string = '{}', excludeTopics: string = '[]'): Promise<ContentItem | undefined> {
    try {
      const html = await getPageHTML(url);
      const cleanHtml = cleanHTML(html);
      const prompt = this.formatStructuredPrompt(cleanHtml, objectString, excludeTopics);
      const summary = await this.provider?.summarize(prompt)
      if (summary) {
        const item = JSON.parse(summary.replace(/```json\n|```/g, "")) as PropertyDetails;
      
        let content : ContentItem = {
          cid: `${item.mlsId}-${item.mlsSource}`,
          type: type,
          source: this.name,
          text: item.description,
          title: title,
          link: url,
          date: item.listingDate ? new Date(item.listingDate).getTime() / 1000 : Math.floor(Date.now() / 1000),
          metadata: {
            ...item,
            modified: new Date().getTime()/1000
          },
        }
        return content;
      }
    } catch (error) {
      throw error;
    }
    return;
  }

  
  private formatStructuredPrompt(transcript: string, objectTypeString: string, excludeTopics: string): string {
    return `Analyze this HTML Page and provide a succinct analysis on the available data points:

Typescript Type:
${objectTypeString}

HTML Transcript:
${transcript}

##
IF there is important data points, that don't fit the structured typescript interface, add
a field under misc and store it in there. Exclude these topics: ${excludeTopics}

Return the analysis in as valid JSON format provided.`;
  }
}
