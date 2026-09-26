// Ciclo do worker ligado ao PostgreSQL e ao Evolution de verdade.
import { createQuotationDeliveryModule } from '../_modules/quotation-delivery-outbox.js';
import {
  dispatchNextApprovedFollowUp,
  type QuotationFollowUpWorkerModule,
} from '../_modules/quotation-follow-up-dispatch.js';
import { createQuotationFollowUpModule } from '../_modules/quotation-follow-ups.js';
import { sweepOperatorMessages } from '../_modules/whatsapp-message-dispatch.js';
import { createWebhookEffectRunners, drainWebhookEffects } from '../_modules/whatsapp-webhook-effects.js';
import {
  recordMessageSweepRun,
  recordQuotationDeliveryWorkerRun,
} from '../_infrastructure/db/repositories/quotation-delivery-diagnostics-repository.js';
import { createPostgresQuotationFollowUpRepository } from '../_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { createPostgresWhatsappContactActivityRepository } from '../_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import { readWorkerSchedule } from '../_infrastructure/db/repositories/worker-schedule-repository.js';
import { getEvolutionConfig } from '../_infrastructure/integrations/evolution/config.js';
import { EFFECTS_BATCH_LIMIT, createWorkerCycle, type WorkerCycleDependencies } from './cycle.js';

export function createLiveWorkerCycle(reportError: WorkerCycleDependencies['reportError']) {
  const followUps = createQuotationFollowUpModule() as unknown as QuotationFollowUpWorkerModule;
  const effectRunners = createWebhookEffectRunners(
    createPostgresWhatsappContactActivityRepository(),
    createPostgresQuotationFollowUpRepository(),
  );
  const { instance } = getEvolutionConfig();

  return createWorkerCycle({
    // Um módulo por lote: o cache de páginas WebP dele só é limpo por envio
    // concluído, e o processo do worker não termina.
    processDue: (limit, stop) => createQuotationDeliveryModule().processDue(limit, stop),
    drainEffects: async (deadlineAt) => {
      if (!instance) return { applied: 0, failed: 0 };
      return drainWebhookEffects({ instance, runners: effectRunners, limit: EFFECTS_BATCH_LIMIT, deadlineAt });
    },
    sweepMessages: (deadlineAt, stop) => sweepOperatorMessages({ deadlineAt, stop }),
    followUps,
    dispatchFollowUp: () => dispatchNextApprovedFollowUp({ followUpModule: followUps }),
    readSchedule: (now) => readWorkerSchedule({ instance, now }),
    recordRun: recordQuotationDeliveryWorkerRun,
    recordSweep: recordMessageSweepRun,
    reportError,
  });
}
