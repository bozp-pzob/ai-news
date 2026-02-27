/**
 * Browser automation helper using patchright (optional dependency).
 * 
 * Provides bot-resistant browser automation for scraping pages protected by
 * Cloudflare, Kasada, bot detection, or requiring JavaScript rendering.
 * 
 * Features:
 * - Auto-fallback: tries node-fetch first, falls back to patchright on failure
 * - Per-source persistent browser contexts (separate cookies/storage/profile)
 * - Patchright best-practice config: persistent context, system Chrome, no custom UA
 * - Headless/headed toggle via BROWSER_HEADLESS env var (default: true)
 * - Xvfb auto-start when BROWSER_HEADLESS=false on Linux servers
 * - SSRF protection (blocks private IP ranges)
 * - Retry with exponential backoff
 * - Cookie consent auto-dismissal
 * - patchright is optional -- degrades gracefully to node-fetch only
 * 
 * @module helpers/patchrightHelper
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync, spawn, ChildProcess } from 'child_process';
import fetch from 'node-fetch';

// Dynamic import for patchright (optional dependency)
// patchright may not be installed -- we dynamically import and handle the error
let patchrightModule: any = null;
let patchrightAvailable: boolean | null = null;

/**
 * Attempt to load patchright. Returns true if available, false otherwise.
 */
async function loadPatchright(): Promise<boolean> {
  if (patchrightAvailable !== null) return patchrightAvailable;
  try {
    // Dynamic require to avoid compile-time errors when patchright is not installed
    patchrightModule = require('patchright');
    patchrightAvailable = true;
    console.log('[PatchrightHelper] patchright loaded successfully');
  } catch {
    patchrightAvailable = false;
    console.warn('[PatchrightHelper] patchright not installed. Browser-based fetching disabled. Install with: npm install patchright');
  }
  return patchrightAvailable;
}

// ============================================
// XVFB VIRTUAL DISPLAY MANAGEMENT
// ============================================

let xvfbProcess: ChildProcess | null = null;
let xvfbDisplay: string | null = null;

/**
 * Ensure a display is available for running Chrome on Linux.
 * 
 * On macOS/Windows: no-op (native display or built-in compositing).
 * On Linux with DISPLAY already set: no-op (user has display or Xvfb configured).
 * On Linux without DISPLAY: auto-starts Xvfb on :99.
 * 
 * Note: Some Chrome/Patchright builds on Linux need DISPLAY even in headless
 * mode. We always try to ensure a display on Linux, but only hard-fail if
 * we're in headed mode (BROWSER_HEADLESS=false). In headless mode, if Xvfb
 * is unavailable, we warn and let Chrome try without it.
 */
async function ensureDisplay(): Promise<void> {
  // Already have a display
  if (process.env.DISPLAY) {
    return;
  }

  // macOS and Windows don't need X11
  const platform = os.platform();
  if (platform === 'darwin' || platform === 'win32') {
    return;
  }

  // We already started Xvfb in this session
  if (xvfbDisplay) {
    process.env.DISPLAY = xvfbDisplay;
    return;
  }

  const isHeaded = process.env.BROWSER_HEADLESS === 'false';

  // Linux with no display -- try to start Xvfb
  console.log('[PatchrightHelper] No DISPLAY detected on Linux. Attempting to start Xvfb...');

  // Check if Xvfb is installed
  let xvfbInstalled = false;
  try {
    execSync('which Xvfb', { stdio: 'pipe' });
    xvfbInstalled = true;
  } catch {
    if (isHeaded) {
      // Headed mode absolutely requires a display
      console.error(
        '[PatchrightHelper] Xvfb is not installed. Headed browser mode requires a display server.\n' +
        '  Install with: sudo apt-get install -y xvfb\n' +
        '  Or set DISPLAY env var to an existing X server.'
      );
      throw new Error('Xvfb not installed and no DISPLAY available. Cannot launch headed browser.');
    }
    // Headless mode — warn but don't throw, Chrome may work without DISPLAY
    console.warn(
      '[PatchrightHelper] Xvfb is not installed. Headless Chrome may still work, but if it fails:\n' +
      '  Install with: sudo apt-get install -y xvfb'
    );
    return;
  }

  if (!xvfbInstalled) return;

  // Check if Xvfb is already running on :99
  try {
    execSync('xdpyinfo -display :99 2>/dev/null', { stdio: 'pipe' });
    // :99 is already running
    xvfbDisplay = ':99';
    process.env.DISPLAY = xvfbDisplay;
    console.log('[PatchrightHelper] Found existing Xvfb on display :99');
    return;
  } catch {
    // :99 is not running, we'll start it
  }

  // Start Xvfb on display :99 with a reasonable screen size
  try {
    const proc = spawn('Xvfb', [':99', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], {
      stdio: 'ignore',
      detached: true,
    });

    // Allow it to detach so it doesn't block Node.js shutdown
    proc.unref();
    xvfbProcess = proc;

    // Wait briefly for Xvfb to start
    await new Promise(resolve => setTimeout(resolve, 500));

    xvfbDisplay = ':99';
    process.env.DISPLAY = xvfbDisplay;
    console.log('[PatchrightHelper] Started Xvfb on display :99');

    // Cleanup on process exit
    const cleanup = () => {
      if (xvfbProcess) {
        try {
          xvfbProcess.kill();
        } catch {
          // Ignore
        }
        xvfbProcess = null;
      }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (err: any) {
    if (isHeaded) {
      console.error(`[PatchrightHelper] Failed to start Xvfb: ${err.message}`);
      throw new Error('Failed to start Xvfb. Cannot launch headed browser without a display.');
    }
    // Headless mode — warn but continue
    console.warn(`[PatchrightHelper] Failed to start Xvfb: ${err.message}. Continuing without display — headless Chrome may still work.`);
  }
}

// ============================================
// SSRF PROTECTION
// ============================================

/** Private/reserved IP ranges that should be blocked by default */
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // Loopback
  /^10\./,                           // Class A private
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // Class B private
  /^192\.168\./,                     // Class C private
  /^169\.254\./,                     // Link-local
  /^0\./,                            // Current network
  /^\[::1\]/,                        // IPv6 loopback
  /^\[fc/i,                          // IPv6 unique local
  /^\[fd/i,                          // IPv6 unique local
  /^\[fe80:/i,                       // IPv6 link-local
];

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal'];

/**
 * Validate a URL for SSRF protection.
 * Blocks private IP ranges and localhost unless explicitly allowed.
 */
export function validateUrl(url: string, allowPrivateIPs: boolean = false): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: `Unsupported protocol: ${parsed.protocol}` };
    }

    if (allowPrivateIPs) return { valid: true };

    const hostname = parsed.hostname.toLowerCase();

    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      return { valid: false, error: `Blocked hostname: ${hostname}` };
    }

    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, error: `Blocked private IP: ${hostname}` };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: `Invalid URL: ${url}` };
  }
}

// ============================================
// BROWSER MANAGER (Singleton)
// ============================================

/** Common cookie consent selectors for auto-dismissal */
const COOKIE_CONSENT_SELECTORS = [
  '[data-cookieconsent="accept"]',
  '.cookie-accept',
  '#accept-cookies',
  '#cookie-accept',
  '.accept-cookies',
  'button[aria-label*="accept"]',
  'button[aria-label*="Accept"]',
  '.cc-accept',
  '.cc-btn.cc-dismiss',
  '#onetrust-accept-btn-handler',
  '.js-cookie-consent-agree',
];

/** Default User-Agent for node-fetch requests (NOT used for browser -- browser uses its own real UA) */
const DEFAULT_FETCH_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Manages per-source persistent browser contexts using patchright.
 * 
 * Each source gets its own persistent context, which is a dedicated browser
 * process with its own profile directory (cookies, localStorage, cache).
 * This follows patchright's best-practice configuration:
 * 
 * - Uses `launchPersistentContext()` (not `launch()` + `newContext()`)
 * - Uses system Chrome via `channel: 'chrome'` (not bundled Chromium)
 * - Headless by default (set BROWSER_HEADLESS=false for headed + Xvfb)
 * - Uses `viewport: null` (natural window size, not detectable)
 * - No custom User-Agent (browser's real UA, not detectable)
 * 
 * This configuration defeats Kasada, Cloudflare Turnstile, and most other
 * advanced bot detection systems that fingerprint the browser environment.
 */
export class BrowserManager {
  /** Map of sourceId -> persistent browser context (each is its own browser process) */
  private static contexts: Map<string, any> = new Map();
  private static dataDir = path.join(__dirname, '../../.browser-data');

  /**
   * Get or create a persistent browser context for a specific source.
   * Each source gets its own browser process with an isolated profile directory
   * at `.browser-data/{sourceId}/`.
   */
  static async getContext(sourceId: string): Promise<any> {
    // Check if we already have a context for this source
    const existing = BrowserManager.contexts.get(sourceId);
    if (existing) return existing;

    const available = await loadPatchright();
    if (!available) {
      throw new Error('patchright is not installed. Cannot create browser context.');
    }

    // Ensure we have a display (starts Xvfb on headless Linux)
    await ensureDisplay();

    const { chromium } = patchrightModule;

    // Create per-source profile directory
    const profileDir = path.join(BrowserManager.dataDir, sourceId);
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    // Launch persistent context with patchright best-practice settings.
    // This creates a dedicated browser process with its own profile.
    //
    // IMPORTANT: Do NOT add extra Chrome args (--no-sandbox, --disable-gpu, etc.)
    // These are well-known automation fingerprints that Kasada and other advanced
    // bot detection systems specifically look for. Patchright's effectiveness
    // depends on launching Chrome as close to a normal user session as possible.
    //
    // Headless mode: controlled by BROWSER_HEADLESS env var.
    //   "true" (default) — new Chrome headless mode, no Xvfb needed
    //   "false" — real headed mode, requires display (Xvfb auto-started on Linux)
    const headless = process.env.BROWSER_HEADLESS !== 'false';
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',           // Use system Chrome (not bundled Chromium)
      headless,                    // Headless by default; set BROWSER_HEADLESS=false for headed
      viewport: null,              // Natural window size (not detectable)
      // No userAgent -- use browser's real UA (custom UA is detectable)
      // No extra args -- any --no-* or --disable-* flags are detectable fingerprints
    });

    console.log(`[BrowserManager] Persistent context launched for "${sourceId}" (profile: ${profileDir}, headless: ${headless})`);
    BrowserManager.contexts.set(sourceId, context);
    return context;
  }

  /**
   * Close and remove a specific source's persistent browser context.
   * This also terminates the underlying browser process.
   */
  static async closeContext(sourceId: string): Promise<void> {
    const context = BrowserManager.contexts.get(sourceId);
    if (context) {
      try {
        await context.close();
        console.log(`[BrowserManager] Closed persistent context for "${sourceId}"`);
      } catch (err) {
        console.warn(`[BrowserManager] Error closing context for ${sourceId}:`, err);
      }
      BrowserManager.contexts.delete(sourceId);
    }
  }

  /**
   * Close all browser contexts and their browser processes.
   * Should be called during application shutdown.
   */
  static async closeAll(): Promise<void> {
    for (const [sourceId, context] of BrowserManager.contexts) {
      try {
        await context.close();
      } catch {
        // Ignore errors during shutdown
      }
    }
    BrowserManager.contexts.clear();
    console.log('[BrowserManager] All browser contexts closed');
  }
}

// ============================================
// FETCH FUNCTIONS
// ============================================

export interface FetchHTMLOptions {
  /** Source identifier for browser context isolation */
  sourceId?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom User-Agent string (used for node-fetch only, NOT for browser) */
  userAgent?: string;
  /** Max retry attempts (default: 2) */
  maxRetries?: number;
  /** Allow requests to private IPs (default: false) */
  allowPrivateIPs?: boolean;
  /** Custom headers for node-fetch requests */
  headers?: Record<string, string>;
}

export interface FetchHTMLResult {
  html: string;
  usedBrowser: boolean;
  url: string;
  statusCode?: number;
}

/** Patterns indicating a Cloudflare challenge or bot protection page */
const BOT_PROTECTION_PATTERNS = [
  '<title>Just a moment...</title>',               // Cloudflare
  '<title>Attention Required!</title>',             // Cloudflare
  'cf-browser-verification',                       // Cloudflare
  'challenge-platform',                            // Cloudflare
  '<title>Access denied</title>',                  // Generic
  'captcha-delivery',                              // DataDome
  'px-captcha',                                    // PerimeterX
  'Please verify you are a human',                 // Generic
  'window.KPSDK',                                  // Kasada
  'Your request could not be processed',           // Kasada block page
];

/**
 * Check if an HTML response indicates bot protection / Cloudflare challenge.
 */
function isBotProtected(html: string): boolean {
  const lower = html.toLowerCase();
  return BOT_PROTECTION_PATTERNS.some(pattern => lower.includes(pattern.toLowerCase()));
}

/**
 * Delay helper with jitter for exponential backoff.
 */
function backoffDelay(attempt: number, baseMs: number = 1000): Promise<void> {
  const delay = baseMs * Math.pow(2, attempt) + Math.random() * 500;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Try to auto-dismiss cookie consent banners on a page.
 */
async function dismissCookieConsent(page: any): Promise<void> {
  for (const selector of COOKIE_CONSENT_SELECTORS) {
    try {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      // Ignore -- best-effort dismissal
    }
  }
}

/**
 * Wait for a bot-protection challenge to resolve.
 * 
 * Many bot protection systems (Kasada, Cloudflare Turnstile) show an
 * intermediate challenge page, then redirect or replace the DOM once solved.
 * This function polls the page content to detect when the challenge resolves.
 * 
 * @returns true if challenge was detected and resolved, false if no challenge found
 */
async function waitForChallengeResolution(page: any, maxWaitMs: number = 15000): Promise<boolean> {
  const initialHtml = await page.content();
  
  if (!isBotProtected(initialHtml)) {
    return false; // No challenge detected
  }

  console.log('[FetchHTML] Bot protection challenge detected, waiting for resolution...');
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(pollInterval);
    
    const currentHtml = await page.content();
    
    // Challenge resolved if the page is no longer a bot protection page
    if (!isBotProtected(currentHtml)) {
      const elapsed = Date.now() - startTime;
      console.log(`[FetchHTML] Challenge resolved after ${elapsed}ms`);
      return true;
    }

    // Also check if the URL changed (redirect after challenge)
    const currentUrl = page.url();
    if (currentUrl !== page.url()) {
      console.log(`[FetchHTML] Page redirected during challenge resolution`);
      await page.waitForTimeout(2000); // Wait for new page to settle
      return true;
    }
  }

  console.log(`[FetchHTML] Challenge did not resolve within ${maxWaitMs}ms`);
  return false;
}

/**
 * Perform a warmup visit to a site's homepage to establish bot-protection
 * cookies (Kasada KP_UIDz, etc.) before fetching the actual target URL.
 * 
 * Sites like realtor.com require Kasada cookies to be established via a
 * normal homepage visit before allowing access to API/RSS endpoints.
 * Subsequent requests with the same persistent context reuse these cookies.
 * 
 * Only warms up if the context has no cookies for the target domain.
 */
async function warmupIfNeeded(context: any, targetUrl: string): Promise<void> {
  const parsed = new URL(targetUrl);
  const origin = parsed.origin;

  // Check if we already have cookies for this domain (from a previous session
  // or earlier warmup). Persistent contexts preserve cookies across launches.
  const existingCookies = await context.cookies(origin);
  if (existingCookies.length > 0) {
    return; // Already warmed up
  }

  console.log(`[FetchHTML] No cookies for ${parsed.hostname}, performing warmup visit to homepage...`);
  const page = await context.newPage();
  try {
    await page.goto(origin, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    // Wait for Kasada/bot-protection scripts to run and set cookies
    await page.waitForTimeout(5000);

    const cookies = await context.cookies(origin);
    console.log(`[FetchHTML] Warmup complete: ${cookies.length} cookies established for ${parsed.hostname}`);
  } catch (err: any) {
    console.warn(`[FetchHTML] Warmup visit failed for ${origin}: ${err.message}`);
    // Continue anyway -- the target URL might still work
  } finally {
    await page.close();
  }
}

/**
 * Fetch content from a URL using a persistent browser context (patchright).
 * Uses best-practice config: system Chrome, persistent context, no custom UA.
 * 
 * Handles two key scenarios for bot-protected sites:
 * 
 * 1. **Warmup visits**: Sites with Kasada/bot protection require cookies to be
 *    established via a homepage visit before allowing API/RSS access. On first
 *    use (empty profile), automatically visits the site homepage first.
 * 
 * 2. **Download interception**: Non-HTML responses (RSS/XML) trigger browser
 *    downloads instead of rendering. Uses route interception to capture the
 *    response body directly, bypassing the download behavior.
 * 
 * 3. **Challenge waiting**: If a challenge page is detected, polls until it
 *    resolves (up to 15s) before returning content.
 */
async function fetchWithBrowser(url: string, options: FetchHTMLOptions = {}): Promise<string> {
  const sourceId = options.sourceId || 'default';
  const context = await BrowserManager.getContext(sourceId);

  // Warmup: visit homepage to establish bot-protection cookies if needed
  await warmupIfNeeded(context, url);

  const page = await context.newPage();
  try {
    // Set up route interception to capture non-HTML responses (RSS/XML/JSON)
    // that would otherwise trigger a download instead of rendering in the page.
    // Using an object wrapper so TypeScript doesn't narrow it to 'never' in callbacks.
    const intercepted = { body: null as string | null, status: null as number | null };
    const targetHostname = new URL(url).hostname;

    await page.route(`**/*`, async (route: any) => {
      const request = route.request();
      // Only intercept the main navigation request to our target URL
      if (request.isNavigationRequest() && request.url().includes(targetHostname)) {
        try {
          const response = await route.fetch();
          intercepted.status = response.status();
          const contentType = (response.headers()['content-type'] || '').toLowerCase();

          // If the response is not HTML, capture the body directly
          // (XML, JSON, plain text, octet-stream, etc.)
          if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            const body = await response.body();
            intercepted.body = body.toString('utf-8');
            console.log(`[FetchHTML] Intercepted non-HTML response (${contentType}, ${intercepted.body!.length} bytes)`);
          }

          // Fulfill the route so the page doesn't hang
          await route.fulfill({ response });
        } catch (err: any) {
          // If fetch fails, continue with normal routing
          await route.continue();
        }
      } else {
        await route.continue();
      }
    });

    // Navigate to the target URL
    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: options.timeout || 30000,
      });
    } catch (err: any) {
      // "Download is starting" error is expected for non-HTML content
      // We already captured the body via route interception
      if (err.message && err.message.includes('Download is starting') && intercepted.body) {
        console.log(`[FetchHTML] Download intercepted successfully for ${url}`);
        return intercepted.body;
      }
      // For other navigation errors, check if we got the body via interception
      if (intercepted.body && intercepted.body.length > 100) {
        console.log(`[FetchHTML] Navigation error but got intercepted body (${intercepted.body.length} bytes)`);
        return intercepted.body;
      }
      throw err;
    }

    // If we got the body via interception (non-HTML), return it directly
    if (intercepted.body && intercepted.body.length > 100) {
      return intercepted.body;
    }

    // For HTML pages: wait for content to settle (3s matches proven working config)
    await page.waitForTimeout(3000);

    // Check if we hit a challenge page and wait for it to resolve
    await waitForChallengeResolution(page);

    // Try to dismiss cookie consent banners
    await dismissCookieConsent(page);

    const html = await page.content();

    // Debug: log the page title and content length so we can see what we got
    const title = await page.title().catch(() => 'unknown');
    console.log(`[FetchHTML] Browser got: title="${title}", length=${html.length}, url=${page.url()}`);
    
    // Log a snippet if it looks like a block page
    if (html.length < 5000 || isBotProtected(html)) {
      const snippet = html.replace(/\s+/g, ' ').substring(0, 300);
      console.log(`[FetchHTML] Response snippet: ${snippet}...`);
    }

    return html;
  } finally {
    await page.close();
  }
}

/**
 * Fetch HTML from a URL with auto-fallback strategy.
 * 
 * 1. First tries node-fetch (fast, ~100ms)
 * 2. If it gets a 403, Cloudflare challenge, empty body, or connection error,
 *    retries with patchright browser (persistent context, system Chrome)
 * 3. If patchright is not installed, stays on node-fetch result and warns
 * 
 * Includes SSRF protection, retry with exponential backoff, and per-source
 * browser context isolation via persistent profiles.
 */
export async function fetchHTML(url: string, options: FetchHTMLOptions = {}): Promise<FetchHTMLResult> {
  // SSRF validation
  const urlCheck = validateUrl(url, options.allowPrivateIPs);
  if (!urlCheck.valid) {
    throw new Error(`[SSRF] ${urlCheck.error}`);
  }

  const maxRetries = options.maxRetries ?? 2;
  const timeout = options.timeout || 30000;
  const userAgent = options.userAgent || DEFAULT_FETCH_USER_AGENT;

  // Step 1: Try node-fetch first (fast path)
  let lastError: Error | null = null;
  let fetchHtml: string | null = null;
  let statusCode: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(options.headers || {}),
        },
        signal: controller.signal as any,
        redirect: 'follow',
      });

      clearTimeout(timer);
      statusCode = response.status;

      // Check for Retry-After header on 429
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter && attempt < maxRetries) {
          const waitMs = parseInt(retryAfter, 10) * 1000 || 5000;
          console.log(`[FetchHTML] 429 Too Many Requests, waiting ${waitMs}ms (Retry-After: ${retryAfter})`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
      }

      if (response.ok) {
        fetchHtml = await response.text();

        // Check if the response is a bot protection page
        if (!isBotProtected(fetchHtml) && fetchHtml.trim().length > 100) {
          return { html: fetchHtml, usedBrowser: false, url, statusCode };
        }

        // Bot protection detected -- fall through to browser
        console.log(`[FetchHTML] Bot protection detected on ${url}, will try browser fallback`);
        break;
      }

      // 403/503 often mean bot protection
      if (response.status === 403 || response.status === 503) {
        console.log(`[FetchHTML] HTTP ${response.status} on ${url}, will try browser fallback`);
        fetchHtml = await response.text();
        break;
      }

      // Other error status codes
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err: any) {
      lastError = err;
      if (err.name === 'AbortError') {
        console.log(`[FetchHTML] Timeout on attempt ${attempt + 1} for ${url}`);
      }
      if (attempt < maxRetries) {
        await backoffDelay(attempt);
      }
    }
  }

  // Step 2: Try patchright browser fallback
  const available = await loadPatchright();
  if (available) {
    console.log(`[FetchHTML] Falling back to browser for ${url}`);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const html = await fetchWithBrowser(url, options);
        if (html && html.trim().length > 100) {
          return { html, usedBrowser: true, url, statusCode };
        }
      } catch (err: any) {
        lastError = err;
        console.error(`[FetchHTML] Browser attempt ${attempt + 1} failed for ${url}:`, err.message);
        if (attempt < maxRetries) {
          await backoffDelay(attempt);
        }
      }
    }
  } else if (fetchHtml) {
    // No patchright available but we have some HTML from node-fetch (even if it's bot-protected)
    console.warn(`[FetchHTML] Returning potentially incomplete HTML for ${url} (patchright not available for fallback)`);
    return { html: fetchHtml, usedBrowser: false, url, statusCode };
  }

  throw lastError || new Error(`Failed to fetch ${url} after all attempts`);
}

// ============================================
// LEGACY COMPATIBILITY FUNCTIONS
// ============================================

/**
 * Get cookies and headers from a URL by visiting it with a browser.
 * Uses per-source persistent context isolation.
 */
export async function getCookiesAndHeaders(
  url: string,
  sourceId: string = 'default'
): Promise<Record<string, string>> {
  const available = await loadPatchright();
  if (!available) {
    // Fall back to basic fetch headers
    console.warn('[PatchrightHelper] patchright not available, returning empty headers');
    return {};
  }

  const context = await BrowserManager.getContext(sourceId);
  const page = await context.newPage();
  let finalHeaders: Record<string, string> = {};

  try {
    page.on('request', (request: any) => {
      if (request.url().includes(new URL(url).hostname)) {
        finalHeaders = request.headers();
      }
    });

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    await page.waitForTimeout(3000);
    return finalHeaders;
  } finally {
    await page.close();
  }
}

/**
 * Get the full rendered HTML of a page using a browser.
 * Uses per-source persistent context isolation.
 */
export async function getPageHTML(
  url: string,
  sourceId: string = 'default'
): Promise<string> {
  const result = await fetchHTML(url, { sourceId });
  return result.html;
}
