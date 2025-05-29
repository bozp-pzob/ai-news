import { chromium } from 'patchright';
import path from 'path';

const dataDir = path.join(__dirname, 'chrome-user-data');

async function getCookiesAndHeaders(url: string): Promise<any> {
  let context;
  let finalHeaders: Record<string, string> = {};
  
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
      
      page.on('request', (request) => {
          if (request.url().includes(new URL(url).hostname)) {
              finalHeaders = request.headers();
          }
      });
      
      await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 30000
      });

      await page.waitForTimeout(3000);

      return finalHeaders;
  } catch (error: any) {
      console.error('Error occurred:', error.message);
      throw error;
  } finally {
      if (context) await context.close();
  }
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
          headless: true,
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

export {
  getPageHTML,
  getCookies,
  getCookiesAndHeaders
};