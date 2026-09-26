// Webhook do Evolution no aspen-worker (ADR 0013). Grava mensagem, recibo e
// efeito, responde e só então aplica os efeitos. Depois acorda o ciclo: um recibo
// pode liberar o próximo passo, e um efeito que falhou entra na agenda.
import type { FunctionEvent } from '../_http/types.js';
import { receiveEvolutionWebhook, type EvolutionWebhookOutcome } from '../_modules/evolution-webhook.js';

export interface WorkerEvolutionWebhook {
  handle(event: FunctionEvent): Promise<EvolutionWebhookOutcome>;
  /** Espera o que os webhooks já respondidos deixaram para depois. */
  settle(): Promise<void>;
}

export function createWorkerEvolutionWebhook(dependencies: {
  wake(): void;
  receive?: (event: FunctionEvent) => Promise<EvolutionWebhookOutcome>;
}): WorkerEvolutionWebhook {
  const receive = dependencies.receive || ((event: FunctionEvent) => receiveEvolutionWebhook(event));
  const pending = new Set<Promise<boolean>>();
  return {
    async handle(event) {
      const { response, afterResponse } = await receive(event);
      if (!afterResponse) return { response };
      return {
        response,
        afterResponse: () => {
          const work = afterResponse().finally(() => {
            pending.delete(work);
            dependencies.wake();
          });
          pending.add(work);
          return work;
        },
      };
    },
    async settle() {
      await Promise.allSettled(pending);
    },
  };
}
