// Quando o aspen-worker precisa acordar de novo (ADR 0013). Cada fonte repete a
// elegibilidade do próprio claim: um horário que o claim não pega manteria o
// Neon acordado sem trabalho.
import { sql } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';

export interface WorkerSchedule {
  /** Há trabalho vencido agora. */
  dueNow: boolean;
  /** Próximo horário futuro em que algo vence. */
  nextAt: Date | null;
}

// Retornos aprovados ficam fora: o ciclo aplica o próprio ritmo a eles.
export async function readWorkerSchedule(
  input: { instance: string; now: Date },
  getDb: () => AppDatabase = getDatabase,
): Promise<WorkerSchedule> {
  const now = input.now.toISOString();
  const rows = (await getDb().execute(sql`
    WITH due(at) AS (
      -- Um lease ainda vivo, deixado por um worker que parou entre dois passos,
      -- adia o próximo passo até vencer.
      SELECT GREATEST(s.next_attempt_at, COALESCE(d.lease_until, s.next_attempt_at))
      FROM quotation_delivery_steps s
      JOIN quotation_deliveries d ON d.id = s.delivery_id
      WHERE s.state IN ('queued', 'retry_scheduled')
        AND s.next_attempt_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM quotation_delivery_steps prior
          WHERE prior.delivery_id = s.delivery_id
            AND prior.position < s.position
            AND (
              prior.state NOT IN ('server_ack', 'delivered', 'read')
              OR prior.provider_message_id IS NULL
            )
        )
      UNION ALL
      -- Lease de um envio em andamento: ao vencer, o claim recupera o passo.
      SELECT d.lease_until
      FROM quotation_deliveries d
      WHERE d.lease_until IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM quotation_delivery_steps s
          WHERE s.delivery_id = d.id AND s.state = 'sending' AND s.provider_message_id IS NULL
        )
      UNION ALL
      -- Prazo de reconciliação: ao vencer, o envio vai para revisão.
      SELECT d.reconciliation_deadline
      FROM quotation_deliveries d
      WHERE d.state = 'reconciling' AND d.reconciliation_deadline IS NOT NULL
      UNION ALL
      SELECT f.due_at FROM quotation_follow_ups f
      WHERE f.state = 'waiting' AND f.due_at IS NOT NULL
      UNION ALL
      SELECT f.lease_until FROM quotation_follow_ups f
      WHERE f.state = 'processing' AND f.lease_until IS NOT NULL
      UNION ALL
      SELECT o.next_attempt_at FROM whatsapp_message_outbox o
      WHERE o.state IN ('queued', 'retry_scheduled')
      UNION ALL
      SELECT o.lease_expires_at FROM whatsapp_message_outbox o
      WHERE o.state = 'dispatching' AND o.lease_expires_at IS NOT NULL
      UNION ALL
      SELECT GREATEST(COALESCE(e.next_attempt_at, e.created_at), e.created_at + interval '60 seconds')
      FROM whatsapp_webhook_effects e
      WHERE e.instance = ${input.instance}
        AND (e.activity_done_at IS NULL OR e.follow_up_done_at IS NULL)
    )
    SELECT
      COALESCE(bool_or(at <= ${now}::timestamptz), false) AS due_now,
      min(at) FILTER (WHERE at > ${now}::timestamptz) AS next_at
    FROM due
  `)) as Array<{ due_now: unknown; next_at: unknown }>;
  const row = rows[0];
  const nextAt = row?.next_at ? new Date(row.next_at as string | Date) : null;
  return {
    dueNow: row?.due_now === true,
    nextAt: nextAt && !Number.isNaN(nextAt.getTime()) ? nextAt : null,
  };
}
