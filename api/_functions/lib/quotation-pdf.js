// Chrome/Edge headless PDF generator for quotation documents.
// Implements the AGENTS.md requirement: use Chrome/Edge headless with --headless=new,
// NOT wkhtmltopdf (ERPNext's download_pdf).
//
// Falls back gracefully when no browser is available.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderQuotationHtml } from './quotation-html.js';
import { resolvePrintFormat } from './print-format.js';

// Browser paths to try, in order of preference.
const BROWSER_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

// ── Browser discovery ───────────────────────────────────────────────────────

let _browserPath = null;
let _checked = false;

function findBrowser() {
  if (_checked) return _browserPath;
  _checked = true;
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) {
      _browserPath = candidate;
      return _browserPath;
    }
  }
  return null;
}

// ── PDF generation ──────────────────────────────────────────────────────────

/**
 * Generate a PDF Buffer from quotation HTML using Chrome/Edge headless.
 *
 * @param {string} quotationId
 * @param {object} [opts]
 * @param {number} [opts.timeout=60000] - max wait time in ms
 * @returns {Promise<{ buffer: Buffer, customerName: string }>}
 * @throws {Error} if no browser available or generation fails
 */
export async function generateQuotationPdf(quotationId, opts = {}) {
  const timeout = opts.timeout || 60000;
  const browserPath = findBrowser();

  if (!browserPath) {
    throw Object.assign(
      new Error('Nenhum navegador Chrome/Edge disponível para gerar PDF.'),
      { statusCode: 500, code: 'NO_BROWSER' }
    );
  }

  // Determine the best print format for this quotation
  const printFormat = await resolvePrintFormat(quotationId, opts.printFormat);

  // Render the HTML using the shared helper
  const { html, customerName } = await renderQuotationHtml(quotationId, {
    includePrintButton: false,
    forPdf: true,
    printFormat,
  });

  // Create temp directory for HTML + PDF output
  const tmpDir = mkdtempSync(join(tmpdir(), 'aspen-pdf-'));
  const htmlPath = join(tmpDir, 'quotation.html');
  const pdfPath = join(tmpDir, 'quotation.pdf');

  try {
    // Write HTML to temp file
    writeFileSync(htmlPath, html, 'utf-8');
    const fileUrl = `file://${htmlPath}`;

    // Run Chrome headless
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

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

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

    // Read the generated PDF
    if (!existsSync(pdfPath)) {
      throw Object.assign(
        new Error('PDF não foi gerado pelo Chrome.'),
        { statusCode: 500 }
      );
    }

    const buffer = readFileSync(pdfPath);
    return { buffer, customerName };

  } finally {
    // Clean up temp files
    try {
      if (existsSync(htmlPath)) unlinkSync(htmlPath);
      if (existsSync(pdfPath)) unlinkSync(pdfPath);
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Temp cleanup failure is non-fatal
    }
  }
}
