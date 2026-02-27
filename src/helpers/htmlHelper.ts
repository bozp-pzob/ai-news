/**
 * HTML content extraction and cleaning utilities.
 * 
 * Uses already-installed dependencies:
 * - @mozilla/readability for article content extraction
 * - jsdom for DOM simulation
 * - cheerio for HTML parsing and cleaning
 * 
 * Also provides extractPageContent() -- a high-level function that fetches
 * a URL (or accepts pre-fetched HTML), extracts content via Readability,
 * and optionally enriches it with AI-powered structured extraction.
 * 
 * @module helpers/htmlHelper
 */

import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import crypto from 'crypto';
import type { AiProvider, ContentItem, SiteParser } from '../types';
import type { StoragePlugin } from '../plugins/storage/StoragePlugin';
import { fetchHTML } from './patchrightHelper';
import { createHtmlAnalysisPrompt, SUMMARIZE_OPTIONS } from './promptHelper';
import {
  generateParserFromExample,
  executeParser,
  derivePathPattern,
  extractDomain,
} from './parserGenerator';
import { validateAgainstExample, validateMinimumFields } from './parserValidator';

// ============================================
// READABLE CONTENT EXTRACTION
// ============================================

export interface ReadableContent {
  title: string;
  text: string;
  excerpt: string;
  author: string | null;
  publishedDate: string | null;
  siteName: string | null;
  length: number;
}

/**
 * Extract readable article content from HTML using Mozilla's Readability.
 * Works best on article/blog pages. Falls back to basic extraction for non-article pages.
 * 
 * @param html - Raw HTML string
 * @param url - The page URL (used by Readability for resolving relative links)
 * @returns Extracted readable content
 */
export function extractReadableContent(html: string, url: string): ReadableContent {
  try {
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (article) {
      return {
        title: article.title || '',
        text: article.textContent || '',
        excerpt: article.excerpt || '',
        author: article.byline || null,
        publishedDate: extractPublishedDate(html),
        siteName: article.siteName || null,
        length: article.length || 0,
      };
    }
  } catch (err) {
    console.warn('[HTMLHelper] Readability extraction failed, falling back to basic extraction:', err);
  }

  // Fallback: basic extraction using cheerio
  return extractBasicContent(html, url);
}

/**
 * Basic content extraction fallback when Readability fails.
 */
function extractBasicContent(html: string, url: string): ReadableContent {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, header, footer, aside, .sidebar, .nav, .menu, .ad, .advertisement').remove();

  const title = $('title').text().trim()
    || $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')
    || '';

  const text = $('article').text().trim()
    || $('main').text().trim()
    || $('[role="main"]').text().trim()
    || $('body').text().trim();

  const author = $('meta[name="author"]').attr('content')
    || $('[rel="author"]').first().text().trim()
    || null;

  return {
    title,
    text: text.replace(/\s+/g, ' ').trim(),
    excerpt: text.substring(0, 200).trim(),
    author,
    publishedDate: extractPublishedDate(html),
    siteName: $('meta[property="og:site_name"]').attr('content') || null,
    length: text.length,
  };
}

/**
 * Try to extract a published date from HTML meta tags.
 */
function extractPublishedDate(html: string): string | null {
  const $ = cheerio.load(html);
  return $('meta[property="article:published_time"]').attr('content')
    || $('meta[name="date"]').attr('content')
    || $('meta[name="DC.date"]').attr('content')
    || $('time[datetime]').first().attr('datetime')
    || null;
}

// ============================================
// HTML CLEANING
// ============================================

/**
 * Strip all HTML tags and normalize whitespace.
 * Returns clean plain text.
 * 
 * @param html - Raw HTML string
 * @returns Clean plain text
 */
export function cleanHTML(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, noscript, svg, iframe, object, embed').remove();

  // Get text content
  let text = $.text();

  // Normalize whitespace
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]+/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

// ============================================
// HTML TO MARKDOWN CONVERSION
// ============================================

/**
 * Lightweight HTML-to-markdown conversion using cheerio.
 * Handles common elements: headings, paragraphs, lists, links, bold, italic, code.
 * 
 * @param html - Raw HTML string
 * @returns Markdown text
 */
export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, noscript, svg, iframe, nav, header, footer').remove();

  // Process the body or main content
  const contentEl = $('article').length ? $('article') : ($('main').length ? $('main') : $('body'));

  return processElement($, contentEl).trim();
}

/**
 * Recursively process DOM elements into markdown.
 */
function processElement($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>): string {
  let result = '';

  el.contents().each((_, node) => {
    if (node.type === 'text') {
      const text = $(node).text();
      result += text;
      return;
    }

    if (node.type !== 'tag') return;

    const $el = $(node);
    const tag = node.tagName?.toLowerCase();

    switch (tag) {
      case 'h1':
        result += `\n# ${$el.text().trim()}\n\n`;
        break;
      case 'h2':
        result += `\n## ${$el.text().trim()}\n\n`;
        break;
      case 'h3':
        result += `\n### ${$el.text().trim()}\n\n`;
        break;
      case 'h4':
        result += `\n#### ${$el.text().trim()}\n\n`;
        break;
      case 'h5':
      case 'h6':
        result += `\n##### ${$el.text().trim()}\n\n`;
        break;
      case 'p':
        result += `\n${processElement($, $el).trim()}\n\n`;
        break;
      case 'br':
        result += '\n';
        break;
      case 'a': {
        const href = $el.attr('href');
        const text = $el.text().trim();
        if (href && text) {
          result += `[${text}](${href})`;
        } else if (text) {
          result += text;
        }
        break;
      }
      case 'strong':
      case 'b':
        result += `**${$el.text().trim()}**`;
        break;
      case 'em':
      case 'i':
        result += `*${$el.text().trim()}*`;
        break;
      case 'code':
        result += `\`${$el.text().trim()}\``;
        break;
      case 'pre':
        result += `\n\`\`\`\n${$el.text().trim()}\n\`\`\`\n\n`;
        break;
      case 'blockquote':
        result += '\n' + $el.text().trim().split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
        break;
      case 'ul':
        $el.children('li').each((_, li) => {
          result += `\n- ${$(li).text().trim()}`;
        });
        result += '\n\n';
        break;
      case 'ol':
        $el.children('li').each((i, li) => {
          result += `\n${i + 1}. ${$(li).text().trim()}`;
        });
        result += '\n\n';
        break;
      case 'img': {
        const alt = $el.attr('alt') || '';
        const src = $el.attr('src') || '';
        if (src) {
          result += `![${alt}](${src})`;
        }
        break;
      }
      case 'table':
        result += processTable($, $el);
        break;
      case 'div':
      case 'section':
      case 'article':
      case 'main':
      case 'span':
      case 'figure':
      case 'figcaption':
        result += processElement($, $el);
        break;
      default:
        result += processElement($, $el);
        break;
    }
  });

  return result;
}

/**
 * Convert an HTML table to markdown.
 */
function processTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): string {
  const rows: string[][] = [];

  table.find('tr').each((_, tr) => {
    const cells: string[] = [];
    $(tr).find('th, td').each((_, cell) => {
      cells.push($(cell).text().trim());
    });
    if (cells.length > 0) {
      rows.push(cells);
    }
  });

  if (rows.length === 0) return '';

  const maxCols = Math.max(...rows.map(r => r.length));
  let md = '\n';

  // Header row
  md += '| ' + rows[0].map(c => c || ' ').join(' | ') + ' |\n';
  md += '| ' + Array(maxCols).fill('---').join(' | ') + ' |\n';

  // Data rows
  for (let i = 1; i < rows.length; i++) {
    const padded = [...rows[i], ...Array(maxCols - rows[i].length).fill('')];
    md += '| ' + padded.join(' | ') + ' |\n';
  }

  return md + '\n';
}

// ============================================
// STRUCTURED DATA EXTRACTION
// ============================================

export interface StructuredData {
  /** JSON-LD data found in <script type="application/ld+json"> tags */
  jsonLd: any[];
  /** Open Graph meta tags (og:title, og:description, og:image, etc.) */
  openGraph: Record<string, string>;
  /** Twitter Card meta tags */
  twitterCard: Record<string, string>;
  /** Standard meta tags (description, author, keywords, etc.) */
  metaData: Record<string, string>;
}

/**
 * Extract structured data from HTML page.
 * Extracts JSON-LD, Open Graph, Twitter Card, and standard meta tags.
 * This is machine-readable data that's available for free without AI.
 * 
 * @param html - Raw HTML string
 * @returns Extracted structured data
 */
export function extractStructuredData(html: string): StructuredData {
  const $ = cheerio.load(html);
  const result: StructuredData = {
    jsonLd: [],
    openGraph: {},
    twitterCard: {},
    metaData: {},
  };

  // JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html();
      if (text) {
        const parsed = JSON.parse(text);
        result.jsonLd.push(parsed);
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  });

  // Open Graph meta tags
  $('meta[property^="og:"]').each((_, el) => {
    const property = $(el).attr('property');
    const content = $(el).attr('content');
    if (property && content) {
      result.openGraph[property.replace('og:', '')] = content;
    }
  });

  // Twitter Card meta tags
  $('meta[name^="twitter:"], meta[property^="twitter:"]').each((_, el) => {
    const name = $(el).attr('name') || $(el).attr('property');
    const content = $(el).attr('content');
    if (name && content) {
      result.twitterCard[name.replace('twitter:', '')] = content;
    }
  });

  // Standard meta tags
  const standardMetas = ['description', 'author', 'keywords', 'robots', 'canonical'];
  for (const name of standardMetas) {
    const content = $(`meta[name="${name}"]`).attr('content');
    if (content) {
      result.metaData[name] = content;
    }
  }

  // Canonical URL
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical) {
    result.metaData['canonical'] = canonical;
  }

  return result;
}

// ============================================
// RSS AUTO-DISCOVERY
// ============================================

/**
 * Discover RSS/Atom feed URLs from HTML <link> tags.
 * 
 * @param html - Raw HTML string
 * @returns Array of discovered feed URLs
 */
export function discoverRSSFeeds(html: string): string[] {
  const $ = cheerio.load(html);
  const feeds: string[] = [];

  $('link[rel="alternate"]').each((_, el) => {
    const type = $(el).attr('type');
    const href = $(el).attr('href');
    if (href && type && (
      type.includes('rss') ||
      type.includes('atom') ||
      type.includes('xml')
    )) {
      feeds.push(href);
    }
  });

  return feeds;
}

// ============================================
// LINK EXTRACTION FOR CRAWLING
// ============================================

/**
 * Extract links from HTML using an optional CSS selector.
 * 
 * @param html - Raw HTML string
 * @param selector - CSS selector for link elements (default: "a")
 * @returns Array of href values
 */
export function extractLinks(html: string, selector: string = 'a'): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];

  $(selector).each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
      links.push(href);
    }
  });

  return [...new Set(links)]; // Deduplicate
}

// ============================================
// URL NORMALIZATION
// ============================================

/** Common tracking query parameters to strip during normalization */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
  '_ga', '_gl', 'spm', 'scm', '__s', 'oly_enc_id', 'oly_anon_id',
  'vero_id', 'wickedid', '_hsenc', '_hsmi',
]);

/**
 * Normalize a URL for deduplication during crawling.
 * Strips fragments, tracking parameters, and normalizes trailing slashes.
 * 
 * @param url - URL to normalize
 * @returns Normalized URL string
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove fragment
    parsed.hash = '';

    // Remove tracking query params
    const params = new URLSearchParams(parsed.search);
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        params.delete(key);
      }
    }

    // Sort remaining params for consistency
    const sortedParams = new URLSearchParams([...params.entries()].sort());
    parsed.search = sortedParams.toString() ? `?${sortedParams.toString()}` : '';

    // Normalize trailing slash (remove from paths, keep for root)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // Lowercase hostname
    parsed.hostname = parsed.hostname.toLowerCase();

    return parsed.toString();
  } catch {
    return url; // Return as-is if parsing fails
  }
}

/**
 * Resolve a potentially relative URL against a base URL.
 * 
 * @param href - The href to resolve (may be relative)
 * @param baseUrl - The base URL to resolve against
 * @returns Absolute URL string, or null if invalid
 */
export function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Check if two URLs share the same origin (protocol + hostname + port).
 */
export function isSameOrigin(url1: string, url2: string): boolean {
  try {
    const a = new URL(url1);
    const b = new URL(url2);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

/**
 * Check if a URL path matches any of the given glob-like patterns.
 * Supports basic wildcards: * matches any characters within a path segment,
 * ** matches any path segments.
 * 
 * @param urlPath - The URL pathname to check
 * @param patterns - Array of glob patterns (e.g., ["/blog/*", "/docs/**"])
 * @returns True if the path matches any pattern
 */
export function matchesPathPattern(urlPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const regex = pattern
      .replace(/\*\*/g, '___GLOBSTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___GLOBSTAR___/g, '.*');

    if (new RegExp(`^${regex}$`).test(urlPath)) {
      return true;
    }
  }
  return false;
}

// ============================================
// PAGE CONTENT EXTRACTION (URL fetch + AI)
// ============================================

export interface ExtractPageContentOptions {
  /** Source ID for browser context reuse (shares cookies/session) */
  sourceId: string;
  /** Source name for the ContentItem.source field */
  sourceName: string;
  /** Content type identifier (e.g., "rss", "realtor", "webPageContent") */
  type: string;
  /** Title hint from RSS feed or link text */
  title?: string;
  /** AI provider for structured extraction. If omitted, uses Readability only. */
  provider?: AiProvider;
  /** TypeScript interface string for AI to map data against */
  objectTypeString?: string;
  /** Topics to exclude from AI extraction */
  excludeTopics?: string;
  /** Pre-fetched HTML. When provided, skips the URL fetch. Useful for webhook
   *  payloads where the HTML is already in the payload body. */
  html?: string;
  /** Storage plugin for caching generated parsers. When provided, the system
   *  will check for a cached parser before calling the LLM, and save new
   *  parsers after successful generation. */
  storage?: StoragePlugin;
  /** Max consecutive cached parser failures before regenerating (default 3) */
  maxConsecutiveFailures?: number;
}

/**
 * Fetch a URL (or use pre-fetched HTML), extract content, and optionally
 * enrich with AI-powered structured extraction.
 * 
 * This replaces the separate HTMLParser class. Sources call this directly,
 * following the same inline-AI pattern used by GitHubSource and
 * DiscordChannelSource.
 * 
 * Flow:
 * 1. Fetch HTML from URL (or use pre-fetched html option)
 * 2. Extract structured data for free (JSON-LD, OG tags, Twitter Cards)
 * 3. Extract readable content via Mozilla Readability
 * 4. If AI provider: convert to markdown → prompt → AI → structured JSON
 * 5. If no AI: return Readability-extracted text (up to 5000 chars)
 * 
 * @param url - The page URL to fetch and extract content from
 * @param options - Configuration for extraction
 * @returns ContentItem with extracted content, or undefined on failure
 */
export async function extractPageContent(
  url: string,
  options: ExtractPageContentOptions,
): Promise<ContentItem | undefined> {
  try {
    // Diagnostic: log what strategy will be used
    const hasProvider = !!options.provider;
    const hasStorage = !!(options.storage && typeof options.storage !== 'string');
    const strategy = hasProvider && hasStorage ? 'parser-cache' : hasProvider ? 'direct-llm (no storage)' : 'readability-only';
    console.log(`[extractPageContent] url=${url} provider=${hasProvider} storage=${hasStorage} strategy=${strategy}`);

    // 1. Get HTML (fetch from URL or use pre-fetched)
    let html: string;
    if (options.html) {
      html = options.html;
    } else {
      const result = await fetchHTML(url, { sourceId: options.sourceId });
      html = result.html;
    }

    // 2. Extract structured data for free (JSON-LD, OG tags, etc.)
    const structuredData = extractStructuredData(html);

    // 3. Extract readable content via Readability
    const readable = extractReadableContent(html, url);

    // 4. If AI provider is available, try cached parser first, then gold-standard extraction + parser generation
    if (options.provider) {
      const domain = extractDomain(url);
      const pathPattern = derivePathPattern(url);
      const storage = options.storage;
      const maxFailures = options.maxConsecutiveFailures ?? 3;

      // --- Phase 1: Try cached parser ---
      if (storage) {
        try {
          const cachedParser = await storage.getSiteParser(domain, pathPattern, options.objectTypeString);

          if (cachedParser) {
            try {
              const parsed = executeParser(html, cachedParser.parserCode);
              const validation = validateMinimumFields(parsed, 3);

              if (validation.valid) {
                // Parser works — record success and return
                await storage.updateSiteParserStatus(cachedParser.id!, true);
                console.log(`[extractPageContent] Cached parser hit for ${domain}${pathPattern} (v${cachedParser.version}, ${validation.presentFields.length} fields)`);
                return buildContentItemFromParsed(url, parsed, readable, structuredData, options, 'cached-parser');
              }

              // Parser produced too few fields
              await storage.updateSiteParserStatus(cachedParser.id!, false);
              console.warn(`[extractPageContent] Cached parser returned only ${validation.presentFields.length} fields for ${url}`);

              if (cachedParser.consecutiveFailures + 1 < maxFailures) {
                console.log(`[extractPageContent] Consecutive failures: ${cachedParser.consecutiveFailures + 1}/${maxFailures}, will use direct LLM extraction`);
              } else {
                console.log(`[extractPageContent] ${maxFailures} consecutive failures reached, will regenerate parser for ${domain}${pathPattern}`);
              }
            } catch (execErr: any) {
              await storage.updateSiteParserStatus(cachedParser.id!, false);
              console.warn(`[extractPageContent] Cached parser execution error for ${url}: ${execErr.message}`);
            }
          }
        } catch (lookupErr: any) {
          console.warn(`[extractPageContent] Parser lookup failed: ${lookupErr.message}`);
        }
      }

      // --- Phase 2: Direct LLM extraction (gold standard), then generate + save parser ---
      try {
        // Step A: Run the direct LLM extraction to get the gold-standard result
        const markdown = htmlToMarkdown(html);
        const prompt = createHtmlAnalysisPrompt(markdown, options.objectTypeString, options.excludeTopics);
        const summary = await options.provider.summarize(prompt, SUMMARIZE_OPTIONS.htmlAnalysis);

        if (summary) {
          const cleaned = summary.replace(/```json\n?|```/g, '').trim();
          const goldStandard = JSON.parse(cleaned) as Record<string, any>;

          // Build the ContentItem from gold-standard (this is what we'll return regardless)
          const goldStandardItem = buildContentItemFromParsed(url, goldStandard, readable, structuredData, options, 'ai');

          // Step B: Generate a reusable parser from the gold-standard (fire-and-forget)
          if (storage) {
            try {
              console.log(`[extractPageContent] Generating parser for ${domain}${pathPattern} from gold-standard (${Object.keys(goldStandard).length} fields)...`);
              const code = await generateParserFromExample(html, goldStandard, options.provider, options.objectTypeString);

              // Step C: Execute the parser against the same HTML and validate against gold-standard
              const parsed = executeParser(html, code);
              const validation = validateAgainstExample(parsed, goldStandard, 0.5);

              if (validation.valid) {
                // Parser reproduces the gold-standard — save it
                const now = Math.floor(Date.now() / 1000);
                const parser: SiteParser = {
                  domain,
                  pathPattern,
                  parserCode: code,
                  objectTypeString: options.objectTypeString,
                  version: 1,
                  consecutiveFailures: 0,
                  lastSuccessAt: now,
                  createdAt: now,
                  updatedAt: now,
                  sampleUrl: url,
                  metadata: {
                    goldStandardFieldCount: Object.keys(goldStandard).length,
                    parserFieldCount: validation.presentFields.length,
                    score: validation.score,
                  },
                };

                await storage.saveSiteParser(parser);
                console.log(`[extractPageContent] Parser saved for ${domain}${pathPattern} (score=${validation.score.toFixed(2)}, ${validation.presentFields.length}/${validation.totalFields} fields)`);
              } else {
                console.warn(`[extractPageContent] Generated parser failed validation (score=${validation.score.toFixed(2)}, missing=[${validation.missingFields.join(', ')}]). Parser not saved, but gold-standard result is fine.`);
              }
            } catch (parserErr: any) {
              console.warn(`[extractPageContent] Parser generation failed: ${parserErr.message}. Gold-standard result still returned.`);
            }
          }

          // Step D: Always return the gold-standard result
          return goldStandardItem;
        }
      } catch (aiErr) {
        console.warn(`[extractPageContent] AI extraction failed for ${url}:`, aiErr);
        // Fall through to readability-based extraction
      }
    }

    // 5. Fallback: return readability-extracted content (no AI needed)
    const urlHash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
    const textHash = crypto.createHash('md5').update(readable.text.substring(0, 500)).digest('hex').slice(0, 8);

    return {
      cid: `web-${urlHash}-${textHash}`,
      type: options.type,
      source: options.sourceName,
      text: readable.text.substring(0, 5000),
      title: options.title || readable.title,
      link: url,
      date: parseExtractedDate(readable.publishedDate),
      metadata: {
        excerpt: readable.excerpt,
        author: readable.author,
        siteName: readable.siteName,
        structuredData: compactStructuredData(structuredData),
        contentLength: readable.length,
        extractedBy: 'readability',
        modified: Math.floor(Date.now() / 1000),
      },
    };
  } catch (error) {
    console.error(`[extractPageContent] Error extracting ${url}:`, error);
    return undefined;
  }
}

/**
 * Parse various date formats into epoch seconds.
 */
function parseExtractedDate(dateValue: any): number {
  if (!dateValue) return Math.floor(Date.now() / 1000);
  if (typeof dateValue === 'number') return dateValue;

  try {
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return Math.floor(parsed.getTime() / 1000);
    }
  } catch {
    // Fall through
  }

  return Math.floor(Date.now() / 1000);
}

/**
 * Remove empty structured data sections to keep metadata clean.
 */
function compactStructuredData(data: ReturnType<typeof extractStructuredData>): Record<string, any> | undefined {
  const compact: Record<string, any> = {};
  if (data.jsonLd.length > 0) compact.jsonLd = data.jsonLd;
  if (Object.keys(data.openGraph).length > 0) compact.openGraph = data.openGraph;
  if (Object.keys(data.twitterCard).length > 0) compact.twitterCard = data.twitterCard;
  if (Object.keys(data.metaData).length > 0) compact.metaData = data.metaData;
  return Object.keys(compact).length > 0 ? compact : undefined;
}

/**
 * Build a ContentItem from parser-extracted data, merging with Readability
 * and structured data as supplementary context.
 */
function buildContentItemFromParsed(
  url: string,
  parsed: Record<string, any>,
  readable: ReadableContent,
  structuredData: StructuredData,
  options: ExtractPageContentOptions,
  extractedBy: string,
): ContentItem {
  const urlHash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
  const contentHash = crypto.createHash('md5').update(JSON.stringify(parsed)).digest('hex').slice(0, 8);

  return {
    cid: `web-${urlHash}-${contentHash}`,
    type: options.type,
    source: options.sourceName,
    text: parsed.description || parsed.text || parsed.summary || readable.text.substring(0, 1000),
    title: parsed.title || options.title || readable.title,
    link: url,
    date: parseExtractedDate(parsed.date || parsed.publishedDate || parsed.listingDate || readable.publishedDate),
    metadata: {
      ...parsed,
      structuredData: compactStructuredData(structuredData),
      author: parsed.author || readable.author,
      siteName: readable.siteName,
      extractedBy,
      modified: Math.floor(Date.now() / 1000),
    },
  };
}
