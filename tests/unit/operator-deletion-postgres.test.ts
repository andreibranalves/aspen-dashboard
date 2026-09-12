import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPostgresQuoteDraftManagementRepository } from '../../api/_infrastructure/db/repositories/quote-draft-management-repository.js';
import { createPostgresClientRepository } from '../../api/_infrastructure/db/repositories/client-repository.js';
import { createQuotationIssueRepository, quotationIssueFingerprint } from '../../api/_infrastructure/db/repositories/quotation-issue-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';
import { parsePostgresUrl, postgresIdentity } from '../../scripts/postgres-target.mjs';

const temporary = process.env.CLIENT_CONSOLIDATION_TEMP_DATABASE_URL;
if (temporary) {
  const identity = (value: string) => postgresIdentity(parsePostgresUrl(value));
  if (!process.env.RESTORE_DATABASE_URL || !process.env.PRODUCTION_DATABASE_URL ||
      identity(temporary) !== identity(process.env.RESTORE_DATABASE_URL) || identity(temporary) === identity(process.env.PRODUCTION_DATABASE_URL)) {
    throw new Error('Teste temporário exige restauração isolada de produção.');
  }
}
const url = temporary || resolveDisposableTestDatabaseUrl();

test('operator deletes issued quotation then client, preserving orders and in-flight sends', { skip: !url }, async () => {
  const connection = postgres(url!, { max: 1, prepare: false });
  const db = drizzle(connection, { schema });
  try {
    await connection`CREATE TEMP TABLE clients (id uuid PRIMARY KEY)`;
    await connection`SET search_path = pg_temp`;
    await connection`CREATE TEMP TABLE quotations (id uuid PRIMARY KEY, business_number text, client_id uuid REFERENCES clients(id), quote_lead_id uuid, status text, issued_at timestamptz, loss_reason text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`;
    await connection`CREATE TEMP TABLE quote_revisions (id uuid PRIMARY KEY, quotation_id uuid REFERENCES quotations(id) ON DELETE CASCADE)`;
    await connection`CREATE TEMP TABLE sales_orders (id uuid PRIMARY KEY, client_id uuid REFERENCES clients(id), quotation_id uuid REFERENCES quotations(id), quotation_revision_id uuid REFERENCES quote_revisions(id))`;
    await connection`CREATE TEMP TABLE crm_deals (id uuid PRIMARY KEY, client_id uuid REFERENCES clients(id), quotation_id uuid REFERENCES quotations(id))`;
    await connection`CREATE TEMP TABLE opportunity_next_actions (id uuid PRIMARY KEY, opportunity_id uuid REFERENCES crm_deals(id) ON DELETE RESTRICT, state text)`;
    await connection`CREATE TEMP TABLE quote_leads (id uuid PRIMARY KEY, crm_deal_id uuid REFERENCES crm_deals(id), quotation_id uuid REFERENCES quotations(id))`;
    await connection`CREATE TEMP TABLE quotation_deliveries (id uuid PRIMARY KEY, revision_id uuid REFERENCES quote_revisions(id), state text)`;
    await connection`CREATE TEMP TABLE quotation_delivery_steps (id uuid PRIMARY KEY, delivery_id uuid REFERENCES quotation_deliveries(id) ON DELETE CASCADE)`;
    await connection`CREATE TEMP TABLE quotation_email_deliveries (id uuid PRIMARY KEY, revision_id uuid REFERENCES quote_revisions(id) ON DELETE CASCADE, state text)`;
    await connection`CREATE TEMP TABLE quotation_follow_ups (id uuid PRIMARY KEY, quotation_id uuid REFERENCES quotations(id), delivery_id uuid REFERENCES quotation_deliveries(id), state text)`;
    await connection`CREATE TEMP TABLE quotation_issue_requests (id uuid PRIMARY KEY, idempotency_key uuid UNIQUE, fingerprint text, state text, lease_expires_at timestamptz, public_error text, quotation_id uuid REFERENCES quotations(id), revision_id uuid REFERENCES quote_revisions(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`;
    const client = randomUUID(), quotation = randomUUID(), revision = randomUUID(), deal = randomUUID(), delivery = randomUUID(), key = randomUUID();
    await connection`INSERT INTO clients VALUES (${client})`;
    await connection`INSERT INTO quotations (id,business_number,client_id,status) VALUES (${quotation},'ORC-20260001',${client},'emitido')`;
    await connection`INSERT INTO quote_revisions VALUES (${revision},${quotation})`;
    await connection`INSERT INTO crm_deals VALUES (${deal},${client},${quotation})`;
    await connection`INSERT INTO quote_leads VALUES (${randomUUID()},${deal},${quotation})`;
    await connection`INSERT INTO quotation_deliveries VALUES (${delivery},${revision},'processing')`;
    await connection`INSERT INTO quotation_delivery_steps VALUES (${randomUUID()},${delivery})`;
    await connection`INSERT INTO quotation_follow_ups VALUES (${randomUUID()},${quotation},${delivery},'approved')`;
    await connection`INSERT INTO quotation_email_deliveries VALUES (${randomUUID()},${revision},'accepted')`;
    await connection`INSERT INTO quotation_issue_requests (id,idempotency_key,fingerprint,state,quotation_id,revision_id) VALUES (${randomUUID()},${key},${quotationIssueFingerprint({ revisionId: revision })},'completed',${quotation},${revision})`;
    const quotes = createPostgresQuoteDraftManagementRepository(() => db);
    const customers = createPostgresClientRepository(() => db);
    await assert.rejects(customers.delete(client), /orçamentos ou pedidos/);
    await assert.rejects(quotes.delete(quotation), /envio ou emissão pendente/);
    assert.equal((await connection`SELECT * FROM quotations`).length, 1);
    await connection`UPDATE quotation_deliveries SET state='delivered'`;
    await connection`INSERT INTO sales_orders VALUES (${randomUUID()},${client},${quotation},${revision})`;
    await assert.rejects(quotes.delete(quotation), /pedido vinculado/);
    await connection`DELETE FROM sales_orders`;
    // New unknown dependencies must rollback even after cleanup statements.
    await connection`CREATE TEMP TABLE unknown_reference (quotation_id uuid REFERENCES quotations(id))`;
    await connection`INSERT INTO unknown_reference VALUES (${quotation})`;
    await assert.rejects(quotes.delete(quotation));
    assert.equal((await connection`SELECT * FROM quotation_deliveries`).length, 1);
    await connection`DELETE FROM unknown_reference`;
    await quotes.delete(quotation);
    assert.equal((await connection`SELECT * FROM quotations`).length, 0);
    assert.equal((await connection`SELECT * FROM quote_revisions`).length, 0);
    assert.equal((await connection`SELECT * FROM quotation_follow_ups`).length, 0);
    assert.equal((await connection`SELECT * FROM quotation_delivery_steps`).length, 0);
    const [request] = await connection`SELECT * FROM quotation_issue_requests`;
    assert.equal(request.state, 'completed');
    assert.equal(request.quotation_id, null);
    await assert.rejects(createQuotationIssueRepository(() => db).read(key), /excluído/);
    await assert.rejects(createQuotationIssueRepository(() => db).issue({ idempotencyKey: key, revisionId: revision, concurrencyToken: '2026-01-01' }), /excluído/);
    assert.equal((await connection`SELECT state FROM quotation_issue_requests`)[0].state, 'completed');
    await customers.delete(client);
    assert.equal((await connection`SELECT * FROM clients`).length, 0);
    assert.equal((await connection`SELECT * FROM crm_deals`).length, 0);
    const [lead] = await connection`SELECT * FROM quote_leads`;
    assert.equal(lead.crm_deal_id, null);
    assert.equal(lead.quotation_id, null);
  } finally { await connection.end({ timeout: 5 }); }
});
