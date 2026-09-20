import * as schema from '../../api/_infrastructure/db/schema.js';

/**
 * FK-safe teardown for tests that seed commercial fixtures (quotations,
 * revisions, deliveries, orders). The disposable database is shared by the
 * whole PostgreSQL lane, and later files delete `quotations` wholesale, so a
 * fixture that leaves rows behind breaks them with a foreign-key error.
 *
 * Deletes in dependency order; every table here is a fixture table that each
 * suite recreates for itself.
 */
export async function clearCommercialFixtures(db: {
  delete: (table: unknown) => Promise<unknown>;
}): Promise<void> {
  await db.delete(schema.quotationFollowUpAttemptHistory);
  await db.delete(schema.quotationFollowUps);
  await db.delete(schema.opportunityDeliveryAnchors);
  await db.delete(schema.opportunityNextActions);
  await db.delete(schema.quotationDeliverySteps);
  await db.delete(schema.quotationDeliveries);
  await db.delete(schema.evolutionReceiptInbox);
  await db.delete(schema.quotationEmailDeliveries);
  await db.delete(schema.salesOrders);
  await db.delete(schema.crmDeals);
  await db.delete(schema.quoteRevisions);
  await db.delete(schema.quotations);
}
