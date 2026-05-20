// Combined app server for aspen-orcamento
// Serves frontend from public/ + API handlers from api/_functions/
// Binds to PORT env var or 8888 (dashboard.srv1633500.hstgr.cloud via Traefik)
// Start: PORT=8888 node scripts/app-server.mjs

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

// Load env from .env using dotenv
import 'dotenv/config';

if (!process.env.ERPNEXT_TOKEN) {
  console.error('ERPNEXT_TOKEN não configurado no .env');
  process.exit(1);
}

// Import API handlers
import { handler as clientDetail } from '../api/_functions/client-detail.js';
import { handler as crmDeals } from '../api/_functions/crm-deals.js';
import { handler as crmUpdateDeal } from '../api/_functions/crm-update-deal.js';
import { handler as extract } from '../api/_functions/extract.js';
import { handler as freight } from '../api/_functions/freight.js';
import { handler as leadsClients } from '../api/_functions/leads-clients.js';
import { handler as orcamento } from '../api/_functions/orcamento.js';
import { handler as pricingLookup } from '../api/_functions/pricing-lookup.js';
import { handler as productDetail } from '../api/_functions/product-detail.js';
import { handler as productPricingUpdate } from '../api/_functions/product-pricing-update.js';
import { handler as productPricing } from '../api/_functions/product-pricing.js';
import { handler as products } from '../api/_functions/products.js';
import { handler as quotations } from '../api/_functions/quotations.js';
import { handler as salesDashboard } from '../api/_functions/sales-dashboard.js';
import { handler as salesOrderFromQuotation } from '../api/_functions/sales-order-from-quotation.js';
import { handler as salesOrders } from '../api/_functions/sales-orders.js';
import { handler as sendWhatsapp } from '../api/_functions/send-whatsapp.js';
import { handler as view } from '../api/_functions/view.js';

const ROUTES = {
  'client-detail': clientDetail,
  'crm-deals': crmDeals, 'crm-update-deal': crmUpdateDeal, extract, freight,
  'leads-clients': leadsClients, orcamento, 'pricing-lookup': pricingLookup,
  'product-detail': productDetail, 'product-pricing-update': productPricingUpdate,
  'product-pricing': productPricing, products, quotations,
  'sales-dashboard': salesDashboard, 'sales-order-from-quotation': salesOrderFromQuotation,
  'sales-orders': salesOrders, 'send-whatsapp': sendWhatsapp, view,
};

const PORT = Number(process.env.PORT || 8888);
const PUBLIC_DIR = 'public';

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function serveStatic(urlPath, res) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = normalize(join(PUBLIC_DIR, filePath));
  
  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR + '/') && filePath !== PUBLIC_DIR + '/index.html') {
    return false;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback: serve index.html for non-file routes
    filePath = join(PUBLIC_DIR, 'index.html');
    if (!existsSync(filePath)) return false;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);
  
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
  res.end(content);
  return true;
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  const urlPath = req.url.split('?')[0];

  // API routes
  if (urlPath.startsWith('/api/')) {
    const routeName = urlPath.replace(/^\/api\/?/, '').split('/')[0];
    const handler = ROUTES[routeName];

    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint não encontrado.' }));
      return;
    }

    try {
      const body = req.method !== 'GET' ? await parseBody(req) : {};
      const event = {
        httpMethod: req.method,
        body: req.method === 'GET' ? undefined : JSON.stringify(body),
        queryStringParameters: Object.fromEntries(new URL(req.url, 'http://localhost').searchParams),
        headers: { host: req.headers.host || 'localhost', 'x-forwarded-proto': 'https' },
      };

      const result = await handler(event);
      res.writeHead(result.statusCode || 200, {
        'Content-Type': result.headers?.['Content-Type'] || 'application/json',
      });
      res.end(result.body || '');
    } catch (err) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error(`[api/${routeName}]`, err.message);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Erro interno.' }));
    }
    return;
  }

  // Static files / SPA
  if (!serveStatic(urlPath, res)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`App server on http://0.0.0.0:${PORT}`);
  console.log(`Frontend: public/  |  API: 18 handlers`);
});
