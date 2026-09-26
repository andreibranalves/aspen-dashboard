// Servidor HTTP do aspen-worker no VPS (ADR 0013). Não é Function da Vercel e
// não passa pelo pipeline de api/_app: atende só as rotas próprias do worker.
import { createServer, type Server } from 'node:http';

export interface WorkerServerOptions {
  /** Commit da imagem em execução; o deploy confere que o container novo subiu. */
  sha: string;
}

export function createWorkerServer({ sha }: WorkerServerOptions): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];
    if (path !== '/health') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rota não encontrada.' }));
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
      res.end(JSON.stringify({ error: 'Método não permitido.' }));
      return;
    }
    // Sem banco: um healthcheck a cada 30 s manteria o Neon acordado.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: 'ok', sha }));
  });
}
