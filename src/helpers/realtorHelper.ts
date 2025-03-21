import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { newInjectedPage } from 'fingerprint-injector';
import fs from 'fs';
import path from 'path';

// Add the stealth plugin
puppeteer.use(StealthPlugin());

async function debugRealtorAccess(options = {}) {
    const defaultOptions = {
      headless: false,
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
      console.log('Launching browser with comprehensive settings...');
      
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
  
      console.log('Creating injected page...');
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
          get: () => {
            const fakePlugins = [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
              { name: 'Native Client', filename: 'internal-nacl-plugin' }
            ];
            return fakePlugins;
          }
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
          console.log('WebGL context modification failed');
        }
      });
  
      // Extensive logging for network requests
      await page.on('request', (request) => {
        console.log(`> ${request.method()} ${request.url()}`);
      });
  
      await page.on('response', async (response) => {
        try {
          const status = response.status();
          if (status !== 200) {
            console.log(`< ${status} ${response.url()}`);
          }
        } catch (e) {
          console.log('Error logging response');
        }
      });
  
      // Enhanced error handling for navigation
      console.log(`Navigating to: ${mergedOptions.initialUrl}`);
      
      const navigationPromise = page.goto(mergedOptions.initialUrl, {
        waitUntil: 'networkidle2',
        timeout: mergedOptions.timeout
      });
  
      // Set up a timeout handler
      const timeoutHandler = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Navigation timeout'));
        }, mergedOptions.timeout);
      });
  
      // Race the navigation against the timeout
      await Promise.race([
        navigationPromise,
        timeoutHandler
      ]);
  
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
  
      console.log('Page Analysis:', JSON.stringify(pageAnalysis, null, 2));
  
      return {
        success: true,
        page,
        browser,
        pageContent,
        pageAnalysis
      };
  
    } catch (error) {
      console.error('Full navigation error:', error);
  
      // Take error screenshot if possible
      if (page && mergedOptions.debugMode) {
        try {
          await page.screenshot({
            path: path.join(mergedOptions.screenshotsPath, `error-${Date.now()}.png`),
            fullPage: true
          });
        } catch (screenshotError) {
          console.error('Error taking error screenshot:', screenshotError);
        }
      }
  
      // Close browser if it's still open
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error('Error closing browser:', closeError);
        }
      }
  
      throw error;
    }
}
/**
 * Specialized function to bypass Realtor.com's Kasada protection
 */
// async function bypassRealtorProtection(options = {}) {
//   const defaultOptions = {
//     headless: false, // Always use headed mode for Realtor.com
//     userDataDir: path.join(__dirname, 'chrome-profile-realtor'),
//     cookiesPath: path.join(__dirname, 'cookies', 'realtor-cookies.json'),
//     screenshots: true,
//     screenshotsPath: path.join(__dirname, 'screenshots'),
//     debugMode: true,
//     initialUrl: 'https://www.realtor.com/', // Start with homepage
//     targetUrl: 'https://www.realtor.com/realestateandhomes-search/Dallas_TX', // Can be customized
//     loginDelayMs: 45000, // Higher delay for Realtor.com's protection
//     randomizeViewport: true,
//     solveManually: true // Allow manual solving of captchas
//   };

//   const mergedOptions = { ...defaultOptions, ...options };
//   const { debugMode } = mergedOptions;
  
//   // Create necessary directories
//   if (!fs.existsSync(path.dirname(mergedOptions.cookiesPath))) {
//     fs.mkdirSync(path.dirname(mergedOptions.cookiesPath), { recursive: true });
//   }
//   if (mergedOptions.screenshots && !fs.existsSync(mergedOptions.screenshotsPath)) {
//     fs.mkdirSync(mergedOptions.screenshotsPath, { recursive: true });
//   }

//   debugMode && console.log('Launching browser...');
  
//   // Choose a random viewport size to appear more human-like
//   let viewportWidth = 1920;
//   let viewportHeight = 1080;
  
//   if (mergedOptions.randomizeViewport) {
//     const viewportSizes = [
//       { width: 1366, height: 768 },
//       { width: 1440, height: 900 },
//       { width: 1536, height: 864 },
//       { width: 1680, height: 1050 },
//       { width: 1920, height: 1080 },
//       { width: 2048, height: 1152 },
//       { width: 2560, height: 1440 }
//     ];
//     const randomViewport = viewportSizes[Math.floor(Math.random() * viewportSizes.length)];
//     viewportWidth = randomViewport.width;
//     viewportHeight = randomViewport.height;
//   }
  
//   // Launch browser with enhanced settings for Realtor.com
//   const browser = await puppeteer.launch({
//     headless: mergedOptions.headless,
//     userDataDir: mergedOptions.userDataDir,
//     args: [
//       '--no-sandbox',
//       '--disable-setuid-sandbox',
//       '--disable-infobars',
//       `--window-size=${viewportWidth},${viewportHeight}`,
//       '--disable-dev-shm-usage',
//       '--no-proxy-server',
//       '--disable-blink-features=AutomationControlled',
//       '--disable-features=IsolateOrigins,site-per-process', // Helps with some iframes
//       '--disable-web-security', // May help with CORS issues
//       '--disable-site-isolation-trials'
//     ],
//     ignoreDefaultArgs: ['--enable-automation'],
//     defaultViewport: null
//   });

//   let page;
  
//   try {
//     // Create a new specially fingerprinted page
//     debugMode && console.log('Setting up fingerprinted page...');
//     page = await newInjectedPage(browser, {
//       fingerprintOptions: {
//         devices: ['desktop'],
//         browsers: [{ name: 'chrome', minVersion: 116 }], // Use newer Chrome version
//         operatingSystems: ['windows'],
//       }
//     });
    
//     // Handle dialog boxes (sometimes Realtor.com uses these to detect bots)
//     page.on('dialog', async dialog => {
//       debugMode && console.log(`Dialog appeared: ${dialog.message()}`);
//       await dialog.dismiss();
//     });
    
//     // Apply additional patches specific to Realtor.com
//     await page.evaluateOnNewDocument(() => {
//       // Override specific navigator properties Realtor.com might check
//       Object.defineProperty(navigator, 'webdriver', { get: () => false });
//       Object.defineProperty(navigator, 'plugins', { 
//         get: () => {
//           // Create fake plugins array
//           const plugins = [];
//           for (let i = 0; i < 3; i++) {
//             plugins.push({
//               name: ['Chrome PDF Plugin', 'Chrome PDF Viewer', 'Native Client'][i],
//               filename: ['internal-pdf-viewer', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', 'internal-nacl-plugin'][i],
//               description: ['Portable Document Format', 'Portable Document Format', ''][i],
//               length: 0
//             });
//           }
//           return plugins;
//         }
//       });
      
//       // Override Chrome object - sometimes Realtor/Kasada checks this
//       Object.defineProperty(window, 'chrome', {
//         value: {
//           app: {
//             isInstalled: false,
//             getDetails: () => {},
//             getIsInstalled: () => {},
//             runningState: () => {}
//           },
//           csi: () => {},
//           loadTimes: () => {},
//           runtime: {}
//         },
//         writable: true,
//         configurable: true
//       });
      
//       // Add screen properties that realtor.com might check
//       if (!window.screen.orientation) {
//         Object.defineProperty(window.screen, 'orientation', {
//           value: {
//             angle: 0,
//             type: 'landscape-primary',
//             onchange: null
//           },
//           configurable: true
//         });
//       }
      
//       // Override document permissions
//       const originalRequestPermission = Notification.requestPermission;
//       Notification.requestPermission = function() {
//         return Promise.resolve('granted');
//       };
      
//       // Protect against Kasada's MouseEvent and TouchEvent checking
//       try {
//         const originalMouseEvent = window.MouseEvent;
//         // TypeScript safe version - using any to bypass type checking
//         (window as any).MouseEvent = originalMouseEvent;
        
//         if (typeof window.TouchEvent === 'function') {
//           const originalTouchEvent = window.TouchEvent;
//           // TypeScript safe version - using any to bypass type checking
//           (window as any).TouchEvent = originalTouchEvent;
//         }
//       } catch (e) {
//         // Silently fail if we cannot override
//         console.log('Could not override event constructors');
//       }
      
//       // Handle Realtor.com's sessionStorage monitoring
//       const originalSetItem = window.sessionStorage.setItem;
//       window.sessionStorage.setItem = function(key, value) {
//         // Allow normal session storage operations while appearing normal
//         return originalSetItem.call(window.sessionStorage, key, value);
//       };
      
//       // Patch for performance API checks that Kasada might use
//       const originalGetEntries = window.performance.getEntries;
//       window.performance.getEntries = function() {
//         const entries = originalGetEntries.call(window.performance);
//         // Filter out entries that might reveal automation
//         return entries.filter(entry => !entry.name.includes('puppeteer'));
//       };
//     });
    
//     // Try to load existing cookies
//     try {
//       if (fs.existsSync(mergedOptions.cookiesPath)) {
//         debugMode && console.log('Loading existing cookies...');
//         const cookiesString = fs.readFileSync(mergedOptions.cookiesPath, 'utf8');
//         const cookies = JSON.parse(cookiesString);
//         await page.setCookie(...cookies);
//       }
//     } catch (cookieError) {
//       debugMode && console.error('Error loading cookies:', cookieError);
//     }
    
//     // First navigate to the homepage (less protection usually)
//     debugMode && console.log(`Navigating to homepage first: ${mergedOptions.initialUrl}`);
//     await page.goto(mergedOptions.initialUrl, { 
//       waitUntil: 'networkidle2',
//       timeout: 60000 
//     });
    
//     // Take screenshot
//     if (mergedOptions.screenshots) {
//       await page.screenshot({ 
//         path: path.join(mergedOptions.screenshotsPath, `homepage-${Date.now()}.png`),
//         fullPage: false 
//       });
//     }
    
//     // Perform natural interactions to appear human-like
//     debugMode && console.log('Performing human-like interactions on homepage...');
    
//     // Wait a random time before interactions
//     await new Promise(resolve => setTimeout(resolve, 2000 + Math.floor(Math.random() * 3000)));
    
//     // Move mouse around naturally
//     await naturalMouseMovements(page, 5);
    
//     // Random scroll behavior on homepage
//     await naturalScrolling(page);
    
//     // Check for and handle any captchas or challenges
//     await handlePossibleCaptcha(page, mergedOptions);
    
//     // Now navigate to the target URL
//     debugMode && console.log(`Navigating to target page: ${mergedOptions.targetUrl}`);
//     await page.goto(mergedOptions.targetUrl, { 
//       waitUntil: 'networkidle2',
//       timeout: 60000 
//     });
    
//     // Take screenshot of target page
//     if (mergedOptions.screenshots) {
//       await page.screenshot({ 
//         path: path.join(mergedOptions.screenshotsPath, `target-page-${Date.now()}.png`),
//         fullPage: false 
//       });
//     }
    
//     // More natural interactions on target page
//     await naturalMouseMovements(page, 3);
//     await naturalScrolling(page);
    
//     // Check for any remaining challenges
//     await handlePossibleCaptcha(page, mergedOptions);
    
//     // Wait for Kasada to finish authentication
//     debugMode && console.log(`Waiting ${mergedOptions.loginDelayMs}ms for authentication to complete...`);
//     await new Promise(resolve => setTimeout(resolve, mergedOptions.loginDelayMs));
    
//     // Check if we're still being blocked
//     const isBlocked = await checkIfBlocked(page);
//     if (isBlocked) {
//       if (mergedOptions.solveManually) {
//         debugMode && console.log('Still blocked. Please solve any challenges manually in the browser window...');
        
//         // Take screenshot of the blocked page
//         if (mergedOptions.screenshots) {
//           await page.screenshot({ 
//             path: path.join(mergedOptions.screenshotsPath, `blocked-page-${Date.now()}.png`),
//             fullPage: true 
//           });
//         }
        
//         // Wait for manual intervention
//         debugMode && console.log('Waiting for manual intervention (60 seconds)...');
//         await new Promise(resolve => setTimeout(resolve, 60000));
//       } else {
//         throw new Error('Page is still blocked by Kasada protection');
//       }
//     }
    
//     // Get cookies after all operations
//     debugMode && console.log('Getting cookies...');
//     const cookies = await page.cookies();
    
//     // Save cookies to file
//     fs.writeFileSync(mergedOptions.cookiesPath, JSON.stringify(cookies, null, 2));
    
//     debugMode && console.log(`Successfully retrieved ${cookies.length} cookies`);
    
//     // Take final screenshot
//     if (mergedOptions.screenshots) {
//       await page.screenshot({ 
//         path: path.join(mergedOptions.screenshotsPath, `final-state-${Date.now()}.png`),
//         fullPage: false 
//       });
//     }
    
//     return { 
//       cookies,
//       success: !isBlocked,
//       page, // Return the page for further operations if needed
//       browser // Return the browser for cleanup
//     };
    
//   } catch (error) {
//     console.error('Error bypassing Realtor.com protection:', error);
    
//     // Try to take a screenshot of the error state
//     if (page && mergedOptions.screenshots) {
//       try {
//         await page.screenshot({ 
//           path: path.join(mergedOptions.screenshotsPath, `error-${Date.now()}.png`),
//           fullPage: true 
//         });
//       } catch (screenshotError) {
//         console.error('Error taking error screenshot:', screenshotError);
//       }
//     }
    
//     // Don't close the browser on error - allow for debugging
//     return { 
//       error,
//       success: false, 
//       page,
//       browser
//     };
//   }
// }

// Helper function for natural mouse movements
async function naturalMouseMovements(page:any, movementCount = 5) {
  const maxX = await page.evaluate(() => window.innerWidth);
  const maxY = await page.evaluate(() => window.innerHeight);
  
  // Add variety to movement patterns - sometimes move to specific elements
  const elements = await page.$$('a, button, input, select, .card, .listing-card, [role="button"]');
  
  for (let i = 0; i < movementCount; i++) {
    if (elements.length > 0 && Math.random() > 0.6) {
      // Move to a random element 40% of the time
      const randomElementIndex = Math.floor(Math.random() * elements.length);
      try {
        await elements[randomElementIndex].hover({ steps: 10 + Math.floor(Math.random() * 20) });
      } catch (e) {
        // If element isn't hovereable, fall back to random position
        const x = 100 + Math.floor(Math.random() * (maxX - 200));
        const y = 100 + Math.floor(Math.random() * (maxY - 200));
        await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
      }
    } else {
      // Move to a random position
      const x = 100 + Math.floor(Math.random() * (maxX - 200));
      const y = 100 + Math.floor(Math.random() * (maxY - 200));
      await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
    }
    
    // Add occasional pauses
    await new Promise(resolve => setTimeout(resolve, 300 + Math.floor(Math.random() * 1000)));
    
    // Occasionally click on a listing or navigation element
    if (Math.random() > 0.85 && elements.length > 0) {
      try {
        const clickableElements = await page.$$('a.card, .listing-item, [data-testid="result-card"], .header-navigation a');
        if (clickableElements.length > 0) {
          const randomElement = clickableElements[Math.floor(Math.random() * clickableElements.length)];
          await randomElement.click();
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.floor(Math.random() * 3000)));
          await page.goBack();
          await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 2000)));
        }
      } catch (e:any) {
        // Ignore click errors
        console.log('Click interaction error (non-critical):', e.message);
      }
    }
  }
}

// Helper function for natural scrolling
async function naturalScrolling(page:any) {
  // Get page height
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  
  // Calculate reasonable scroll chunks - don't divide evenly
  const scrollChunks = Math.ceil(scrollHeight / viewportHeight) + 1;
  
  // Use smooth scrolling with variable speeds and pauses
  for (let i = 0; i < scrollChunks; i++) {
    // Calculate a random scroll amount
    const scrollAmount = viewportHeight * (0.7 + Math.random() * 0.5);
    
    await page.evaluate((scrollAmt:any) => {
      window.scrollBy({
        top: scrollAmt,
        behavior: 'smooth'
      });
    }, scrollAmount);
    
    // Variable pauses between scrolls
    const pauseTime = 800 + Math.floor(Math.random() * 2200);
    await new Promise(resolve => setTimeout(resolve, pauseTime));
    
    // Occasionally scroll back up a bit
    if (Math.random() > 0.8) {
      const backScrollAmount = -1 * (viewportHeight * (0.1 + Math.random() * 0.3));
      await page.evaluate((scrollAmt:any) => {
        window.scrollBy({
          top: scrollAmt,
          behavior: 'smooth'
        });
      }, backScrollAmount);
      
      await new Promise(resolve => setTimeout(resolve, 500 + Math.floor(Math.random() * 1000)));
    }
  }
  
  // Scroll back to a random position
  const randomPosition = Math.floor(Math.random() * (scrollHeight - viewportHeight));
  await page.evaluate((position:any) => {
    window.scrollTo({
      top: position,
      behavior: 'smooth'
    });
  }, randomPosition);
  
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 2000)));
}

// Helper function to check for captchas or challenges
async function handlePossibleCaptcha(page:any, options:any) {
  // Look for common captcha and challenge elements
  const hasChallenge = await page.evaluate(() => {
    // Check for various indicators
    const hasRecaptcha = document.querySelector('iframe[src*="recaptcha"]') !== null;
    const hasKasada = document.querySelector('div[id*="ka-"]') !== null || document.querySelector('iframe[src*="kasada"]') !== null;
    const hasBlockPage = document.querySelector('div.content.unblock') !== null || 
        document.querySelector('h1') !== null && document.body.innerText.includes('Access Denied');
    
    const hasCloudFlare = document.querySelector('#cf-wrapper') !== null || 
        document.querySelector('.cf-error-code') !== null || 
        document.querySelector('iframe[src*="cloudflare"]') !== null;
    
    return hasRecaptcha || hasKasada || hasBlockPage || hasCloudFlare;
  });
  
  if (hasChallenge) {
    // Take a screenshot of the challenge
    if (options.screenshots) {
      await page.screenshot({ 
        path: path.join(options.screenshotsPath, `challenge-${Date.now()}.png`),
        fullPage: true 
      });
    }
    
    if (options.solveManually) {
      // Wait for manual intervention
      options.debugMode && console.log('Challenge detected. Please solve it manually in the browser window...');
      await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for manual solving
    } else {
      options.debugMode && console.log('Challenge detected but automatic solving is disabled');
    }
  }
}

// Helper function to check if we're still blocked
async function checkIfBlocked(page:any) {
  return await page.evaluate(() => {
    // Check for various block indicators
    const blockTexts = [
      'access denied',
      'your request could not be processed',
      'please contact unblockrequest@realtor.com',
      'we need to verify you are a real person',
      'please enable cookies',
      'access to this page has been denied',
      'if you are a human'
    ];
    
    const pageText = document.body.innerText.toLowerCase();
    return blockTexts.some(text => pageText.includes(text));
  });
}

/**
 * Format cookies for use in HTTP requests
 */
function formatCookiesForRequest(cookies:any) {
  return cookies.map((cookie:any) => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Extract specific important cookies from Realtor.com
 */
function extractRealtorCookies(cookies:any) {
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

/**
 * Enhanced function to bypass Realtor.com's Kasada protection
 */
async function bypassRealtorProtection(options = {}) {
    const defaultOptions = {
      headless: false,
      userDataDir: path.join(__dirname, 'chrome-profile-realtor'),
      cookiesPath: path.join(__dirname, 'cookies', 'realtor-cookies.json'),
      screenshots: true,
      screenshotsPath: path.join(__dirname, 'screenshots'),
      debugMode: true,
      initialUrl: 'https://www.realtor.com/',
      targetUrl: 'https://www.realtor.com/realestateandhomes-search/Dallas_TX',
      loginDelayMs: 60000, // Increased delay
      randomizeViewport: true,
      solveManually: true,
      bypassAttempts: 3 // Number of bypass attempts
    };
  
    const mergedOptions = { ...defaultOptions, ...options };
    const { debugMode } = mergedOptions;
  
    // Create necessary directories
    if (!fs.existsSync(path.dirname(mergedOptions.cookiesPath))) {
      fs.mkdirSync(path.dirname(mergedOptions.cookiesPath), { recursive: true });
    }
    if (mergedOptions.screenshots && !fs.existsSync(mergedOptions.screenshotsPath)) {
      fs.mkdirSync(mergedOptions.screenshotsPath, { recursive: true });
    }
  
    // Enhanced cookie management
    async function manageCookies(page:any) {
      try {
        // Try to load existing cookies
        if (fs.existsSync(mergedOptions.cookiesPath)) {
          debugMode && console.log('Loading existing cookies...');
          const cookiesString = fs.readFileSync(mergedOptions.cookiesPath, 'utf8');
          const cookies = JSON.parse(cookiesString);
          
          // Filter out expired cookies
          const validCookies = cookies.filter((cookie:any) => 
            !cookie.expires || (cookie.expires > Date.now() / 1000)
          );
  
          if (validCookies.length > 0) {
            await page.setCookie(...validCookies);
            debugMode && console.log(`Loaded ${validCookies.length} valid cookies`);
          }
        }
      } catch (cookieError) {
        debugMode && console.error('Error managing cookies:', cookieError);
      }
    }
  
    // More comprehensive block detection
    async function checkIfBlocked(page:any) {
      return await page.evaluate(() => {
        const blockIndicators = [
          'access denied',
          'challenge required',
          'bot detection',
          'human verification',
          'our systems have detected',
          'please verify you are human',
          'kasada',
          'cloudflare'
        ];
  
        const pageText = document.body.innerText.toLowerCase();
        const pageHtml = document.body.innerHTML.toLowerCase();
  
        return blockIndicators.some(indicator => 
          pageText.includes(indicator) || pageHtml.includes(indicator)
        );
      });
    }
  
    // Enhanced bypass attempts
    for (let attempt = 0; attempt < mergedOptions.bypassAttempts; attempt++) {
      debugMode && console.log(`Bypass Attempt ${attempt + 1}`);
  
      let browser;
      let page;
  
      try {
        // Launch browser with enhanced settings
        browser = await puppeteer.launch({
          headless: mergedOptions.headless,
          userDataDir: mergedOptions.userDataDir,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security'
          ],
          ignoreDefaultArgs: ['--enable-automation']
        });
  
        // Create a new page with enhanced fingerprinting
        page = await newInjectedPage(browser, {
          fingerprintOptions: {
            devices: ['desktop'],
            browsers: [{ name: 'chrome', minVersion: 116 }],
            operatingSystems: ['windows']
          }
        });
  
        // Add comprehensive evasion techniques
        await page.evaluateOnNewDocument(() => {
          // Comprehensive webdriver, navigator, and automation detection evasion
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'plugins', { 
            get: () => [
              { name: 'Chrome PDF Plugin' },
              { name: 'Chrome PDF Viewer' },
              { name: 'Native Client' }
            ]
          });
  
          // Override specific browser fingerprinting techniques
          Object.defineProperty(window, 'chrome', {
            value: {
              app: { isInstalled: false },
              runtime: {},
              csi: () => {},
              loadTimes: () => {}
            },
            configurable: true
          });
        });
  
        // Manage existing cookies
        await manageCookies(page);
  
        // Navigate to initial and target pages
        debugMode && console.log(`Navigating to initial URL: ${mergedOptions.initialUrl}`);
        await page.goto(mergedOptions.initialUrl, { 
          waitUntil: 'networkidle2',
          timeout: 60000 
        });
  
        // Perform natural interactions
        await naturalMouseMovements(page, 3);
        await naturalScrolling(page);
  
        // Navigate to target page
        debugMode && console.log(`Navigating to target URL: ${mergedOptions.targetUrl}`);
        await page.goto(mergedOptions.targetUrl, { 
          waitUntil: 'networkidle2',
          timeout: 60000 
        });
  
        // Check if blocked
        const isBlocked = await checkIfBlocked(page);
        
        if (isBlocked) {
          debugMode && console.log('Page is blocked. Taking screenshot and continuing...');
          
          // Take screenshot of blocked page
          if (mergedOptions.screenshots) {
            await page.screenshot({ 
              path: path.join(mergedOptions.screenshotsPath, `blocked-${attempt}-${Date.now()}.png`),
              fullPage: true 
            });
          }
  
          // If manual solving is enabled, pause for intervention
          if (mergedOptions.solveManually) {
            debugMode && console.log('Waiting for manual intervention...');
            await new Promise(resolve => setTimeout(resolve, 60000));
          }
  
          continue; // Try next attempt
        }
  
        // If not blocked, save cookies and return success
        const cookies = await page.cookies();
        fs.writeFileSync(mergedOptions.cookiesPath, JSON.stringify(cookies, null, 2));
  
        debugMode && console.log(`Successfully retrieved ${cookies.length} cookies`);
  
        return { 
          cookies,
          success: true,
          page, 
          browser 
        };
  
      } catch (error) {
        debugMode && console.error(`Bypass attempt ${attempt + 1} failed:`, error);
        
        // Take error screenshot if possible
        if (page && mergedOptions.screenshots) {
          try {
            await page.screenshot({ 
              path: path.join(mergedOptions.screenshotsPath, `error-${attempt}-${Date.now()}.png`),
              fullPage: true 
            });
          } catch (screenshotError) {
            console.error('Error taking error screenshot:', screenshotError);
          }
        }
  
        // Close browser if it's still open
        if (browser) {
          try {
            await browser.close();
          } catch (closeError) {
            console.error('Error closing browser:', closeError);
          }
        }
      }
    }
  
    // If all attempts fail
    throw new Error('Failed to bypass Realtor.com protection after multiple attempts');
  }
  

export {
  bypassRealtorProtection,
  formatCookiesForRequest,
  extractRealtorCookies,
  debugRealtorAccess
};