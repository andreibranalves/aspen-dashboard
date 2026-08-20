// Browser-only PDF renderer for immutable PostgreSQL quotation HTML.

// Chrome/Edge headless PDF generator for quotation documents.
// Implements the AGENTS.md requirement: use Chrome/Edge headless with --headless=new,
// NOT wkhtmltopdf.
//
// Two strategies (tried in order):
//   1. System browser via spawn (fast — for VPS / local dev)
//   2. @sparticuz/chromium + puppeteer-core (for Vercel / serverless)

import { existsSync } from 'node:fs';

// ── Browser paths (system binaries, tried first) ────────────────────────────

function getEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function getBrowserCandidates(): string[] {
  const fromEnv = [
    getEnv('PUPPETEER_EXECUTABLE_PATH'),
    getEnv('CHROME_PATH'),
    getEnv('EDGE_PATH'),
  ].filter(Boolean);

  if (process.platform === 'win32') {
    const programFiles = getEnv('PROGRAMFILES', 'ProgramFiles') || 'C:\\Program Files';
    const programFilesX86 =
      getEnv('PROGRAMFILES(X86)', 'ProgramFiles(x86)') || 'C:\\Program Files (x86)';
    const localAppData = getEnv('LOCALAPPDATA', 'LocalAppData');

    return [
      ...fromEnv,
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].filter(Boolean);
  }

  if (process.platform === 'darwin') {
    return [
      ...fromEnv,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }

  return [
    ...fromEnv,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
}

const BROWSER_CANDIDATES: string[] = getBrowserCandidates();

// ── System browser discovery (cached) ───────────────────────────────────────

let _systemBrowserPath: string | null = null;
let _checked = false;

function findSystemBrowser(): string | null {
  if (_checked) return _systemBrowserPath;
  _checked = true;
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) {
      _systemBrowserPath = candidate;
      return _systemBrowserPath;
    }
  }
  return null;
}

// ── Strategy 1: system browser via Puppeteer ────────────────────────────────

async function pdfWithSystemBrowser(
  html: string,
  opts: { timeout?: number } = {}
): Promise<Buffer> {
  const timeout = opts.timeout || 60000;
  const browserPath = findSystemBrowser()!;
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    args: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-software-rasterizer'],
    executablePath: browserPath,
    timeout,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0' as unknown as 'load',
      timeout,
    });
    await page.evaluate('document.fonts.ready');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      preferCSSPageSize: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Strategy 2: @sparticuz/chromium + puppeteer-core (serverless fallback) ──

async function pdfWithSparticuz(html: string, opts: { timeout?: number } = {}): Promise<Buffer> {
  const timeout = opts.timeout || 60000;

  // Dynamic imports — only loaded when needed (keeps cold start light
  // when system browser is available)
  const [chromiumMod, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);

  const chromium = chromiumMod.default;

  const browser = await puppeteer.launch({
    args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
    executablePath: await chromium.executablePath(),
    timeout,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0' as unknown as 'load',
      timeout,
    });
    await page.evaluate('document.fonts.ready');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      preferCSSPageSize: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

/** Render already-prepared quotation HTML from an immutable revision snapshot. */
export async function renderQuotationPdf(
  html: string,
  opts: { timeout?: number } = {},
): Promise<Buffer> {
  const timeout = opts.timeout || 60000;
  const sysBrowser = findSystemBrowser();
  if (sysBrowser) {
    console.log('[quotation-pdf] using system browser:', sysBrowser);
    return pdfWithSystemBrowser(html, { timeout });
  }

  console.log('[quotation-pdf] system browser not found, using @sparticuz/chromium');
  try {
    return await pdfWithSparticuz(html, { timeout });
  } catch (err) {
    throw Object.assign(
      new Error('Falha ao gerar PDF com @sparticuz/chromium: ' + ((err as Error).message || err)),
      { statusCode: 500 }
    );
  }
}

const WEBP_PAGE_WIDTH_CSS_PX = 794;
const WEBP_PAGE_HEIGHT_CSS_PX = 1123;
const WEBP_DEVICE_SCALE_FACTOR = 2;
const WEBP_QUALITY = 90;
const MAX_WEBP_PAGES = 100;

type PuppeteerBrowser = import('puppeteer-core').Browser;

async function captureWebpPages(browser: PuppeteerBrowser, html: string): Promise<Buffer[]> {
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: WEBP_PAGE_WIDTH_CSS_PX,
      height: WEBP_PAGE_HEIGHT_CSS_PX,
      deviceScaleFactor: WEBP_DEVICE_SCALE_FACTOR,
    });
    await page.setContent(html, {
      waitUntil: 'networkidle0' as unknown as 'load',
      timeout: 60000,
    });
    await page.evaluate('document.fonts.ready');
    await page.emulateMediaType('print');
    const contentHeight = Number(
      await page.evaluate(
        'Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight || 0)',
      ),
    );
    const pageCount = Math.max(1, Math.ceil(contentHeight / WEBP_PAGE_HEIGHT_CSS_PX));
    if (pageCount > MAX_WEBP_PAGES) {
      throw new Error('O orçamento excede o limite de páginas para imagem.');
    }
    const pages: Buffer[] = [];
    for (let index = 0; index < pageCount; index += 1) {
      const image = await page.screenshot({
        type: 'webp',
        quality: WEBP_QUALITY,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: index * WEBP_PAGE_HEIGHT_CSS_PX,
          width: WEBP_PAGE_WIDTH_CSS_PX,
          height: WEBP_PAGE_HEIGHT_CSS_PX,
        },
      });
      pages.push(Buffer.from(image));
    }
    return pages;
  } finally {
    await page.close().catch(() => {});
  }
}

async function webpWithSystemBrowser(html: string): Promise<Buffer[]> {
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    args: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-software-rasterizer'],
    executablePath: findSystemBrowser()!,
    timeout: 60000,
  });
  try {
    return await captureWebpPages(browser, html);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function webpWithSparticuz(html: string): Promise<Buffer[]> {
  const [chromiumMod, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);
  const chromium = chromiumMod.default;
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
    executablePath: await chromium.executablePath(),
    timeout: 60000,
  });
  try {
    return await captureWebpPages(browser, html);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Render immutable quotation HTML into one WebP image per A4 page. */
export async function renderQuotationWebpHtml(html: string): Promise<Buffer[]> {
  const systemBrowser = findSystemBrowser();
  if (systemBrowser) {
    console.log('[quotation-webp] using system browser:', systemBrowser);
    return webpWithSystemBrowser(html);
  }
  console.log('[quotation-webp] system browser not found, using @sparticuz/chromium');
  try {
    return await webpWithSparticuz(html);
  } catch (err) {
    throw Object.assign(
      new Error('Falha ao gerar WebP com @sparticuz/chromium: ' + ((err as Error).message || err)),
      { statusCode: 500 },
    );
  }
}

export const renderQuotationPdfHtml = renderQuotationPdf;
