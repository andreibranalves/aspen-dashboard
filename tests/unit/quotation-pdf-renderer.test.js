import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { renderQuotationPdf } from '../../api/_modules/quotation-pdf-renderer.js';

const codiconFont = readFileSync(
  resolve('node_modules/playwright-core/lib/vite/dashboard/assets/codicon-DCmgc-ay.ttf')
).toString('base64');

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolvePromise(server.address().port);
    });
  });
}

test('PDF waits for CSS webfonts before rendering', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/style.css') {
      const port = server.address().port;
      response.writeHead(200, {
        'Content-Type': 'text/css',
      });
      response.end(
        `@font-face{font-family:RegressionFont;src:url(http://127.0.0.1:${port}/font.ttf) format('truetype')}body{font-family:RegressionFont}`
      );
      return;
    }
    if (request.url === '/font.ttf') {
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'font/ttf',
      });
      response.end(Buffer.from(codiconFont, 'base64'));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);

  try {
    const html = `<!doctype html><link rel="stylesheet" href="http://127.0.0.1:${port}/style.css"><p>&#xEA60;</p>`;
    const pdf = await renderQuotationPdf(html);

    assert.match(pdf.toString('latin1'), /codicon/);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});
