import { ContentItem } from '../types';

/**
 * Enriches AI response content entries with full source details from original ContentItems.
 *
 * @param aiResponseContent - The content array from the parsed AI response. Each entry should have `contributing_item_cids`.
 * @param originalItems - The array of original ContentItems to look up CIDs from.
 * @param isTwitterActivity - Flag if special handling like 'theme_title' is needed.
 * @returns An array of enriched content entries, where each entry has a `sources` array and potentially `theme_title`.
 */
export function enrichAiSummaryContent(
  aiResponseContent: any[],
  originalItems: ContentItem[],
  isTwitterActivity: boolean = false // Default to false
): any[] {
  if (!aiResponseContent || !Array.isArray(aiResponseContent)) {
    console.warn('[summaryHelper.enrichAiSummaryContent] aiResponseContent is not a valid array.');
    return [];
  }

  return aiResponseContent.map((aiContentEntry: any) => {
    const enrichedSources: { link?: string; metadata: any; cid?: string }[] = [];
    if (aiContentEntry.contributing_item_cids && Array.isArray(aiContentEntry.contributing_item_cids)) {
      aiContentEntry.contributing_item_cids.forEach((cid: string) => {
        const originalItem = originalItems.find((item: ContentItem) => item.cid === cid);
        if (originalItem) {
          enrichedSources.push({
            link: originalItem.link,
            metadata: originalItem.metadata,
            cid: originalItem.cid
          });
        } else {
          console.warn(`[summaryHelper.enrichAiSummaryContent] Original item with CID ${cid} not found for enrichment.`);
        }
      });
    }

    const finalContentEntry: any = {
      text: aiContentEntry.text || "",
      sources: enrichedSources
    };

    // Add theme_title specifically for Twitter structure if present in AI response
    if (isTwitterActivity && aiContentEntry.theme_title) {
      finalContentEntry.theme_title = aiContentEntry.theme_title;
    }
    
    // Clean up the CIDs array from the AI content entry if it exists, as it's now in sources
    // delete aiContentEntry.contributing_item_cids; // Not strictly necessary if we build finalContentEntry selectively

    return finalContentEntry;
  });
} 