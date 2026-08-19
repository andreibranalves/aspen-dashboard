// Combined app server for aspen-dashboard
// Serves frontend from public/ + API handlers from api/_modules/
// Binds to PORT env var or 8888 (dashboard.srv1633500.hstgr.cloud via Traefik)
// Start: PORT=8888 node scripts/app-server.mjs

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

// Load local config before API handlers are evaluated.
import './load-env-side-effect.mjs';
import { createNodeHandler } from '../api/_http/node-adapter.js';

const PORT = Number(process.env.PORT || 8888);
const PUBLIC_DIR = 'public';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function serveStatic(urlPath, res) {
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  let filePath = normalize(join(PUBLIC_DIR, relativePath));

  // Security: prevent directory traversal
  const publicPrefix = normalize(PUBLIC_DIR + '/');
  const indexPath = normalize(join(PUBLIC_DIR, 'index.html'));
  if (!filePath.startsWith(publicPrefix) && filePath !== indexPath) {
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

const handleApiRequest = createNodeHandler();

const server = createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  // API routes: pipeline compartilhado (auth, rate limit, dispatch, erro normalizado).
  if (urlPath.startsWith('/api/')) {
    await handleApiRequest(req, res);
    return;
  }

  // Static files / SPA
  if (!serveStatic(urlPath, res)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`App server on http://0.0.0.0:${PORT} (frontend: public/, API: pipeline compartilhado)`);
});
