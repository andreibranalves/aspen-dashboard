// Local dev server — replica as Netlify Functions localmente
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// Carrega .env manualmente
const envPath = new URL('.env', import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = 8888;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// Importa as funções Netlify
const { handler: extractHandler }        = await import('./netlify/functions/extract.js');
const { handler: orcamentoHandler }      = await import('./netlify/functions/orcamento.js');
const { handler: viewHandler }           = await import('./netlify/functions/view.js');
const { handler: editDraftHandler }      = await import('./netlify/functions/edit-draft.js');
const { handler: pricingLookupHandler }  = await import('./netlify/functions/pricing-lookup.js');
const { handler: quotationsHandler }    = await import('./netlify/functions/quotations.js');
const { handler: leadsClientsHandler }  = await import('./netlify/functions/leads-clients.js');
const { handler: productsHandler }      = await import('./netlify/functions/products.js');
const { handler: freightHandler }      = await import('./netlify/functions/freight.js');
const { handler: crmDealsHandler }       = await import('./netlify/functions/crm-deals.js');
const { handler: crmUpdateDealHandler }  = await import('./netlify/functions/crm-update-deal.js');
const { handler: productDetailHandler } = await import('./netlify/functions/product-detail.js');
const { handler: productPricingHandler } = await import('./netlify/functions/product-pricing.js');
const { handler: productPricingUpdateHandler } = await import('./netlify/functions/product-pricing-update.js');
const { handler: sendWhatsappHandler } = await import('./netlify/functions/send-whatsapp.js');

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function netlifyEvent(req, body) {
  return {
    httpMethod: req.method,
    headers: req.headers,
    body: body,
    queryStringParameters: Object.fromEntries(new URL(req.url, 'http://localhost').searchParams),
    isBase64Encoded: false,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  console.log(`${new Date().toISOString()} ${req.method} ${pathname}`);

  // ── API routes → Netlify functions
  if (pathname === '/api/extract' || pathname === '/.netlify/functions/extract') {
    const body = await readBody(req);
    console.log(`  extract body (first 200): ${body.substring(0, 200)}`);
    try {
      const result = await Promise.race([
        extractHandler(netlifyEvent(req, body)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout após 60s')), 60000)),
      ]);
      console.log(`  extract done — status ${result.statusCode}`);
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      console.error('  extract ERROR:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/orcamento' || pathname === '/.netlify/functions/orcamento') {
    const body = await readBody(req);
    try {
      const result = await orcamentoHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/edit-draft' || pathname === '/.netlify/functions/edit-draft') {
    const body = await readBody(req);
    try {
      const result = await editDraftHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/pricing-lookup' || pathname === '/.netlify/functions/pricing-lookup') {
    const body = await readBody(req);
    try {
      const result = await pricingLookupHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/quotations' || pathname === '/.netlify/functions/quotations') {
    const body = await readBody(req);
    try {
      const result = await quotationsHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/products' || pathname === '/.netlify/functions/products') {
    const body = await readBody(req);
    try {
      const result = await productsHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/leads-clients' || pathname === '/.netlify/functions/leads-clients') {
    const body = await readBody(req);
    try {
      const result = await leadsClientsHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/freight' || pathname === '/.netlify/functions/freight') {
    const body = await readBody(req);
    try {
      const result = await freightHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/send-whatsapp' || pathname === '/.netlify/functions/send-whatsapp') {
    const body = await readBody(req);
    try {
      const result = await sendWhatsappHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/view' || pathname === '/.netlify/functions/view') {
    try {
      const result = await viewHandler(netlifyEvent(req, null));
      res.writeHead(result.statusCode, result.headers || { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e.message);
    }
    return;
  }

  if (pathname === '/api/crm-deals' || pathname === '/.netlify/functions/crm-deals') {
    try {
      const result = await crmDealsHandler(netlifyEvent(req, null));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/crm-update-deal' || pathname === '/.netlify/functions/crm-update-deal') {
    const body = await readBody(req);
    try {
      const result = await crmUpdateDealHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/product-pricing' || pathname === '/.netlify/functions/product-pricing') {
    const body = req.method === 'GET' ? null : await readBody(req);
    try {
      const result = await productPricingHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Product detail: GET /api/product-detail?sku=... or /api/products/:sku ──
  if (pathname === '/api/product-detail' ||
      (pathname.startsWith('/api/products/') && !pathname.endsWith('/pricing')) ||
      pathname.startsWith('/.netlify/functions/product-detail')) {
    // Extrai SKU da path; ignora /api/products (listagem, já tratado acima)
    if (pathname === '/api/products' || pathname === '/.netlify/functions/products') {
      // Já tratado — não deveria chegar aqui, mas por segurança
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let sku;
    if (pathname.startsWith('/api/products/')) {
      sku = decodeURIComponent(pathname.replace('/api/products/', ''));
    } else {
      // /api/product-detail?sku=... or /.netlify/functions/product-detail?sku=...
      const qp = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      sku = qp.sku || '';
    }

    try {
      const event = netlifyEvent(req, null);
      event.queryStringParameters = { ...event.queryStringParameters, sku };
      const result = await productDetailHandler(event);
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Product pricing update: PUT /api/products/:sku/pricing ──
  if ((pathname.startsWith('/api/products/') && pathname.endsWith('/pricing')) ||
      pathname.startsWith('/.netlify/functions/product-pricing-update')) {
    const body = await readBody(req);
    let sku;
    if (pathname.startsWith('/api/products/')) {
      sku = pathname.replace('/api/products/', '').replace('/pricing', '');
    } else {
      const qp = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      sku = qp.sku || '';
    }

    try {
      const event = netlifyEvent(req, body);
      event.queryStringParameters = { ...event.queryStringParameters, sku };
      const result = await productPricingUpdateHandler(event);
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Static files + React SPA fallback
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Serve static file if it exists
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // SPA fallback — serve index.html for all non-API routes
  const spaIndex = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(spaIndex)) {
    try {
      const content = fs.readFileSync(spaIndex);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  } else {
    // No React build yet — fallback to old dashboard
    const oldDashboard = path.join(PUBLIC_DIR, 'dashboard-old.html');
    if (fs.existsSync(oldDashboard)) {
      const content = fs.readFileSync(oldDashboard);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}\n`);
});
