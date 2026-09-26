// A Vercel não conseguiu acordar o worker do VPS (ADR 0013): o que ficou na
// fila só sai na varredura horária, e o operador precisa saber.
export const WORKER_WAKE_FAILED_EVENT = 'aspen:worker-wake-failed';
export const WORKER_WAKE_FAILED_MESSAGE =
  'O worker de envio não respondeu. O restante sai na próxima varredura, em até 1 h.';

export function noticeWorkerWake(body: unknown): void {
  if (!body || typeof body !== 'object' || (body as { worker_wake?: unknown }).worker_wake !== 'failed') return;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WORKER_WAKE_FAILED_EVENT));
}
