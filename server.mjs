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
const { handler: extractHandler }   = await import('./netlify/functions/extract.js');
const { handler: orcamentoHandler } = await import('./netlify/functions/orcamento.js');
const { handler: viewHandler }      = await import('./netlify/functions/view.js');

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

  // ── API routes → Netlify functions
  if (pathname === '/api/extract' || pathname === '/.netlify/functions/extract') {
    const body = await readBody(req);
    try {
      const result = await extractHandler(netlifyEvent(req, body));
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
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

  // ── Static files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Fallback para index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

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
});

server.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}\n`);
});
