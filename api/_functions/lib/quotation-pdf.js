// Chrome/Edge headless PDF generator for quotation documents.
// Implements the AGENTS.md requirement: use Chrome/Edge headless with --headless=new,
// NOT wkhtmltopdf (ERPNext's download_pdf).
//
// Two strategies (tried in order):
//   1. System browser via spawn (fast — for VPS / local dev)
//   2. @sparticuz/chromium + puppeteer-core (for Vercel / serverless)

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderQuotationHtml } from './quotation-html.js';
import { resolvePrintFormat } from './print-format.js';

// ── Browser paths (system binaries, tried first) ────────────────────────────

const BROWSER_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

// ── System browser discovery (cached) ───────────────────────────────────────

let _systemBrowserPath = null;
let _checked = false;

function findSystemBrowser() {
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

// ── Strategy 1: system browser via spawn ────────────────────────────────────

async function pdfWithSystemBrowser(html, opts = {}) {
  const timeout = opts.timeout || 60000;
  const browserPath = findSystemBrowser();

  const tmpDir = mkdtempSync(join(tmpdir(), 'aspen-pdf-'));
  const htmlPath = join(tmpDir, 'quotation.html');
  const pdfPath = join(tmpDir, 'quotation.pdf');

  try {
    writeFileSync(htmlPath, html, 'utf-8');
    const fileUrl = `file://${htmlPath}`;

    await new Promise((resolve, reject) => {
      const proc = spawn(browserPath, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-software-rasterizer',
        '--print-to-pdf=' + pdfPath,
        '--print-to-pdf-no-header',
        '--no-pdf-header-footer',
        fileUrl,
      ], {
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      proc.on('error', (err) => {
        reject(Object.assign(
          new Error(`Falha ao executar ${browserPath}: ${err.message}`),
          { statusCode: 500 }
        ));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(Object.assign(
            new Error(`Chrome headless encerrou com código ${code}.`),
            { statusCode: 500, detail: stderr.slice(0, 500) }
          ));
        } else {
          resolve();
        }
      });
    });

    if (!existsSync(pdfPath)) {
      throw Object.assign(
        new Error('PDF não foi gerado pelo Chrome.'),
        { statusCode: 500 }
      );
    }

    return readFileSync(pdfPath);

  } finally {
    try {
      if (existsSync(htmlPath)) unlinkSync(htmlPath);
      if (existsSync(pdfPath)) unlinkSync(pdfPath);
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* non-fatal */ }
  }
}

// ── Strategy 2: @sparticuz/chromium + puppeteer-core (serverless fallback) ──

async function pdfWithSparticuz(html, opts = {}) {
  const timeout = opts.timeout || 60000;

  // Dynamic imports — only loaded when needed (keeps cold start light
  // when system browser is available)
  const [{ default: chromium }, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--hide-scrollbars',
      '--disable-web-security',
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    timeout,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout,
    });

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

/**
 * Generate a PDF Buffer from quotation HTML.
 *
 * Tries system browser first (spawn), falls back to @sparticuz/chromium
 * + puppeteer-core for serverless environments (Vercel).
 *
 * @param {string} quotationId
 * @param {object} [opts]
 * @param {number} [opts.timeout=60000] - max wait time in ms
 * @param {string} [opts.printFormat] - override print format
 * @returns {Promise<{ buffer: Buffer, customerName: string }>}
 * @throws {Error} if PDF generation fails
 */
export async function generateQuotationPdf(quotationId, opts = {}) {
  const timeout = opts.timeout || 60000;

  // Determine the best print format for this quotation
  const printFormat = await resolvePrintFormat(quotationId, opts.printFormat);

  // Render the HTML using the shared helper
  const { html, customerName } = await renderQuotationHtml(quotationId, {
    includePrintButton: false,
    forPdf: true,
    printFormat,
  });

  // ── Strategy 1: system browser (fast path) ──
  const sysBrowser = findSystemBrowser();
  if (sysBrowser) {
    console.log('[quotation-pdf] using system browser:', sysBrowser);
    const buffer = await pdfWithSystemBrowser(html, { timeout });
    return { buffer, customerName };
  }

  // ── Strategy 2: @sparticuz/chromium (serverless fallback) ──
  console.log('[quotation-pdf] system browser not found, using @sparticuz/chromium');
  try {
    const buffer = await pdfWithSparticuz(html, { timeout });
    return { buffer, customerName };
  } catch (err) {
    throw Object.assign(
      new Error('Falha ao gerar PDF com @sparticuz/chromium: ' + (err.message || err)),
      { statusCode: 500 }
    );
  }
}
