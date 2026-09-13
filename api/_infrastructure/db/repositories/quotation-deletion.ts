import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../client.js';

type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export class QuotationDeletionConflictError extends Error {
  readonly statusCode = 409;
}

/** Called under the quotation write lock, in the same transaction as DELETE.
 * Claims committed before these locks are visible as processing and block the
 * operation. Queued follow-ups disappear before another worker can claim them. */
export async function prepareQuotationDeletion(tx: Transaction, id: string): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  await tx.execute(sql`LOCK TABLE sales_orders, quotation_issue_requests,
    quotation_deliveries, quotation_email_deliveries, quotation_follow_ups,
    quotation_follow_up_attempt_history,
    quotation_delivery_steps, crm_deals, quote_leads IN SHARE ROW EXCLUSIVE MODE`);
  const orders = await tx.execute(sql`SELECT id FROM sales_orders WHERE quotation_id = ${id}::uuid
    OR quotation_revision_id IN (SELECT id FROM quote_revisions WHERE quotation_id = ${id}::uuid) LIMIT 1`);
  if (orders.length) throw new QuotationDeletionConflictError('Este orçamento possui pedido vinculado e não pode ser excluído.');
  const busy = await tx.execute(sql`SELECT 1 FROM quotation_deliveries
    WHERE revision_id IN (SELECT id FROM quote_revisions WHERE quotation_id = ${id}::uuid)
      AND state NOT IN ('delivered', 'failed')
    UNION ALL SELECT 1 FROM quotation_email_deliveries
    WHERE revision_id IN (SELECT id FROM quote_revisions WHERE quotation_id = ${id}::uuid) AND state = 'pending'
    UNION ALL SELECT 1 FROM quotation_follow_ups WHERE quotation_id = ${id}::uuid AND state IN ('processing', 'needs_review')
    UNION ALL SELECT 1 FROM quotation_issue_requests
    WHERE (quotation_id = ${id}::uuid OR revision_id IN (SELECT id FROM quote_revisions WHERE quotation_id = ${id}::uuid))
      AND state <> 'completed'`);
  if (busy.length) throw new QuotationDeletionConflictError('Há um envio ou emissão pendente. Conclua ou resolva o envio antes de excluir.');
  await tx.execute(sql`DELETE FROM quotation_follow_up_attempt_history WHERE quotation_id = ${id}::uuid`);
  await tx.execute(sql`DELETE FROM quotation_follow_ups WHERE quotation_id = ${id}::uuid`);
  await tx.execute(sql`DELETE FROM quotation_deliveries WHERE revision_id IN (SELECT id FROM quote_revisions WHERE quotation_id = ${id}::uuid)`);
  // Retain idempotency keys so a delayed retry cannot issue a deleted quotation.
  await tx.execute(sql`UPDATE quotation_issue_requests SET quotation_id = NULL, revision_id = NULL
    WHERE quotation_id = ${id}::uuid OR revision_id IN (SELECT id FROM quote_revisions WHERE quotation_id = ${id}::uuid)`);
  await tx.execute(sql`UPDATE crm_deals SET quotation_id = NULL WHERE quotation_id = ${id}::uuid`);
  await tx.execute(sql`UPDATE quote_leads SET quotation_id = NULL WHERE quotation_id = ${id}::uuid`);
}
