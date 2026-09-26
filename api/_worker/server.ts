// Servidor HTTP do aspen-worker no VPS (ADR 0013). Não é Function da Vercel e
// não passa pelo pipeline de api/_app: atende só as rotas próprias do worker.
import { createServer, type ServerResponse, type Server } from 'node:http';
import { isMachineBearerAuthorized } from '../_shared/machine-auth.js';

export interface WorkerServerOptions {
  /** Commit da imagem em execução; o deploy confere que o container novo subiu. */
  sha: string;
  /** Bearer do /wake (WORKER_WAKE_SECRET); sem ele, todo aviso é recusado. */
  wakeSecret?: string;
  /** Chamado a cada aviso aceito. */
  onWake?: () => void;
}

const ROUTES: Record<string, string> = { '/health': 'GET', '/wake': 'POST' };

function json(res: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function createWorkerServer({ sha, wakeSecret, onWake }: WorkerServerOptions): Server {
  return createServer((req, res) => {
    // O corpo nunca é lido: o aviso não carrega dado.
    req.resume();
    const path = (req.url ?? '/').split('?', 1)[0];
    const method = ROUTES[path];
    if (!method) return json(res, 404, { error: 'Rota não encontrada.' });
    if (req.method !== method) return json(res, 405, { error: 'Método não permitido.' }, { Allow: method });
    if (path === '/health') {
      // Sem banco: um healthcheck a cada 30 s manteria o Neon acordado.
      return json(res, 200, { status: 'ok', sha });
    }
    if (!isMachineBearerAuthorized(req.headers, wakeSecret)) return json(res, 401, { error: 'Não autorizado.' });
    json(res, 202, { status: 'accepted' });
    onWake?.();
  });
}
