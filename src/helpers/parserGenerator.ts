/**
 * LLM-generated HTML parser creation and sandboxed execution.
 *
 * Instead of sending page content to an LLM every time and hoping it
 * extracts data correctly, this module asks the LLM to generate a
 * **reusable JavaScript parser function** that runs against the HTML
 * using cheerio. The parser is saved and re-executed on subsequent
 * visits to the same site, skipping the LLM entirely.
 *
 * Generated parsers run in a Node.js `vm` sandbox with a strict timeout
 * and no access to require/fs/net/process.
 *
 * @module helpers/parserGenerator
 */

import vm from 'vm';
import * as cheerio from 'cheerio';
import type { AiProvider } from '../types';
import {
  createParserFromExamplePrompt,
  SUMMARIZE_OPTIONS,
} from './promptHelper';

// ============================================
// GOLD-STANDARD PARSER GENERATION
// ============================================

/**
 * Generate a parser by showing the LLM the HTML and the expected JSON output
 * (gold-standard from direct LLM extraction). This is "programming by example" —
 * the LLM sees the input-output pair and writes code to transform one to the other.
 *
 * Also extracts embedded data from script tags (JSON-LD, __NEXT_DATA__, inline state)
 * and includes it in the prompt so the LLM knows to look for data there.
 *
 * @param html - The raw HTML of the page
 * @param goldStandard - The correctly extracted JSON from direct LLM extraction
 * @param provider - AI provider to generate the parser
 * @param objectTypeString - Optional TS interface for context
 * @returns The generated JavaScript function body string
 */
export async function generateParserFromExample(
  html: string,
  goldStandard: Record<string, any>,
  provider: AiProvider,
  objectTypeString?: string,
): Promise<string> {
  const embeddedData = extractEmbeddedData(html);
  const prompt = createParserFromExamplePrompt(embeddedData, goldStandard, objectTypeString);

  const response = await provider.summarize(prompt, SUMMARIZE_OPTIONS.parserGeneration);

  if (!response) {
    throw new Error('LLM returned empty response for parser-from-example generation');
  }

  return cleanParserResponse(response);
}

/**
 * Extract embedded JSON data from HTML script tags.
 *
 * Many modern sites (especially SPAs like Next.js, React, etc.) embed structured
 * data in script tags rather than in visible DOM elements. This function finds
 * those data sources and returns a summary showing:
 * - What data is available
 * - How to access it with cheerio selectors
 * - A truncated sample of the data
 *
 * @param html - Raw HTML string
 * @returns A compact summary string for inclusion in the LLM prompt
 */
export function extractEmbeddedData(html: string): string {
  const $ = cheerio.load(html);
  const sections: string[] = [];

  // 1. __NEXT_DATA__ (Next.js hydration)
  const nextData = $('script#__NEXT_DATA__').html();
  if (nextData) {
    try {
      const parsed = JSON.parse(nextData);
      const keys = describeObjectKeys(parsed, 3);
      const sample = JSON.stringify(parsed, null, 2).substring(0, 3000);
      sections.push(
        `DATA SOURCE: <script id="__NEXT_DATA__"> (Next.js hydration data)\n` +
        `ACCESS: var data = JSON.parse($('script#__NEXT_DATA__').html());\n` +
        `STRUCTURE: ${keys}\n` +
        `SAMPLE:\n${sample}`,
      );
    } catch {
      sections.push(
        `DATA SOURCE: <script id="__NEXT_DATA__"> (found but could not parse)\n` +
        `ACCESS: var data = JSON.parse($('script#__NEXT_DATA__').html());`,
      );
    }
  }

  // 2. JSON-LD structured data
  $('script[type="application/ld+json"]').each((i, el) => {
    const text = $(el).html();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        const type = parsed['@type'] || 'unknown';
        const sample = JSON.stringify(parsed, null, 2).substring(0, 1500);
        sections.push(
          `DATA SOURCE: <script type="application/ld+json"> (#${i + 1}, @type="${type}")\n` +
          `ACCESS: var data = JSON.parse($('script[type="application/ld+json"]').eq(${i}).html());\n` +
          `SAMPLE:\n${sample}`,
        );
      } catch {
        // Skip malformed
      }
    }
  });

  // 3. Inline state hydration (window.__INITIAL_STATE__, window.__DATA__, etc.)
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    // Look for common patterns: window.X = {...} or window.X = JSON.parse(...)
    const patterns = [
      /window\.__INITIAL_STATE__\s*=\s*/,
      /window\.__DATA__\s*=\s*/,
      /window\.__PRELOADED_STATE__\s*=\s*/,
      /window\.__APP_DATA__\s*=\s*/,
    ];

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        const varName = text.match(/window\.(\w+)\s*=/)?.[1] || 'unknown';
        // Try to extract a JSON sample
        const jsonStart = text.indexOf('{');
        if (jsonStart >= 0) {
          const sample = text.substring(jsonStart, jsonStart + 1500);
          sections.push(
            `DATA SOURCE: Inline script with window.${varName}\n` +
            `ACCESS: Look for <script> containing "window.${varName}" and parse the JSON\n` +
            `SAMPLE (first 1500 chars):\n${sample}`,
          );
        }
        break;
      }
    }
  });

  if (sections.length === 0) {
    return 'No embedded JSON data found in script tags. Extract data from visible DOM elements only.';
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Describe the top-level keys of an object (with nesting up to maxDepth).
 */
function describeObjectKeys(obj: any, maxDepth: number, depth: number = 0): string {
  if (depth >= maxDepth || typeof obj !== 'object' || obj === null) {
    return typeof obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return `[${describeObjectKeys(obj[0], maxDepth, depth + 1)}, ...] (${obj.length} items)`;
  }

  const keys = Object.keys(obj).slice(0, 10);
  const parts = keys.map(k => {
    const val = obj[k];
    if (typeof val === 'object' && val !== null) {
      return `${k}: {${describeObjectKeys(val, maxDepth, depth + 1)}}`;
    }
    return `${k}: ${typeof val}`;
  });

  if (Object.keys(obj).length > 10) {
    parts.push(`... (${Object.keys(obj).length} keys total)`);
  }

  return parts.join(', ');
}

// ============================================
// SANDBOXED PARSER EXECUTION
// ============================================

/**
 * Execute a generated parser against HTML in a sandboxed vm context.
 *
 * The parser code is expected to be a function body that receives a
 * cheerio-loaded `$` instance and returns a JSON object. It runs inside
 * `vm.runInNewContext` with:
 * - No access to `require`, `process`, `fs`, `fetch`, `globalThis` etc.
 * - A strict timeout (default 5 seconds)
 * - Only `$` (cheerio) and basic JS globals exposed
 *
 * @param html - Raw HTML to parse
 * @param parserCode - JavaScript function body string
 * @param timeoutMs - Execution timeout in milliseconds (default 5000)
 * @returns Parsed data as a plain object
 */
export function executeParser(
  html: string,
  parserCode: string,
  timeoutMs: number = 5000,
): Record<string, any> {
  const $ = cheerio.load(html);

  // Build a minimal sandbox context — only cheerio $ and safe JS primitives
  const sandbox: Record<string, any> = {
    $,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Date,
    RegExp,
    Math,
    Map,
    Set,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    // Explicitly block dangerous globals
    require: undefined,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    fetch: undefined,
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    Buffer: undefined,
    __dirname: undefined,
    __filename: undefined,
    module: undefined,
    exports: undefined,
  };

  const context = vm.createContext(sandbox);

  // Wrap the parser code in a defensive IIFE:
  // - Declare a `result` variable before the user code so partial results survive
  // - Wrap the entire user code in try-catch so crashes return whatever was built
  const wrappedCode = `(function($) {
  var result = {};
  var __parserError = null;
  try {
${parserCode}
  } catch(__e) {
    __parserError = __e.message || String(__e);
  }
  // If the user code returned a value via "return", we won't reach here.
  // But if it crashed mid-way, return the partial result object.
  if (__parserError) { result.__parserError = __parserError; }
  return result;
})($)`;

  try {
    const script = new vm.Script(wrappedCode, {
      filename: 'generated-parser.js',
    });

    const result = script.runInContext(context, {
      timeout: timeoutMs,
      breakOnSigint: true,
    });

    // Ensure the result is a plain object (not a function, promise, etc.)
    if (result === null || result === undefined) {
      throw new Error('Parser returned null/undefined');
    }

    if (typeof result !== 'object' || Array.isArray(result)) {
      throw new Error(`Parser returned ${typeof result}, expected object`);
    }

    // Deep-clone to strip any vm context references
    const cloned = JSON.parse(JSON.stringify(result));

    // If the parser crashed but we got partial data, log but don't throw
    if (cloned.__parserError) {
      const errorMsg = cloned.__parserError;
      delete cloned.__parserError;
      const fieldCount = Object.keys(cloned).length;
      if (fieldCount > 0) {
        console.warn(`[executeParser] Parser threw "${errorMsg}" but recovered ${fieldCount} fields`);
        return cloned;
      }
      throw new Error(errorMsg);
    }

    return cloned;
  } catch (err: any) {
    if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error(`Parser execution timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Parser execution failed: ${err.message}`);
  }
}

// ============================================
// PATH PATTERN DERIVATION
// ============================================

/**
 * Derive a glob-style path pattern from a URL.
 *
 * Heuristics:
 * - Numeric-only segments become `*` (IDs, dates)
 * - The final segment (slug) becomes `*`
 * - Preserve structural segments like /blog/, /products/, /docs/
 * - If only root path, returns a single wildcard
 *
 * Examples:
 * - https://example.com/blog/2024/my-post  =>  /blog/star/star
 * - https://example.com/products/shoes/123  =>  /products/shoes/star
 * - https://example.com/  =>  /star
 */
export function derivePathPattern(url: string): string {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;

    // Normalize trailing slash
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // Root path
    if (pathname === '/' || pathname === '') {
      return '/*';
    }

    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      return '/*';
    }

    // Always wildcard the last segment (the specific page slug/ID)
    const patternSegments = segments.map((seg, idx) => {
      // Last segment is always wildcarded
      if (idx === segments.length - 1) return '*';
      // Numeric-only segments (IDs, years, page numbers)
      if (/^\d+$/.test(seg)) return '*';
      // UUID-like segments
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return '*';
      // Hash-like segments (hex strings > 8 chars)
      if (/^[0-9a-f]{8,}$/i.test(seg) && seg.length >= 12) return '*';
      // Keep structural segments as-is
      return seg;
    });

    return '/' + patternSegments.join('/');
  } catch {
    return '/*';
  }
}

/**
 * Extract domain from a URL.
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Clean the LLM response to extract just the function body.
 * Strips markdown code fences and extracts the function body.
 */
function cleanParserResponse(response: string): string {
  let code = response.trim();

  // Strip markdown code fences
  code = code.replace(/^```(?:javascript|js|typescript|ts)?\n?/i, '');
  code = code.replace(/\n?```$/i, '');
  code = code.trim();

  // If the LLM wrapped it in a function declaration, extract the body
  const funcMatch = code.match(/^function\s*\w*\s*\(\s*\$\s*\)\s*\{([\s\S]*)\}$/);
  if (funcMatch) {
    code = funcMatch[1].trim();
  }

  // If the LLM wrapped it in an arrow function, extract the body
  const arrowMatch = code.match(/^\(\s*\$\s*\)\s*=>\s*\{([\s\S]*)\}$/);
  if (arrowMatch) {
    code = arrowMatch[1].trim();
  }

  if (!code) {
    throw new Error('LLM response did not contain valid parser code');
  }

  return code;
}
