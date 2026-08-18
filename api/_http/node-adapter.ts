// Adapter de transporte para node:http puro (dev local e staging VPS).
// Adapta CORS, OPTIONS, body e query para o contrato do pipeline compartilhado.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelResponseLike } from './types.js';
import { handleApiRequest } from '../_app/handle-request.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const mediaType = String(req.headers['content-type'] || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (mediaType === 'application/x-www-form-urlencoded') {
        resolve(body);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function normalizeQueryParams(url: string): Record<string, string> {
  const params = new URL(url, 'http://localhost').searchParams;
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    // Em query strings, '+' representa espaço; Vercel dev pode codificar '+' como '%2B'.
    result[key] = value.replace(/\+/g, ' ');
  }
  return result;
}

function adaptResponse(res: ServerResponse): VercelResponseLike {
  const adapted: VercelResponseLike = {
    status(code) {
      res.statusCode = code;
      return adapted;
    },
    json(data) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    },
    send(body) {
      if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
      res.end(body as string | Buffer);
    },
    setHeader(key, value) {
      res.setHeader(key, value);
    },
  };
  return adapted;
}

export function createNodeHandler() {
  return async function nodeApiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [key, value] of Object.entries(CORS_HEADERS)) res.setHeader(key, value);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const requestRecord = req as IncomingMessage & { query?: Record<string, string>; body?: unknown };
    requestRecord.query = normalizeQueryParams(req.url || '');
    if (req.method !== 'GET') requestRecord.body = await parseBody(req);
    await handleApiRequest(req, adaptResponse(res));
  };
}
