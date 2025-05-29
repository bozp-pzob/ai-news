import { chromium } from 'patchright';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(__dirname, 'chrome-user-data');

function cookiesToHeader(cookies: any[]): Record<string, string> {
  const cookieHeader = cookies
    .map(cookie => `${encodeURIComponent(cookie.name)}=${encodeURIComponent(cookie.value)}`)
    .join('; ');

  return {
    Cookie: cookieHeader
  };
}

function getCookieValue(cookies: any[], name: string): string {
  const found = cookies.find(cookie => cookie.name === name);
  return found?.value || '';
}

async function getCookies(url: string): Promise<any> {
  let context;
  
  try {
      context = await chromium.launchPersistentContext(dataDir, {
          channel: "chrome",
          headless: false,
          viewport: null,
          locale: 'en-US',
          args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--disable-gpu'
          ]
      });

      const page = await context.newPage();
      
      await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 30000
      });

      await page.waitForTimeout(3000);

      const cookies = await context.cookies();

      return cookies;
  } catch (error:any) {
      console.error('Error occurred:', error.message);
      throw error;
  } finally {
      if (context) await context.close();
  }
}

async function getPageHTML(url: string): Promise<any> {
  let context;
  
  try {
      context = await chromium.launchPersistentContext(dataDir, {
          channel: "chrome",
          headless: false,
          viewport: null,
          locale: 'en-US',
          args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--disable-gpu'
          ]
      });

      const page = await context.newPage();
      
      await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 30000
      });

      await page.waitForTimeout(3000);

      const html = await page.content()

      return html;
  } catch (error:any) {
      console.error('Error occurred:', error.message);
      throw error;
  } finally {
      if (context) await context.close();
  }
}


async function getRSSXML(rssUrl: string): Promise<any> {
  let context;
  
  const timeout = 30000,
    waitForSelector = null,
    saveToFile = true,
    outputDir = './rss-feeds',
    handleDownload = true;
  
  try {
      context = await chromium.launchPersistentContext(dataDir, {
          channel: "chrome",
          headless: false,
          viewport: null,
          locale: 'en-US',
          args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--disable-gpu'
          ]
      });

      const page = await context.newPage();
      let xmlContent = null;
      let downloadHandled = false;
      
      if (handleDownload) {
        await page.route('**/*', async (route, request) => {
          const response = await route.fetch();
          const contentType = response.headers()['content-type'] || '';
          
          // Check if it's XML content
          if (contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom')) {
            const body = await response.body();
            xmlContent = body.toString('utf-8');
            downloadHandled = true;
            console.log(`Intercepted XML content: ${xmlContent.length} characters`);
          }
          
          route.fulfill({ response });
        });

        // Also handle download events
        page.on('download', async (download) => {
          try {
            const suggestedFilename = download.suggestedFilename();
            console.log(`Download detected: ${suggestedFilename}`);
            
            // Check if it's likely an RSS/XML file
            if (suggestedFilename.includes('.xml') || suggestedFilename.includes('.rss') || 
              suggestedFilename.includes('rss') || suggestedFilename.includes('feed')) {
              
              const tempPath = path.join(__dirname, 'temp_' + suggestedFilename);
              await download.saveAs(tempPath);
              
              // Read the downloaded file
              xmlContent = fs.readFileSync(tempPath, 'utf-8');
              downloadHandled = true;
              
              // Clean up temp file
              fs.unlinkSync(tempPath);
              console.log(`Downloaded and read XML file: ${xmlContent.length} characters`);
            }
          } catch (downloadError:any) {
            console.warn('Error handling download:', downloadError.message);
          }
        });
      }

      // Navigate to the RSS feed URL
      const response :any = await page.goto(rssUrl, {
        waitUntil: 'networkidle',
        timeout: timeout
      });

      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
      }

      // Wait a bit for downloads or dynamic content
      await page.waitForTimeout(3000);

      // If we didn't get content from download/intercept, try getting page content
      if (!xmlContent || !downloadHandled) {
        console.log('Attempting to extract content from page...');
        
        // Try to get content from page source
        xmlContent = await page.content();
        
        // If the page content is HTML wrapper, try to extract from response
        if (xmlContent.includes('<html') && xmlContent.includes('<body')) {
          console.log('Page appears to be HTML wrapper, trying direct response...');
          
          // Try to get the raw response body
          const responseBody = await response.text();
          if (responseBody && (responseBody.includes('<?xml') || responseBody.includes('<rss') || responseBody.includes('<feed'))) {
            xmlContent = responseBody;
            console.log('Successfully extracted XML from response body');
          } else {
            // Try to find XML content within the HTML
            const xmlMatch = xmlContent.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
            if (xmlMatch) {
              xmlContent = xmlMatch[1].trim();
              // Decode HTML entities
              xmlContent = xmlContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
              console.log('Extracted XML from <pre> tag');
            }
          }
        }
      }

      // Final verification
      if (!xmlContent || (!xmlContent.includes('<?xml') && !xmlContent.includes('<rss') && !xmlContent.includes('<feed'))) {
        // Last resort: try fetch approach
        console.log('Trying direct fetch approach...');
        xmlContent = await fetchRSSDirectly(rssUrl);
      }

      if (!xmlContent) {
        throw new Error('Could not extract XML content from the RSS feed');
      }

      console.log(`Successfully extracted ${xmlContent.length} characters of XML content`);

      await page.close();
      return xmlContent;
    } catch (error:any) {
      console.error('Error occurred:', error.message);
      throw error;
    } finally {
      if (context) await context.close();
    }
}

async function fetchRSSDirectly(rssUrl:string) {
  try {
    let context = await chromium.launchPersistentContext(dataDir, {
        channel: "chrome",
        headless: false,
        viewport: null,
        locale: 'en-US',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    });
    const page = await context.newPage();
    
    // Use evaluate to fetch within the browser context
    const xmlContent = await page.evaluate(async (url:any) => {
        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                    'User-Agent': navigator.userAgent
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.text();
        } catch (error:any) {
            throw new Error(`Fetch failed: ${error.message}`);
        }
    }, rssUrl);
    
    await page.close();
    console.log('Successfully fetched XML via direct fetch');
    return xmlContent;
  } catch (error:any) {
    console.warn('Direct fetch approach failed:', error.message);
    return null;
  }
}

export {
  cookiesToHeader,
  getCookies,
  getPageHTML,
  getCookieValue,
  getRSSXML
};