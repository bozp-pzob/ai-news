import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { newInjectedPage } from 'fingerprint-injector';
import fs from 'fs';
import path from 'path';

// Add the stealth plugin
puppeteer.use(StealthPlugin());

interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

async function debugRealtorAccess(options: any = {}, proxy?: ProxyConfig) { 
    const defaultOptions = {
      headless: true, 
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
      
      const launchArgs = [
          // Essential for some environments, but can be fingerprinting vectors.
          // Evaluate if they can be removed or made conditional for your specific environment.
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', 

          // Core stealth args
          '--disable-blink-features=AutomationControlled', // Primary flag to hide automation
          
          // Common settings for stability & consistency
          '--disable-infobars', // No "Chrome is being controlled" infobar
          '--disable-extensions', // No extensions loaded
          '--disable-popup-blocking', // Allow popups which some sites use for auth flows
          '--no-first-run', // Skip first run wizards
          '--no-zygote', // Helps in some environments
          `--window-size=1920,1080`, // Consistent window size
          
          // Performance & resource management mimics real user behavior better
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',

          // GPU & WebGL - important for modern sites
          // '--disable-gpu', // Keeping this for now with headless:true, but it's a trade-off. 'new' headless might allow removing it.
          '--enable-webgl',
          '--use-gl=desktop', // or 'egl' on Linux without a display server

          // Network stack improvements
          '--enable-features=NetworkService,NetworkServiceInProcess',
          
          // Reduce chattiness
          '--metrics-recording-only',
          '--disable-breakpad', // Disable crash reporter

          // Color profile consistency
          '--force-color-profile=srgb',

          // '--disable-web-security', // Removed: Highly detectable and security risk. Only use if absolutely necessary for specific local testing.
          // '--deterministic-fetch', // Removed: Might be a fingerprint.
          // '--disable-features=IsolateOrigins', // Removed: Prefer default security features.
          // '--disable-site-isolation-trials', // Removed: Prefer default security features.
          // '--disable-features=VizDisplayCompositor', // Removed: Less common override.
      ];

      if (proxy && proxy.server) {
        launchArgs.push(`--proxy-server=${proxy.server}`);
        console.log(`[RealtorHelper] Using proxy server: ${proxy.server}`);
      }
      
      // Launch browser with extensive anti-detection settings
      console.log(`[RealtorHelper] Launching Puppeteer with args: ${JSON.stringify(launchArgs)}`);
      console.log(`[RealtorHelper] Ignoring default args: ['--enable-automation', '--disable-background-networking', '--disable-default-apps', '--disable-sync', '--mute-audio']`);
      browser = await puppeteer.launch({
        headless: mergedOptions.headless, // Consider 'new' for more modern headless if issues arise with 'true'
        userDataDir: mergedOptions.userDataDir,
        args: launchArgs,
        ignoreDefaultArgs: [
          '--enable-automation', // Critical: remove default automation flag
          '--disable-background-networking', // Let Puppeteer control this if needed via other args
          '--disable-default-apps',
          // '--disable-extensions', // Already in args
          '--disable-sync',
          '--mute-audio', // Often good to ignore if not needed
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      });
  
      console.log('[RealtorHelper] Creating injected page...');
      const fingerprintOptions:any = { 
        devices: ['desktop'],
        browsers: [{ name: 'chrome', minVersion: 120 }], 
        operatingSystems: ['windows']
      };
      console.log(`[RealtorHelper] Using fingerprint-injector with options: ${JSON.stringify(fingerprintOptions)}`);
      page = await newInjectedPage(browser, { fingerprintOptions });

      // Authenticate proxy if credentials are provided
      if (proxy && proxy.username && proxy.password && page) {
        await page.authenticate({
          username: proxy.username,
          password: proxy.password,
        });
        console.log('[RealtorHelper] Authenticated with proxy using provided credentials.');
      }

      // Enable request interception
      await page.setRequestInterception(true);
      // Request interception enabled log is already present.
      // Script detection log for ips.js is already present.

      page.on('request', async (request) => {
        try {
          // General script logging
          if (request.resourceType() === 'script') {
            console.log(`[RealtorHelper] Script requested: ${request.url()}`);
            const redirectChain = request.redirectChain();
            if (redirectChain.length > 0) {
                console.log(`[RealtorHelper]   Redirect chain: ${redirectChain.map(r => r.url()).join(' -> ')}`);
            }
          }

          // Specific logging for ips.js (Kasada candidate)
          if (request.resourceType() === 'script' && request.url().toLowerCase().includes('/ips.js')) {
            console.log(`[RealtorHelper] ##### Intercepted Kasada script candidate (ips.js): ${request.url()} #####`);
            const redirectChain = request.redirectChain();
            if (redirectChain.length > 0) {
                console.log(`[RealtorHelper]   ips.js Redirect chain: ${redirectChain.map(r => r.url()).join(' -> ')}`);
            }
          }
        } catch (e) {
          console.error(`[RealtorHelper] Error in request handler for ${request.url()}:`, e);
        } finally {
          if (!request.isInterceptResolutionHandled()) {
            try {
              await request.continue();
            } catch (e:any) {
              console.warn(`[RealtorHelper] Warning: Failed to continue request for ${request.url()}: ${e.message}`);
            }
          }
        }
      });
  
      // Comprehensive evasion techniques
      console.log('[RealtorHelper] Applying JavaScript environment overrides for stealth via evaluateOnNewDocument.');
      await page.evaluateOnNewDocument(() => {
        // Extensive navigator and webdriver evasion
        // == Basic Navigator Spoofing ==
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); // Common value
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 }); // Common value

        // Fake plugins
        Object.defineProperty(navigator, 'plugins', { 
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf' }] },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf' }] },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client', mimeTypes: [{ type: 'application/x-nacl', suffixes: ''},{ type: 'application/x-pnacl', suffixes: ''}]  },
          ],
        });
        // Mimic a real mimeTypes object for each plugin
        try {
          //@ts-ignore
          navigator.plugins.forEach(plugin => {
            //@ts-ignore
            plugin.mimeTypes.forEach(mimeType => {
              //@ts-ignore
              plugin[mimeType.type] = mimeType;
            });
          });
        } catch(e) {
          console.error('[RealtorHelper] Error spoofing plugin mimeTypes:', e);
        }


        // Permissions API
        //@ts-ignore
        if (navigator.permissions) {
          //@ts-ignore
          const originalQuery = navigator.permissions.query;
          //@ts-ignore
          navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') {
              return Promise.resolve({ state: 'granted', onchange: null });
            }
            if (parameters.name === 'geolocation') {
              return Promise.resolve({ state: 'prompt', onchange: null });
            }
            // Add more permissions as needed, or fall back to original for others
            return originalQuery.call(navigator.permissions, parameters);
          };
        }
  
        // == Chrome object Spoofing (already present, ensure consistency) ==
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
            const context:any = getContext.call(this, type, ...args);
            if (type === 'webgl' || type === 'webgl2') {
              if (context) {
                // Spoof WebGL Vendor and Renderer
                const ext = context.getExtension('WEBGL_debug_renderer_info');
                if (ext) {
                  //@ts-ignore
                  Object.defineProperty(context, 'getParameter', {
                    value: (parameter:any) => {
                      if (parameter === ext.UNMASKED_VENDOR_WEBGL) {
                        return 'Google Inc. (Intel)'; // Example
                      }
                      if (parameter === ext.UNMASKED_RENDERER_WEBGL) {
                        return 'Intel Iris OpenGL Engine'; // Example
                      }
                      //@ts-ignore
                      return getContext.call(this, type, ...args).getParameter(parameter);
                    }
                  });
                }
              }
            } else if (type === '2d' && context) {
              // Basic Canvas Fingerprint Spoofing for 2D context
              // Add a tiny, almost invisible modification
              try {
                //@ts-ignore
                const originalToDataURL = this.toDataURL;
                //@ts-ignore
                this.toDataURL = function(...args) {
                  // Draw a small, nearly transparent line
                  context.fillStyle = `rgba(${Math.floor(Math.random()*5)}, ${Math.floor(Math.random()*5)}, ${Math.floor(Math.random()*5)}, 0.01)`;
                  context.fillRect(0, 0, 1, 1); 
                  return originalToDataURL.apply(this, args);
                };
              } catch(e) {
                console.error('[RealtorHelper] Canvas 2D toDataURL spoofing failed:', e);
              }
            }
            return context;
          };
        } catch (e) {
          console.error('[RealtorHelper] WebGL/Canvas context modification failed:', e);
        }
        
        // == Screen Properties Spoofing ==
        try {
            Object.defineProperty(screen, 'width', { get: () => 1920 });
            Object.defineProperty(screen, 'height', { get: () => 1080 });
            Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
            Object.defineProperty(screen, 'availHeight', { get: () => 1040 }); // Assuming taskbar
            Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
            Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
        } catch (e) {
            console.error('[RealtorHelper] Screen properties spoofing failed:', e);
        }

        // == Window outer/inner dimensions ==
        // For headless, outerWidth/Height might be 0. Set them to viewport size.
        try {
            if (window.outerWidth === 0) Object.defineProperty(window, 'outerWidth', { get: () => 1920 });
            if (window.outerHeight === 0) Object.defineProperty(window, 'outerHeight', { get: () => 1080 });
        } catch(e) {
            console.error('[RealtorHelper] Window outer dimensions spoofing failed:', e);
        }


        // == Notification permissions (already present, ensure consistency) ==
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

      // Set minimal, standard HTTP headers for the initial request
      try {
        const minimalHeaders = {
            'Accept': 'application/xml,text/xml,application/xhtml+xml,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.7',
            'User-Agent': await browser.userAgent(), 
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br', 
        };
        await page.setExtraHTTPHeaders(minimalHeaders);
        console.log(`[RealtorHelper] Set minimal extra HTTP headers for initial navigation: ${JSON.stringify(minimalHeaders)}`);
      } catch (headerError:any) {
        console.warn(`[RealtorHelper] Warning: Failed to set extra HTTP headers: ${headerError.message}`);
      }
      
      // Simplified navigation with built-in timeout handling from page.goto
      console.log(`[RealtorHelper] Attempting page.goto for: ${mergedOptions.initialUrl}`);
      const response = await page.goto(mergedOptions.initialUrl, {
        waitUntil: 'networkidle2',
        timeout: mergedOptions.timeout
      });

      // Log response status and redirect chain
      if (response) {
        console.log(`[RealtorHelper] Initial navigation response status: ${response.status()} for URL: ${response.url()}`);
        const redirectChain = response.request().redirectChain();
        if (redirectChain.length > 0) {
            console.log(`[RealtorHelper] Initial navigation redirect chain: ${redirectChain.map(r => `${r.url()} (${r.response()?.status()})`).join(' -> ')} -> ${response.url()} (${response.status()})`);
        } else {
            console.log(`[RealtorHelper] No redirects for initial navigation to ${mergedOptions.initialUrl}. Final URL: ${response.url()} (${response.status()})`);
        }
      } else {
        console.warn(`[RealtorHelper] Initial navigation to ${mergedOptions.initialUrl} returned a null response (possibly failed).`);
      }
      
      console.log(`[RealtorHelper] URL after page.goto() execution: ${page.url()}`);
  
      // Add a small, human-like mouse movement shortly after navigation
      try {
        const randomX = Math.floor(Math.random() * 300) + 50; // Move within a small area (e.g., 50-350)
        const randomY = Math.floor(Math.random() * 300) + 50; // Move within a small area (e.g., 50-350)
        await page.mouse.move(randomX, randomY, { steps: 5 }); // Small number of steps for quick movement
        console.log(`[RealtorHelper] Performed initial mouse movement to (${randomX},${randomY}).`);
      } catch (mouseMoveError:any) {
        console.warn('[RealtorHelper] Minor error during initial mouse movement:', mouseMoveError.message);
      }

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