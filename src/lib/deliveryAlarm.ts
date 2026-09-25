import type { DeliveryDiagnostics } from '@/lib/api/whatsappDeliveryDiagnosticsApi';
import { formatDateTime } from './formatting/formatters.ts';

export interface DeliveryAlarm {
  title: string;
  lines: string[];
}

function counted(count: number, singular: string, plural: string): string | null {
  return count > 0 ? `${count} ${count === 1 ? singular : plural}` : null;
}

/**
 * ADR 0013: the async WhatsApp work stopped once for days without anyone
 * noticing. Envios and Canais raise this when the worker is silent or due work
 * sits unclaimed; null means nothing to raise.
 */
export function deliveryAlarm(diagnostics: DeliveryDiagnostics): DeliveryAlarm | null {
  const lines: string[] = [];
  if (diagnostics.workerStale) {
    const lastRunAt = diagnostics.worker?.lastRunAt;
    lines.push(
      lastRunAt
        ? `O worker de envios não roda desde ${formatDateTime(lastRunAt)}.`
        : 'O worker de envios nunca rodou.'
    );
  }
  const { steps, followUps, replies, webhookEffects } = diagnostics.overdue;
  const overdue = [
    counted(steps, 'envio', 'envios'),
    counted(followUps, 'retorno', 'retornos'),
    counted(replies, 'resposta do Atendimento', 'respostas do Atendimento'),
    counted(webhookEffects, 'efeito do webhook', 'efeitos do webhook'),
  ].filter(Boolean);
  if (overdue.length > 0) lines.push(`Parados há mais de 10 min: ${overdue.join(', ')}.`);
  return lines.length > 0 ? { title: 'Envios automáticos parados', lines } : null;
}
