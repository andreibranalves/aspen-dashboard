// Aviso da Vercel ao aspen-worker no VPS (ADR 0013). É só uma dica: o worker
// sempre relê o banco, então aviso duplicado ou perdido não muda o resultado.
import { isExternalWritesAllowed } from '../../../_shared/external-writes.js';
import { MIN_MACHINE_SECRET_BYTES } from '../../../_shared/machine-auth.js';
import { safeErrorSummary } from '../../../_shared/safe-error.js';

export const WORKER_WAKE_TIMEOUT_MS = 2_000;

/**
 * `sent`: o worker aceitou o aviso. `failed`: recusado, fora do ar ou não
 * configurado em Production. `disabled`: ambiente sem escrita externa
 * (Preview, local), onde o trabalho fica na fila.
 */
export type WorkerWakeResult = 'sent' | 'failed' | 'disabled';

export interface WorkerWakeDependencies {
  env?: typeof process.env;
  fetchFn?: typeof fetch;
}

function wakeUrl(raw: string | undefined): string | null {
  try {
    const url = new URL(String(raw || '').trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function wakeWorker(dependencies: WorkerWakeDependencies = {}): Promise<WorkerWakeResult> {
  const env = dependencies.env || process.env;
  if (!isExternalWritesAllowed(env)) return 'disabled';
  const url = wakeUrl(env.WORKER_WAKE_URL);
  const secret = String(env.WORKER_WAKE_SECRET || '').trim();
  if (!url || Buffer.byteLength(secret, 'utf8') < MIN_MACHINE_SECRET_BYTES) {
    console.error('[worker-wake] WORKER_WAKE_URL ou WORKER_WAKE_SECRET ausente.');
    return 'failed';
  }
  try {
    const response = await (dependencies.fetchFn || fetch)(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(WORKER_WAKE_TIMEOUT_MS),
    });
    if (response.ok) return 'sent';
    console.error(`[worker-wake] recusado com HTTP ${response.status}`);
    return 'failed';
  } catch (error) {
    console.error(`[worker-wake] ${safeErrorSummary(error)}`);
    return 'failed';
  }
}
