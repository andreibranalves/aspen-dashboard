// Servidor HTTP do aspen-worker no VPS (ADR 0013). Não é Function da Vercel e
// não passa pelo pipeline de api/_app: atende só as rotas próprias do worker.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { FunctionEvent } from '../_http/types.js';
import { MAX_EVOLUTION_WEBHOOK_BODY_BYTES, type EvolutionWebhookOutcome } from '../_modules/evolution-webhook.js';
import { isMachineBearerAuthorized } from '../_shared/machine-auth.js';

export interface WorkerServerOptions {
  /** Commit da imagem em execução; o deploy confere que o container novo subiu. */
  sha: string;
  /** Bearer do /wake (WORKER_WAKE_SECRET); sem ele, todo aviso é recusado. */
  wakeSecret?: string;
  /** Chamado a cada aviso aceito. */
  onWake?: () => void;
  /**
   * Webhook do Evolution, que chega pela rede Docker; o Traefik não expõe a rota.
   * `afterResponse` roda depois da resposta.
   */
  evolutionWebhook?: (event: FunctionEvent) => Promise<EvolutionWebhookOutcome>;
  reportError?: (task: string, error: unknown) => void;
}

const WEBHOOK_PATH = '/webhook/evolution';
const ROUTES: Record<string, string> = { '/health': 'GET', '/wake': 'POST', [WEBHOOK_PATH]: 'POST' };

function json(res: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

/** Lê o corpo inteiro; acima de `limit` bytes, descarta e devolve null. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createWorkerServer({
  sha,
  wakeSecret,
  onWake,
  evolutionWebhook,
  reportError,
}: WorkerServerOptions): Server {
  async function webhook(
    req: IncomingMessage,
    res: ServerResponse,
    handle: NonNullable<WorkerServerOptions['evolutionWebhook']>,
  ): Promise<void> {
    const body = await readBody(req, MAX_EVOLUTION_WEBHOOK_BODY_BYTES);
    if (body === null) return json(res, 413, { error: 'Corpo da requisição excede o limite permitido.' });
    const { response, afterResponse } = await handle({
      httpMethod: 'POST',
      headers: req.headers,
      queryStringParameters: {},
      body,
    });
    res.writeHead(response.statusCode ?? 200, response.headers);
    res.end(response.body);
    await afterResponse?.();
  }

  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];
    const method = path === WEBHOOK_PATH && !evolutionWebhook ? undefined : ROUTES[path];
    if (path === WEBHOOK_PATH && evolutionWebhook && req.method === method) {
      webhook(req, res, evolutionWebhook).catch((error: unknown) => {
        reportError?.('webhook do Evolution', error);
        if (!res.headersSent) json(res, 500, { error: 'Erro interno. Tente novamente.' });
      });
      return;
    }
    // Nas outras rotas o corpo nunca é lido: o aviso não carrega dado.
    req.resume();
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
