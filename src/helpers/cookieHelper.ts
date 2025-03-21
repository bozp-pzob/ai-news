// Helper to adapt cookies from any source to our generic format
const adaptCookies = (cookies: any[]): GenericCookie[] => {
    return cookies.map(cookie => cookie as GenericCookie);
  };
  
  // Helper to convert cookies to a format suitable for setCookie
  const convertCookieFormat = (cookies: GenericCookie[]): any[] => {
    return cookies.map(cookie => {
      // Create a new object with only the properties that setCookie expects
      const { partitionKey, sourcePort, ...cookieWithoutProblematicProps } = cookie;
      return cookieWithoutProblematicProps;
    });
  };import puppeteer from 'puppeteer-extra';
  import StealthPlugin from 'puppeteer-extra-plugin-stealth';
  import { newInjectedPage } from 'fingerprint-injector';
  import randomUseragent from 'random-useragent';
  import fs from 'fs';
  import path from 'path';
  import { Protocol } from 'puppeteer-core';
  
  // Add the stealth plugin
  puppeteer.use(StealthPlugin());
  
  // Configuration types
  interface ScraperConfig {
    useRandomUserAgent: boolean;
    useProxy: boolean;
    proxyUrl: string;
    minDelay: number;
    maxDelay: number;
    saveCookies: boolean;
    cookiesDir: string;
    takeScreenshots: boolean;
    screenshotPath: string;
  }
  
  interface ScraperOptions extends Partial<ScraperConfig> {}
  
  interface ExtractedData {
    [key: string]: any;
  }
  
  interface CookiesWithDataResult {
    cookies: GenericCookie[];
    data: ExtractedData | null;
  }
  
  // Default configuration options
  const config: ScraperConfig = {
    // Rotate user agents regularly
    useRandomUserAgent: true,
    // Proxy settings - disabled by default
    useProxy: false,
    proxyUrl: '',
    // Delay between actions (milliseconds)
    minDelay: 500,
    maxDelay: 3000,
    // Cookie persistence
    saveCookies: true,
    cookiesDir: path.join(__dirname, 'cookies'),
    // Screenshots for debugging
    takeScreenshots: true,
    screenshotPath: path.join(__dirname, 'screenshots'),
  };
  
  // Helper function for random delays to mimic human behavior
  const randomDelay = async (min: number = config.minDelay, max: number = config.maxDelay): Promise<void> => {
    const delay = Math.floor(Math.random() * (max - min) + min);
    await new Promise(resolve => setTimeout(resolve, delay));
  };
  
  // Helper for human-like mouse movements
  const humanMouseMovement = async (page: any): Promise<void> => {
    const { width, height } = await page.evaluate(() => {
      return {
        width: window.innerWidth,
        height: window.innerHeight
      };
    });
  
    // Generate a random path with bezier curves to simulate natural movement
    const points: { x: number; y: number }[] = [];
    const numPoints = Math.floor(Math.random() * 5) + 3;
    
    for (let i = 0; i < numPoints; i++) {
      points.push({
        x: Math.floor(Math.random() * width),
        y: Math.floor(Math.random() * height)
      });
    }
  
    // Move through points with random timing
    for (const point of points) {
      await page.mouse.move(point.x, point.y, { steps: Math.floor(Math.random() * 10) + 5 });
      await randomDelay(50, 200);
    }
  };
  
  // Helper to save cookies
  const saveCookiesToFile = async (url: string, cookies: GenericCookie[]): Promise<string | undefined> => {
    if (!config.saveCookies) return;
    
    if (!fs.existsSync(config.cookiesDir)) {
      fs.mkdirSync(config.cookiesDir, { recursive: true });
    }
    
    // Create a filename based on the domain
    const domain = new URL(url).hostname;
    const cookiePath = path.join(config.cookiesDir, `${domain}-cookies.json`);
    
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    return cookiePath;
  };
  
  // Helper to load cookies
  const loadCookiesFromFile = (url: string): GenericCookie[] => {
    if (!config.saveCookies) return [];
    
    // Get the domain from URL
    const domain = new URL(url).hostname;
    const cookiePath = path.join(config.cookiesDir, `${domain}-cookies.json`);
    
    if (!fs.existsSync(cookiePath)) return [];
    
    try {
      return JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
    } catch (error) {
      console.error('Error loading cookies:', error);
      return [];
    }
  };
  
  // Define a type that handles both cookie types
  type GenericCookie = {
    name?: string;
    value?: string;
    domain?: string;
    path?: string;
    expires?: number;
    size?: number;
    httpOnly?: boolean;
    secure?: boolean;
    session?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    priority?: "Low" | "Medium" | "High";
    sameParty?: boolean;
    sourceScheme?: string;  // Changed to string to accept any value
    partitionKey?: any;
    sourcePort?: any;
    [key: string]: any;
  };
  
  /**
   * Main function to get cookies from a website
   * @param url - The URL to visit and get cookies from
   * @param options - Optional configuration to override defaults
   * @returns - Array of cookie objects
   */
  async function getCookies(
    url: string, 
    options: ScraperOptions = {}
  ): Promise<GenericCookie[]> {
    console.log(`Getting cookies for ${url}...`);
    
    // Merge default config with provided options
    const mergedConfig: ScraperConfig = { ...config, ...options };
    
    // Launch browser with enhanced stealth settings
    const browser = await puppeteer.launch({
      headless: false, // Set to true for production, false for debugging
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--disable-dev-shm-usage',
        '--no-proxy-server', // Explicitly disable proxy
      ],
      ignoreDefaultArgs: false,
      defaultViewport: {
        width: 1920,
        height: 1080,
      }
    });
  
    try {
      // Create a new browser context
      const context = await browser.createBrowserContext();
      
      // Create a new page with injected fingerprint
      const page = await newInjectedPage(browser, {
        fingerprintOptions: {
          devices: ['desktop'],
          browsers: [{ name: 'chrome', minVersion: 99 }],
          operatingSystems: ['windows', 'macos']
        }
      });
      
      // Apply fingerprint and anti-detection techniques
      await page.evaluateOnNewDocument(() => {
        // Override navigator properties to remove webdriver flag
        // Using any to bypass TypeScript restrictions on prototype manipulation
        const navigator = window.navigator as any;
        const originalProto = navigator.__proto__;
        delete originalProto.webdriver;
        
        // Override permissions API
        // Using any to bypass TypeScript's strict type checking
        const permissions = window.navigator.permissions as any;
        const originalQuery = permissions.query;
        permissions.query = function(parameters: any) {
          if (parameters.name === 'notifications') {
            // Return an object that looks like PermissionStatus
            return Promise.resolve({
              state: Notification.permission,
              name: 'notifications',
              onchange: null,
              addEventListener: function() {},
              removeEventListener: function() {},
              dispatchEvent: function() { return true; }
            });
          }
          return originalQuery.call(this, parameters);
        };
        
        // Prevent iframe detection
        Object.defineProperty(window, 'frameElement', {
          get: () => null
        });
      });
      
      // Set user agent if using random user agent option
      if (mergedConfig.useRandomUserAgent) {
        const userAgent = randomUseragent.getRandom();
        if (userAgent) {
          await page.setUserAgent(userAgent);
        }
      }
      // Otherwise fingerprint-injector will have already set a consistent user agent
      
      // Set WebGL vendor and renderer
      await page.evaluateOnNewDocument(() => {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
          if (parameter === 37445) {
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            return 'Intel Iris OpenGL Engine';
          }
          // Use call with the parameter instead of apply with arguments
          return getParameter.call(this, parameter);
        };
      });
      
      // Set language and geolocation to appear more natural
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'language', {
          get: function() {
            return 'en-US';
          }
        });
        Object.defineProperty(navigator, 'languages', {
          get: function() {
            return ['en-US', 'en'];
          }
        });
      });
      
      // Load existing cookies if available
      const cookies = loadCookiesFromFile(url);
      if (cookies.length) {
        // Convert cookies to the format expected by setCookie
        const cookieParams = convertCookieFormat(cookies);
        await page.setCookie(...cookieParams);
      }
      
      // Intercept and modify request headers
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        // Modify headers to appear more like a real browser
        const headers = request.headers();
        headers['Accept-Language'] = 'en-US,en;q=0.9';
        headers['sec-ch-ua'] = '"Google Chrome";v="113", "Chromium";v="113", "Not-A.Brand";v="24"';
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = '"Windows"';
        headers['Upgrade-Insecure-Requests'] = '1';
        headers['sec-fetch-dest'] = 'document';
        headers['sec-fetch-mode'] = 'navigate';
        headers['sec-fetch-site'] = 'none';
        headers['sec-fetch-user'] = '?1';
        
        // Continue with modified request
        request.continue({ headers });
      });
      
      // Setup specific behaviors for Kasada detection evasion
      await page.evaluateOnNewDocument(() => {
        // Override performance and timing functions
        const hrTime = window.performance && window.performance.now ?
          window.performance.now.bind(window.performance) :
          function() { return +new Date(); };
        
        // Add slight randomization to timing functions
        const originalNow = window.performance.now;
        window.performance.now = function() {
          // Use call without arguments since the original function takes no parameters
          return originalNow.call(this) + (Math.random() * 0.005);
        };
        
        // Override canvas fingerprinting
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type: string) {
          if (this.width === 0 && this.height === 0) {
            // Use call with the type parameter
            return originalToDataURL.call(this, type);
          }
          // Add slight noise to canvas data
          const context = this.getContext('2d');
          if (context) {
            const imageData = context.getImageData(0, 0, this.width, this.height);
            const pixels = imageData.data;
            for (let i = 0; i < pixels.length; i += 4) {
              pixels[i] = pixels[i] + Math.floor(Math.random() * 2);     // red
              pixels[i + 1] = pixels[i + 1] + Math.floor(Math.random() * 2); // green
              pixels[i + 2] = pixels[i + 2] + Math.floor(Math.random() * 2); // blue
            }
            context.putImageData(imageData, 0, 0);
          }
          // Use call with the type parameter
          return originalToDataURL.call(this, type);
        };
        
        // Deal with ips.js detection
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8
        });
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8
        });
      });
      
      // Navigate to target URL with randomized timing
      console.log(`Navigating to ${url}`);
      
      // Random pre-navigation delay
      await randomDelay();
      
      // Go to the target website
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      
      // Wait a bit and perform some random human-like interactions
      await randomDelay();
      
      // Scroll randomly
      await page.evaluate(() => {
        const scrollHeight = Math.floor(document.body.scrollHeight / 4);
        window.scrollBy(0, scrollHeight);
      });
      
      await randomDelay();
      
      // Perform some mouse movements
      await humanMouseMovement(page);
      
      // Take screenshot for debugging if enabled
      if (mergedConfig.takeScreenshots) {
        if (!fs.existsSync(mergedConfig.screenshotPath)) {
          fs.mkdirSync(mergedConfig.screenshotPath, { recursive: true });
        }
        
        const domain = new URL(url).hostname;
        await page.screenshot({ 
          path: path.join(mergedConfig.screenshotPath, `${domain}-${Date.now()}.png`),
          fullPage: true 
        });
      }
      
      // Get the cookies from the page
      const currentCookies = await page.cookies();
      
      // Adapt cookies to our generic format
      const adaptedCookies = adaptCookies(currentCookies);
      
      // Save the cookies for future sessions
      await saveCookiesToFile(url, adaptedCookies);
      
      // Perform some final human-like actions before leaving
      await humanMouseMovement(page);
      await randomDelay();
      
      console.log(`Successfully retrieved ${currentCookies.length} cookies from ${url}`);
      
      return adaptedCookies;
      
    } catch (error) {
      console.error('Error getting cookies:', error);
      throw error;
    } finally {
      await browser.close();
    }
  }
  
  /**
   * Advanced version to get cookies with additional data extraction
   * @param url - The URL to visit and get cookies from
   * @param extractFunction - Optional function to extract data from the page
   * @param options - Optional configuration to override defaults
   * @returns - Object containing cookies and extracted data
   */
  async function getCookiesWithData(
    url: string, 
    extractFunction: (page: any) => Promise<any>,
    options: ScraperOptions = {}
  ): Promise<CookiesWithDataResult> {
    const mergedConfig: ScraperConfig = { ...config, ...options };
    let browser: any;
    
    try {
      browser = await puppeteer.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-infobars',
          '--window-position=0,0',
          '--ignore-certificate-errors',
          '--ignore-certificate-errors-spki-list',
          '--disable-dev-shm-usage',
          '--no-proxy-server', // Explicitly disable proxy
        ],
        ignoreDefaultArgs: false,
        defaultViewport: {
          width: 1920,
          height: 1080,
        }
      });
      
      // Create a new browser context
      const context = await browser.createBrowserContext();
      
      // Create a new page with injected fingerprint
      const page = await newInjectedPage(browser, {
        fingerprintOptions: {
          devices: ['desktop'],
          browsers: [{ name: 'chrome', minVersion: 99 }],
          operatingSystems: ['windows', 'macos']
        }
      });
      
      // Apply similar stealth techniques as in getCookies
      // (Detailed implementation omitted for brevity)
      
      // Navigate and interact with the page
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await randomDelay();
      
      // Extract data
      let extractedData = null;
      if (typeof extractFunction === 'function') {
        extractedData = await extractFunction(page);
      }
      
      // Get cookies
      const cookies = await page.cookies();
      const adaptedCookies = adaptCookies(cookies);
      await saveCookiesToFile(url, adaptedCookies);
      
      return {
        cookies: adaptedCookies,
        data: extractedData
      };
      
    } catch (error) {
      console.error('Error in getCookiesWithData:', error);
      throw error;
    } finally {
      if (browser) await browser.close();
    }
  }
  
  /**
   * Helper to check if cookies are still valid
   * @param url - The URL to check
   * @param cookies - Array of cookie objects
   * @returns - Whether cookies are valid
   */
  async function validateCookies(
    url: string, 
    cookies: GenericCookie[]
  ): Promise<boolean> {
    const browser = await puppeteer.launch({ 
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--no-proxy-server'  // Explicitly disable proxy
      ]
    });
    
    try {
      const page = await browser.newPage();
      // Convert cookies to the format expected by setCookie
      const cookieParams = convertCookieFormat(cookies);
      await page.setCookie(...cookieParams);
      
      // Make a quick request to the site
      const response = await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      // Check if we're still logged in or if we hit a login page
      // This logic will vary based on the website
      const isValid = await page.evaluate(() => {
        // This is a simplified example - adjust based on the target website
        // For example, check if a login button exists or if user info is displayed
        return !document.querySelector('.login-button') || 
               !!document.querySelector('.user-profile');
      });
      
      return isValid;
    } catch (error) {
      console.error('Error validating cookies:', error);
      return false;
    } finally {
      await browser.close();
    }
  }

  /**
 * Advanced function to get cookies from sites protected by Kasada
 * @param url - The URL to visit
 * @param options - Configuration options
 * @returns - Array of cookie objects
 */
async function getKasadaProtectedCookies(url:string, options = {}) {
    const defaultOptions = {
      headless: false,
      userDataDir: path.join(__dirname, 'chrome-user-data'),
      cookiesPath: path.join(__dirname, 'cookies', `${new URL(url).hostname}-cookies.json`),
      timeout: 60000,
      waitTime: 15000, // Wait time for Kasada challenge to complete
      interactionDelay: 3000,
      useExtraStealthTechniques: true,
      screenshots: true,
      screenshotsPath: path.join(__dirname, 'screenshots'),
      debug: true
    };
  
    const mergedOptions = { ...defaultOptions, ...options };
    const { debug } = mergedOptions;
    
    // Create directories if they don't exist
    if (!fs.existsSync(path.dirname(mergedOptions.cookiesPath))) {
      fs.mkdirSync(path.dirname(mergedOptions.cookiesPath), { recursive: true });
    }
    
    if (mergedOptions.screenshots && !fs.existsSync(mergedOptions.screenshotsPath)) {
      fs.mkdirSync(mergedOptions.screenshotsPath, { recursive: true });
    }
  
    debug && console.log(`Launching browser for ${url}...`);
    const browser = await puppeteer.launch({
      headless: mergedOptions.headless,
      userDataDir: mergedOptions.userDataDir, // Persistent session
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-proxy-server',
        '--disable-blink-features=AutomationControlled'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: null
    });
  
    try {
      // Create a new page with enhanced fingerprinting protection
      debug && console.log('Creating fingerprinted page...');
      const page = await newInjectedPage(browser, {
        fingerprintOptions: {
          devices: ['desktop'],
          browsers: [{ name: 'chrome', minVersion: 99 }],
          operatingSystems: ['windows', 'macos'],
        }
      });
      
      // Apply extra stealth techniques
      if (mergedOptions.useExtraStealthTechniques) {
        debug && console.log('Applying advanced stealth techniques...');
        await page.evaluateOnNewDocument(() => {
          // Advanced techniques to evade Kasada detection
          
          // 1. Override navigator properties
          const originalNavigator = window.navigator;
          const navigatorProxy = new Proxy(originalNavigator, {
            has: (target, key) => {
              if (key === 'webdriver') return false;
              return key in target;
            },
            get: (target:any, key) => {
              // Return undefined for webdriver
              if (key === 'webdriver') return undefined;
              
              // Return custom values for properties used for fingerprinting
              if (key === 'hardwareConcurrency') return 8;
              if (key === 'deviceMemory') return 8;
              if (key === 'platform') return 'Win32';
              
              // For functions, return a proxy to the original function
              if (typeof target[key] === 'function') {
                return function(...args:any) {
                  return target[key].apply(target, args);
                };
              }
              
              return target[key];
            }
          });
          
          // Replace navigator
          window.navigator = navigatorProxy;
          
          // 2. Override timing functions with slight randomization
          const originalPerformance = window.performance;
          const performanceProxy = new Proxy(originalPerformance, {
            get: (target:any, key) => {
              if (key === 'now') {
                return function() {
                  return target.now() + (Math.random() * 0.01);
                };
              }
              return target[key];
            }
          });
          window.performance = performanceProxy;
          
          // 3. Randomize Canvas fingerprinting
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function(type) {
            if (this.width === 0 || this.height === 0) {
                return originalToDataURL.call(this, type);
            }
            
            const context = this.getContext('2d');
            if (context) {
              // Add noise to canvas before generating the data URL
              const imageData = context.getImageData(0, 0, this.width, this.height);
              const pixels = imageData.data;
              
              // Only modify a small percentage of pixels to maintain visual similarity
              const modifyRatio = 0.002; // 0.2% of pixels
              const pixelsToModify = Math.floor(pixels.length / 4 * modifyRatio);
              
              for (let i = 0; i < pixelsToModify; i++) {
                const pixelIndex = Math.floor(Math.random() * (pixels.length / 4)) * 4;
                // Add minor noise to prevent detection but keep image visually identical
                pixels[pixelIndex] = Math.max(0, Math.min(255, pixels[pixelIndex] + (Math.random() * 2 - 1)));
                pixels[pixelIndex + 1] = Math.max(0, Math.min(255, pixels[pixelIndex + 1] + (Math.random() * 2 - 1)));
                pixels[pixelIndex + 2] = Math.max(0, Math.min(255, pixels[pixelIndex + 2] + (Math.random() * 2 - 1)));
              }
              
              context.putImageData(imageData, 0, 0);
            }
            
            return originalToDataURL.call(this, type);
          };
          
          // 4. Override AudioContext to prevent audio fingerprinting
          if (window.AudioContext) {
            const OriginalAudioContext = window.AudioContext;
            //@ts-ignore
            window.AudioContext = function() {
              const audioContext = new OriginalAudioContext();
              //@ts-ignore
              const originalGetChannelData = audioContext.createAnalyser().getChannelData;
              //@ts-ignore
              audioContext.createAnalyser().getChannelData = function(channel) {
                const channelData = originalGetChannelData.call(this, channel);
                // Add slight noise to the audio data
                const noise = 0.0001; // Very small noise
                for (let i = 0; i < channelData.length; i++) {
                  channelData[i] += (Math.random() * 2 - 1) * noise;
                }
                return channelData;
              };
              return audioContext;
            };
          }
          
          // 5. Modify WebGL fingerprinting
          const getParameterProxied = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            // UNMASKED_VENDOR_WEBGL
            if (parameter === 37445) {
              return 'Intel Inc.';
            }
            // UNMASKED_RENDERER_WEBGL
            if (parameter === 37446) {
              return 'Intel Iris OpenGL Engine';
            }
            return getParameterProxied.call(this, parameter);
          };
        });
      }
      
      // Try to load existing cookies if available
      try {
        if (fs.existsSync(mergedOptions.cookiesPath)) {
          debug && console.log('Loading existing cookies...');
          const cookiesString = fs.readFileSync(mergedOptions.cookiesPath, 'utf8');
          const cookies = JSON.parse(cookiesString);
          await page.setCookie(...cookies);
        }
      } catch (error) {
        debug && console.error('Error loading cookies:', error);
      }
      
      // Set a realistic user agent
      const userAgent = randomUseragent.getRandom(ua => {
        return ua.browserName === 'Chrome' && parseFloat(ua.browserVersion) >= 90;
      });
      if (userAgent) {
        await page.setUserAgent(userAgent);
      }
      
      // Navigate to the URL
      debug && console.log(`Navigating to ${url}...`);
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: mergedOptions.timeout 
      });
      
      if (mergedOptions.screenshots) {
        await page.screenshot({ 
          path: path.join(mergedOptions.screenshotsPath, `initial-${Date.now()}.png`),
          fullPage: true 
        });
      }
      
      // Human-like interactions to bypass Kasada
      debug && console.log('Performing human-like interactions...');
      
      // Random wait time before interactions
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 2000)));
      
      // Scroll down slowly in chunks
      const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      const scrollChunks = Math.floor(scrollHeight / viewportHeight);
      
      for (let i = 0; i < scrollChunks; i++) {
        await page.evaluate((i, viewportHeight) => {
          window.scrollTo({
            top: i * viewportHeight,
            behavior: 'smooth'
          });
        }, i, viewportHeight);
        // Random delay between scrolls
        await new Promise(resolve => setTimeout(resolve, 800 + Math.floor(Math.random() * 1200)));
      }
      
      // Move mouse randomly
      const maxX = await page.evaluate(() => window.innerWidth);
      const maxY = await page.evaluate(() => window.innerHeight);
      
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(Math.random() * maxX);
        const y = Math.floor(Math.random() * maxY);
        await page.mouse.move(x, y, { steps: 10 });
        await new Promise(resolve => setTimeout(resolve, 300 + Math.floor(Math.random() * 500)));
      }
      
      // Wait for Kasada to complete authentication
      debug && console.log(`Waiting ${mergedOptions.waitTime}ms for any challenges to complete...`);
      await new Promise(resolve => setTimeout(resolve, mergedOptions.waitTime));
      
      // Take another screenshot after waiting
      if (mergedOptions.screenshots) {
        await page.screenshot({ 
          path: path.join(mergedOptions.screenshotsPath, `after-wait-${Date.now()}.png`),
          fullPage: true 
        });
      }
      
      // Get all cookies after authentication
      debug && console.log('Getting cookies...');
      const cookies = await page.cookies();
      
      // Save cookies to file
      fs.writeFileSync(mergedOptions.cookiesPath, JSON.stringify(cookies, null, 2));
      
      debug && console.log(`Successfully retrieved ${cookies.length} cookies`);
      
      return cookies;
    } catch (error) {
      console.error('Error while getting cookies:', error);
      
      // Try to take a screenshot of the error state
      if (mergedOptions.screenshots) {
        try {
          const pages = await browser.pages();
          if (pages.length > 0) {
            const errorPage = pages[pages.length - 1];
            await errorPage.screenshot({ 
              path: path.join(mergedOptions.screenshotsPath, `error-${Date.now()}.png`),
              fullPage: true 
            });
          }
        } catch (screenshotError) {
          console.error('Error taking error screenshot:', screenshotError);
        }
      }
      
      throw error;
    } finally {
      await browser.close();
    }
  }
  
  /**
   * Format cookies for use in HTTP requests
   * @param cookies - Array of cookie objects
   * @returns - Cookie string for HTTP headers
   */
  function formatCookiesForRequest(cookies:any) {
    return cookies.map((cookie:any) => `${cookie.name}=${cookie.value}`).join('; ');
  }
  
  export {
    getCookies,
    getKasadaProtectedCookies,
    getCookiesWithData,
    formatCookiesForRequest,
    validateCookies,
    ScraperConfig,
    ScraperOptions,
    CookiesWithDataResult,
    GenericCookie
  };