// src/helpers/realtorHelper.ts
const { chromium } = require('patchright'); // Using require for patchright
import * as path from 'path'; // For potential path constructions if needed by caller
import * as fs from 'fs';   // For potential directory checks if needed by caller
import type { Page, BrowserContext } from 'playwright-core'; // For type annotations

// Interface for proxyConfig (if not already defined globally)
interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

// Interface for options passed to getRealtorPageWithPatchright
interface PatchrightOptions {
  headless?: boolean;
  debugMode?: boolean; // To control logging and screenshots
  screenshotsPath?: string; // Path to save screenshots
}

// Interface for the return type of getRealtorPageWithPatchright
interface PatchrightResult {
    success: boolean;
    page?: Page; // Playwright Page
    context?: BrowserContext; // Playwright BrowserContext
    error?: string;
    initialNavigationStatus?: number;
    finalUrl?: string;
}

export async function getRealtorPageWithPatchright(
    initialUrl: string,
    userDataDirPath: string, // e.g., path.join(__dirname, 'patchright-user-data')
    options: PatchrightOptions = {},
    proxyConfig?: ProxyConfig 
): Promise<PatchrightResult> {
    console.log(`[PatchrightHelper] Launching browser via Patchright for URL: ${initialUrl}`);
    
    // Ensure screenshots directory exists if debugMode is on and path is provided
    if (options.debugMode && options.screenshotsPath && !fs.existsSync(options.screenshotsPath)) {
      try {
        fs.mkdirSync(options.screenshotsPath, { recursive: true });
        console.log(`[PatchrightHelper] Created screenshots directory: ${options.screenshotsPath}`);
      } catch (e: any) {
        console.error(`[PatchrightHelper] Error creating screenshots directory: ${e.message}`);
      }
    }

    let context: BrowserContext | undefined = undefined;
    let page: Page | undefined = undefined;
    let initialNavigationStatus: number = 0;
    let responseUrl: string = ''; 
    let currentFinalUrl: string = initialUrl; 

    try {
        const launchOptions: any = { 
            channel: "chrome", 
            headless: options.headless ?? false, // Default to headful as recommended by Patchright
            viewport: null, // Recommended by Patchright
        };

        if (proxyConfig && proxyConfig.server) {
            launchOptions.proxy = {
                server: proxyConfig.server,
                username: proxyConfig.username,
                password: proxyConfig.password,
            };
            console.log(`[PatchrightHelper] Using proxy server: ${proxyConfig.server}`);
        }

        console.log(`[PatchrightHelper] Using userDataDirPath: ${userDataDirPath}`);
        console.log(`[PatchrightHelper] Launching with options: ${JSON.stringify(launchOptions)}`);
        
        context = await chromium.launchPersistentContext(userDataDirPath, launchOptions);
        page = await context.newPage();
        currentFinalUrl = page.url(); 

        console.log(`[PatchrightHelper] Navigating to: ${initialUrl} with waitUntil: domcontentloaded`);
        const response = await page.goto(initialUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000 // 60 seconds
        });

        currentFinalUrl = page.url(); 

        if (response) {
            initialNavigationStatus = response.status();
            responseUrl = response.url();
            console.log(`[PatchrightHelper] Initial navigation response status: ${initialNavigationStatus} for response URL: ${responseUrl}`);
            const redirectChain = response.request().redirectChain();
            if (redirectChain.length > 0) {
                console.log(`[PatchrightHelper] Initial navigation redirect chain: ${redirectChain.map(r => `${r.url()} (${r.response()?.status()})`).join(' -> ')} -> ${responseUrl} (${initialNavigationStatus})`);
            }
        } else {
            initialNavigationStatus = -1; 
            console.warn(`[PatchrightHelper] Initial navigation to ${initialUrl} returned a null response object.`);
        }

        // Take screenshot on successful navigation if in debug mode
        if (options.debugMode && options.screenshotsPath && page && (initialNavigationStatus >= 200 && initialNavigationStatus < 400) ) {
            try {
                const screenshotPath = path.join(options.screenshotsPath, `patchright-success-${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`[PatchrightHelper] Success screenshot saved to ${screenshotPath}`);
            } catch (screenshotError: any) {
                console.error(`[PatchrightHelper] Error taking success screenshot: ${screenshotError.message}`);
            }
        }

        return {
            success: initialNavigationStatus >= 200 && initialNavigationStatus < 400,
            page,
            context,
            initialNavigationStatus,
            finalUrl: currentFinalUrl
        };

    } catch (error: any) {
        console.error(`[PatchrightHelper] Error during Patchright operation: ${error.message}`, error.stack);
         if (page && !page.isClosed()) {
            currentFinalUrl = page.url();
             if (options.debugMode && options.screenshotsPath) {
                try {
                    const errorScreenshotPath = path.join(options.screenshotsPath, `patchright-error-${Date.now()}.png`);
                    await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                    console.log(`[PatchrightHelper] Error screenshot saved to ${errorScreenshotPath}`);
                } catch (screenshotError: any) {
                    console.error(`[PatchrightHelper] Error taking error screenshot: ${screenshotError.message}`);
                }
            }
        }
        
        if (context) {
            try {
                await context.close();
                console.log('[PatchrightHelper] Browser context closed due to error.');
            } catch (closeError: any) {
                console.error(`[PatchrightHelper] Error closing context after failure: ${closeError.message}`);
            }
        }
        return {
            success: false,
            error: error.message,
            initialNavigationStatus: initialNavigationStatus !== 0 ? initialNavigationStatus : -1, 
            finalUrl: currentFinalUrl,
            page: undefined, 
            context: undefined 
        };
    }
}

/**
 * Format cookies for use in HTTP requests.
 */
export function formatCookiesForRequest(cookies: { name: string, value: string }[]): string {
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    return '';
  }
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Extract specific important cookies from Realtor.com.
 */
export function extractRealtorCookies(cookies: { name: string, value: string }[]): { name: string, value: string }[] {
  if (!cookies || !Array.isArray(cookies)) return [];
  const importantCookieNames = ['__cf_bm', 'split', 'kampyle_userid', 'AWSALB', 'JSESSIONID', 'SERVERID'];
  const criticalCookies = cookies.filter(cookie => 
    importantCookieNames.includes(cookie.name) || 
    cookie.name.startsWith('ak_bmsc') || 
    cookie.name.startsWith('bm_') ||
    cookie.name.startsWith('_px')
  );
  
  return criticalCookies;
}

// Note: The old debugRealtorAccess function and its Puppeteer-specific imports 
// have been removed by deleting the file and creating this new one.
// Only getRealtorPageWithPatchright and the utility cookie functions are exported.
export { getRealtorPageWithPatchright, formatCookiesForRequest, extractRealtorCookies };
