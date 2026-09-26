// Entrada do container aspen-worker (ADR 0013): `node api/_worker/main.js`.
import {
  captureWorkerException,
  flushErrorReports,
} from '../_infrastructure/integrations/sentry/client.js';
import { safeErrorSummary } from '../_shared/safe-error.js';
import { createLiveWorkerCycle } from './live-cycle.js';
import { createWorkerScheduler } from './scheduler.js';
import { createWorkerServer } from './server.js';

// Fixa: o HEALTHCHECK da imagem e o compose do VPS apontam para ela.
const PORT = 8080;
// Abaixo do stop_grace_period (90 s) do compose. Parado, o ciclo não começa
// outro envio, e o passo em curso tem tempo de renderizar (até 60 s) e de
// transportar (15 s): morto no meio do transporte, o envio iria para revisão.
const SHUTDOWN_GRACE_MS = 85_000;

const sha = process.env.ASPEN_WORKER_SHA || 'dev';

function reportError(task: string, error: unknown): void {
  console.error(`[worker] ${task}: ${safeErrorSummary(error)}`);
  captureWorkerException(error, { task });
}

const scheduler = createWorkerScheduler({ runCycle: createLiveWorkerCycle(reportError), reportError });
const server = createWorkerServer({
  sha,
  wakeSecret: process.env.WORKER_WAKE_SECRET,
  onWake: () => scheduler.wake(),
});

async function exitWithError(task: string, error: unknown): Promise<void> {
  console.error(`[worker] ${task}: ${safeErrorSummary(error)}`);
  captureWorkerException(error, { task });
  await flushErrorReports(2_000);
  process.exit(1);
}

// Sem este handler o Node imprimiria a mensagem crua no log. O Sentry já captura
// a exceção sozinho, com a mensagem trocada pelo resumo seguro (beforeSend).
function crash(error: unknown): void {
  console.error(`[worker] erro não tratado: ${safeErrorSummary(error)}`);
  void flushErrorReports(2_000).finally(() => process.exit(1));
}

function shutdown(signal: 'SIGTERM' | 'SIGINT'): void {
  console.log(`[worker] ${signal}: encerrando`);
  server.close();
  void scheduler
    .stop()
    .then(() => flushErrorReports(2_000))
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
}

server.on('error', (error) => void exitWithError('startup', error));
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[worker] ${sha} na porta ${PORT}`);
  // A primeira varredura roda ao subir: o que venceu com o worker parado sai agora.
  scheduler.wake();
});
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
