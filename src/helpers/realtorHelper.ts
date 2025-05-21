import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { newInjectedPage } from 'fingerprint-injector';
import fs from 'fs';
import path from 'path';

// Add the stealth plugin
puppeteer.use(StealthPlugin());

async function debugRealtorAccess(options: any = {}) { // Add 'any' type for options for now
    const defaultOptions = {
      headless: true, // Changed default to true for automation
      userDataDir: path.join(__dirname, 'chrome-profile-realtor'),
      screenshotsPath: path.join(__dirname, 'screenshots'),
      initialUrl: 'https://www.realtor.com/',
      debugMode: true,
      timeout: 90000 // Increased timeout
    };
  
    const mergedOptions = { ...defaultOptions, ...options };
  
    // Ensure screenshots directory exists
    if (mergedOptions.debugMode && !fs.existsSync(mergedOptions.screenshotsPath)) {
      fs.mkdirSync(mergedOptions.screenshotsPath, { recursive: true });
    }
  
    let browser;
    let page;
  
    try {
      console.log('[RealtorHelper] Launching browser with comprehensive settings...');
      
      // Launch browser with extensive anti-detection settings
      browser = await puppeteer.launch({
        headless: mergedOptions.headless,
        userDataDir: mergedOptions.userDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-infobars',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-blink-features=AutomationControlled',
          '--disable-extensions',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--deterministic-fetch',
          '--disable-features=IsolateOrigins',
          '--disable-site-isolation-trials',
          '--disable-features=VizDisplayCompositor',
          `--window-size=1920,1080`,
        ],
        ignoreDefaultArgs: [
          '--enable-automation',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      });
  
      console.log('[RealtorHelper] Creating injected page...');
      page = await newInjectedPage(browser, {
        fingerprintOptions: {
          devices: ['desktop'],
          browsers: [{ name: 'chrome', minVersion: 116 }],
          operatingSystems: ['windows']
        }
      });
  
      // Comprehensive evasion techniques
      await page.evaluateOnNewDocument(() => {
        // Extensive navigator and webdriver evasion
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        // Fake plugins
        Object.defineProperty(navigator, 'plugins', { 
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client' },
          ],
        });
  
        // Chrome object spoofing
        Object.defineProperty(window, 'chrome', {
          value: {
            app: { isInstalled: false },
            runtime: {},
            csi: () => {},
            loadTimes: () => {}
          },
          configurable: true
        });
  
        // Additional WebGL and Canvas fingerprint protection
        try {
          const getContext = HTMLCanvasElement.prototype.getContext;
          //@ts-ignore
          HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            if (type === 'webgl' || type === 'webgl2') {
              // Slightly modify WebGL context to break exact fingerprinting
              const context = getContext.call(this, type, ...args);
              //@ts-ignore
              const getParameter = context.getParameter;
              //@ts-ignore
              context.getParameter = function(parameter) {
                //@ts-ignore
                if (parameter === context.RENDERER || parameter === context.VENDOR) {
                  return 'Modified Renderer';
                }
                return getParameter.call(context, parameter);
              };
              return context;
            }
            return getContext.call(this, type, ...args);
          };
        } catch (e) {
          console.error('[RealtorHelper] WebGL context modification failed:', e);
        }

        // Override Notification permissions
        try {
          //@ts-ignore
          const originalRequestPermission = Notification.requestPermission;
          //@ts-ignore
          Notification.requestPermission = function() {
            return Promise.resolve('granted');
          };
        } catch (e) {
          console.error('[RealtorHelper] Notification.requestPermission override failed:', e);
        }

        // Patch performance.getEntries to filter out puppeteer-related entries
        try {
          const originalGetEntries = performance.getEntries;
          performance.getEntries = function(...args) {
            //@ts-ignore
            const entries = originalGetEntries.apply(this, args);
            return entries.filter(entry => !entry.name.includes('puppeteer'));
          };
        } catch (e) {
          console.error('[RealtorHelper] performance.getEntries override failed:', e);
        }
      });

      // Dismiss dialogs automatically
      page.on('dialog', async dialog => {
        console.log(`[RealtorHelper] Dismissing dialog: ${dialog.message()}`);
        await dialog.dismiss();
      });
  
      // Extensive logging for network requests (optional, can be noisy)
      if (mergedOptions.debugMode) {
        await page.on('request', (request) => {
          console.log(`[RealtorHelper] > ${request.method()} ${request.url()}`);
        });
    
        await page.on('response', async (response) => {
          try {
            const status = response.status();
            if (status !== 200 && status !== 304) { // Log non-200/304 responses
              console.log(`[RealtorHelper] < ${status} ${response.url()}`);
            }
          } catch (e) {
            console.error('[RealtorHelper] Error logging response:', e);
          }
        });
      }
  
      // Enhanced error handling for navigation
      console.log(`[RealtorHelper] Navigating to: ${mergedOptions.initialUrl}`);
      
      // Simplified navigation with built-in timeout handling from page.goto
      await page.goto(mergedOptions.initialUrl, {
        waitUntil: 'networkidle2',
        timeout: mergedOptions.timeout
      });
  
      // Check page content after navigation
      const pageContent = await page.content();
      
      // Take screenshots for debugging
      if (mergedOptions.debugMode) {
        await page.screenshot({
          path: path.join(mergedOptions.screenshotsPath, `homepage-${Date.now()}.png`),
          fullPage: true
        });
  
        // Save page content for inspection
        fs.writeFileSync(
          path.join(mergedOptions.screenshotsPath, `page-content-${Date.now()}.html`), 
          pageContent
        );
      }
  
      // Detailed page analysis
      const pageAnalysis = await page.evaluate(() => ({
        title: document.title,
        hostname: window.location.hostname,
        href: window.location.href,
        hasContent: document.body.innerHTML.length > 0,
        containsRealtor: document.body.innerHTML.includes('realtor.com')
      }));
  
      console.log('[RealtorHelper] Page Analysis:', JSON.stringify(pageAnalysis, null, 2));
  
      return {
        success: true,
        page,
        browser,
        pageContent,
        pageAnalysis
      };
  
    } catch (error) {
      console.error(`[RealtorHelper] Error during navigation to ${mergedOptions.initialUrl}:`, error);
  
      // Take error screenshot if possible
      if (page && mergedOptions.debugMode) {
        try {
          await page.screenshot({
            path: path.join(mergedOptions.screenshotsPath, `error-debugRealtorAccess-${Date.now()}.png`),
            fullPage: true
          });
          console.log(`[RealtorHelper] Error screenshot saved to ${mergedOptions.screenshotsPath}`);
        } catch (screenshotError) {
          console.error('[RealtorHelper] Error taking error screenshot:', screenshotError);
        }
      }
  
      // Close browser if it's still open
      if (browser) {
        try {
          await browser.close();
          console.log('[RealtorHelper] Browser closed due to error.');
        } catch (closeError) {
          console.error('[RealtorHelper] Error closing browser after an error:', closeError);
        }
      }
  
      throw error; // Re-throw the error to be handled by the caller
    }
} // End of debugRealtorAccess

/**
 * Format cookies for use in HTTP requests.
 * This function is kept as it's exported and used by RSSSource.ts.
 */
function formatCookiesForRequest(cookies:any) {
  if (!cookies || cookies.length === 0) {
    return '';
  }
  return cookies.map((cookie:any) => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Extract specific important cookies from Realtor.com.
 * This function is kept as it's exported and might be useful for callers,
 * though not directly used by debugRealtorAccess.
 */
function extractRealtorCookies(cookies:any) {
  if (!cookies) return [];
  // Focus on the critical cookies for Realtor.com
  const importantCookies = ['__cf_bm', 'split', 'kampyle_userid', 'AWSALB', 'JSESSIONID', 'SERVERID'];
  const criticalCookies = cookies.filter((cookie:any) => 
    importantCookies.includes(cookie.name) || 
    cookie.name.startsWith('ak_bmsc') || 
    cookie.name.startsWith('bm_') ||
    cookie.name.startsWith('_px')
  );
  
  return criticalCookies;
}

// All versions of bypassRealtorProtection and its specific helpers 
// (naturalMouseMovements, naturalScrolling, handlePossibleCaptcha, checkIfBlocked, manageCookies)
// are removed as per the subtask instructions.

export {
  // bypassRealtorProtection, // Removed from exports
  formatCookiesForRequest,
  extractRealtorCookies,
  debugRealtorAccess
};