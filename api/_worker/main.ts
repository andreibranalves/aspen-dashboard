// Entrada do container aspen-worker (ADR 0013): `node api/_worker/main.js`.
import {
  captureWorkerException,
  flushErrorReports,
} from '../_infrastructure/integrations/sentry/client.js';
import { safeErrorSummary } from '../_shared/safe-error.js';
import { createWorkerServer } from './server.js';

// Fixa: o HEALTHCHECK da imagem e o compose do VPS apontam para ela.
const PORT = 8080;
const SHUTDOWN_GRACE_MS = 10_000;

const sha = process.env.ASPEN_WORKER_SHA || 'dev';
const server = createWorkerServer({ sha });

async function exitWithError(task: string, error: unknown): Promise<void> {
  console.error(`[worker] ${task}: ${safeErrorSummary(error)}`);
  captureWorkerException(error, { task });
  await flushErrorReports(2_000);
  process.exit(1);
}

function shutdown(signal: 'SIGTERM' | 'SIGINT'): void {
  console.log(`[worker] ${signal}: encerrando`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
}

server.on('error', (error) => void exitWithError('startup', error));
server.listen(PORT, '0.0.0.0', () => console.log(`[worker] ${sha} na porta ${PORT}`));
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
