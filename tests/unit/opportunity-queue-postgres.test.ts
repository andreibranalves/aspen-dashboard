import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import { createPostgresQuoteLeadRepository } from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';
import { createPostgresOpportunityActionRepository } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import { createPostgresCrmDealRepository } from '../../api/_infrastructure/db/repositories/crm-deals-repository.js';
import { createPostgresClientRepository } from '../../api/_infrastructure/db/repositories/client-repository.js';
import {
  BetaCleanupBlockedError,
  createPostgresBetaCleanupRepository,
} from '../../api/_infrastructure/db/repositories/beta-cleanup-repository.js';
import { ClientDuplicateError } from '../../api/_modules/client-schema.js';
import { createCoreHandler as createClientDetailHandler } from '../../api/_modules/client-detail.js';
import * as schemaNamespace from '../../api/_infrastructure/db/schema.js';
import {
  clients,
  crmDeals,
  opportunityNextActions,
  quoteLeads,
  whatsappContactActivity,
} from '../../api/_infrastructure/db/schema.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const databaseSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; the opportunity queue adapter must run against a disposable PostgreSQL.';

const NOW = new Date('2026-09-11T12:00:00.000Z');

let sql: postgres.Sql;
let db: AppDatabase;

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  sql = postgres(TEST_DATABASE_URL, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  db = drizzle(sql, { schema: schemaNamespace });
  await migrate(db, { migrationsFolder });
});

test.after(async () => {
  if (!sql) return;
  await sql.end({ timeout: 5 });
});

/** Opportunities are removable, but their action history is not: delete both explicitly. */
async function clearIngestedLeads(leadIds: string[], clientIds: string[] = []): Promise<void> {
  if (leadIds.length === 0) return;
  await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id IN (
    SELECT id FROM crm_deals WHERE quote_lead_id = ANY(${leadIds}::uuid[])
  )`;
  await sql`UPDATE quote_leads SET crm_deal_id = NULL WHERE id = ANY(${leadIds}::uuid[])`;
  await sql`DELETE FROM crm_deals WHERE quote_lead_id = ANY(${leadIds}::uuid[])`;
  await sql`DELETE FROM quote_leads WHERE id = ANY(${leadIds}::uuid[])`;
  if (clientIds.length) await sql`DELETE FROM clients WHERE id = ANY(${clientIds}::uuid[])`;
}

/** Existence check that works for either the clients or crm_deals table. */
async function hasRow(table: typeof clients | typeof crmDeals, id: string): Promise<boolean> {
  const isClient = table === clients;
  const statement = isClient
    ? sql`SELECT 1 FROM clients WHERE id = ${id}::uuid`
    : sql`SELECT 1 FROM crm_deals WHERE id = ${id}::uuid`;
  const rows = await statement;
  return rows.length > 0;
}

function leadRepository(clock: { current: Date }) {
  return createPostgresQuoteLeadRepository(() => db, { now: () => new Date(clock.current) });
}

const leadInput = (externalId: string, overrides: Record<string, unknown> = {}) => ({
  source: 'whatsapp',
  externalId,
  nome: 'Cliente Sintético',
  telefone: '21999990000',
  pedidoTexto: 'Cangas 100 unidades',
  ...overrides,
});

test(
  'ingesting a lead creates one opportunity with its demand and one active first-contact action',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert(leadInput('conv-queue-1'));
    try {
      assert.ok(record.crmDealId, 'the lead must be linked to its opportunity');

      const queue = createPostgresOpportunityActionRepository(() => db);
      const page = await queue.listActive();

      assert.equal(page.total, 1);
      const [action] = page.data;
      assert.equal(action.opportunityId, record.crmDealId);
      assert.equal(action.kind, 'first_contact');
      assert.equal(action.reasonCode, 'new_lead');
      assert.equal(action.origin, 'automatic');
      assert.equal(action.state, 'active');
      assert.equal(action.dueAt, NOW.toISOString(), 'first contact is due immediately');
      assert.equal(action.demandSummary, 'Cangas 100 unidades');
      assert.equal(action.contactName, 'Cliente Sintético');
      assert.equal(action.contactPhone, '5521999990000');
      assert.equal(action.clientId, null, 'a WhatsApp lead is not a client row yet');
      assert.equal(action.followUpStage, 0);
    } finally {
      await clearIngestedLeads([record.id]);
    }
  }
);

test(
  'repeating the same lead request keeps one opportunity and one active action',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const first = await leads.upsert(leadInput('conv-queue-repeat'));
    try {
      const repeat = await leads.upsert(
        leadInput('conv-queue-repeat', { pedidoTexto: 'Cangas 100 unidades\nPrazo: setembro' })
      );
      assert.equal(first.id, repeat.id);
      assert.equal(first.crmDealId, repeat.crmDealId);

      const opportunities = await db
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(eq(crmDeals.quoteLeadId, first.id));
      assert.equal(opportunities.length, 1, 'exactly one opportunity per lead');

      const actions = await sql<{ total: string; state: string }[]>`
        SELECT count(*)::text AS total, min(state) AS state
        FROM opportunity_next_actions WHERE opportunity_id = ${first.crmDealId}::uuid
      `;
      assert.equal(actions[0].total, '1');
      assert.equal(actions[0].state, 'active');

      const page = await createPostgresOpportunityActionRepository(() => db).listActive({
        pageSize: 100,
      });
      assert.equal(page.total, 1);
      assert.equal(
        page.data[0].demandSummary,
        'Cangas 100 unidades',
        'a repeat never rewrites the initial demand of the opportunity'
      );
      assert.equal(
        repeat.pedidoTexto,
        'Cangas 100 unidades\nPrazo: setembro',
        'the legacy lead record still merges the newest request text'
      );
    } finally {
      await clearIngestedLeads([first.id]);
    }
  }
);

test(
  'a retry that updates the request text keeps one opportunity and the initial demand',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const first = await leads.upsert(
      leadInput('conv-queue-same-conversation', { pedidoTexto: 'Cangas 100' })
    );
    try {
      // Same admitted demand (retry), only the accumulated text grows. This is
      // NOT a second independent demand: that requires its own demandId.
      const second = await leads.upsert(
        leadInput('conv-queue-same-conversation', {
          pedidoTexto: 'Toalhas 20 unidades com bordado e prazo estendido para outubro',
        })
      );

      assert.equal(second.id, first.id);
      assert.equal(second.crmDealId, first.crmDealId);
      const opportunities = await db
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(eq(crmDeals.quoteLeadId, first.id));
      assert.equal(
        opportunities.length,
        1,
        'a contact identity never becomes a demand key; a second demand needs operator UX (#241)'
      );

      const page = await createPostgresOpportunityActionRepository(() => db).listActive({
        pageSize: 100,
      });
      assert.equal(page.total, 1);
      assert.equal(page.data[0].demandSummary, 'Cangas 100', 'the initial demand is preserved');
    } finally {
      await clearIngestedLeads([first.id]);
    }
  }
);

test(
  'removing a client with action history is blocked and removes nothing',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert(leadInput('conv-queue-deleted-client'));
    const [client] = await db
      .insert(clients)
      .values({ id: randomUUID(), nome: 'Cliente Removido' })
      .returning();
    await db
      .update(crmDeals)
      .set({ clientId: client.id })
      .where(eq(crmDeals.id, record.crmDealId!));

    try {
      const queue = createPostgresOpportunityActionRepository(() => db);
      assert.equal((await queue.listActive({ pageSize: 100 })).total, 1);

      // Real removal flow: the client delete path must fail atomically while
      // the opportunity still owns durable commercial action history.
      await assert.rejects(
        () => createPostgresClientRepository(() => db).delete(client.id),
        (error: unknown) =>
          error instanceof ClientDuplicateError &&
          /histórico/i.test(String((error as Error).message))
      );

      assert.equal(
        await hasRow(clients, client.id),
        true,
        'the client must still exist after the blocked removal'
      );
      assert.equal(
        await hasRow(crmDeals, record.crmDealId!),
        true,
        'the opportunity must still exist: nothing is partially deleted'
      );
      const [link] = await db
        .select({ crmDealId: quoteLeads.crmDealId })
        .from(quoteLeads)
        .where(eq(quoteLeads.id, record.id));
      assert.equal(link.crmDealId, record.crmDealId, 'the lead link must stay intact');

      const history = await sql<{ state: string; opportunity_id: string }[]>`
        SELECT state, opportunity_id FROM opportunity_next_actions
        WHERE opportunity_id = ${record.crmDealId!}::uuid
      `;
      assert.equal(history.length, 1, 'the action history is preserved');
      assert.equal(history[0].state, 'active');
      assert.equal(
        history[0].opportunity_id,
        record.crmDealId,
        'history keeps the identity of the demand it belonged to'
      );
    } finally {
      await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id = ${record.crmDealId!}::uuid`;
      await clearIngestedLeads([record.id], [client.id]);
    }
  }
);

test(
  'removing a client without commercial history still works',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const [client] = await db
      .insert(clients)
      .values({ id: randomUUID(), nome: 'Cliente Sem Histórico' })
      .returning();
    try {
      await createPostgresClientRepository(() => db).delete(client.id);
      assert.equal(await hasRow(clients, client.id), false, 'the removal still succeeds');
    } finally {
      if (await hasRow(clients, client.id)) {
        await db.delete(clients).where(eq(clients.id, client.id));
      }
    }
  }
);

test(
  'directly deleting an opportunity with action history is blocked by the database',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert(leadInput('conv-queue-direct-delete'));
    try {
      // Detach the lead link so the pre-existing quote_leads FK cannot mask the
      // reference this round introduced: the durable action history is the guard.
      await db.update(quoteLeads).set({ crmDealId: null }).where(eq(quoteLeads.id, record.id));

      await assert.rejects(
        () => db.delete(crmDeals).where(eq(crmDeals.id, record.crmDealId!)),
        (error: unknown) => {
          // Drizzle wraps the driver error; the PostgreSQL detail lives in the cause chain.
          let current: unknown = error;
          while (current instanceof Error) {
            if (
              /opportunity_next_actions_opportunity_id_crm_deals_id_fk|violates foreign key/i.test(
                current.message
              )
            ) {
              return true;
            }
            current = current.cause;
          }
          return false;
        },
        'the RESTRICT reference blocks the opportunity removal'
      );
      assert.equal(await hasRow(crmDeals, record.crmDealId!), true);
      const [{ total }] = await sql<{ total: string }[]>`
        SELECT count(*)::text AS total FROM opportunity_next_actions
        WHERE opportunity_id = ${record.crmDealId!}::uuid
      `;
      assert.equal(total, '1', 'the action history is preserved');
    } finally {
      await clearIngestedLeads([record.id]);
    }
  }
);

test(
  'beta cleanup fails closed for opportunities with action history',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert(leadInput('conv-queue-cleanup-blocked'));
    try {
      const cleanup = createPostgresBetaCleanupRepository(() => db);
      const plan = await cleanup.plan([{ type: 'deal', id: record.crmDealId! }]);
      assert.equal(
        plan.blockers.some(
          (blocker) => blocker.type === 'commercial_history' && blocker.id === record.crmDealId
        ),
        true,
        'the plan surfaces the durable history as a blocker'
      );
      await assert.rejects(
        () => cleanup.apply([{ type: 'deal', id: record.crmDealId! }]),
        (error: unknown) =>
          error instanceof BetaCleanupBlockedError &&
          /histórico/i.test(String((error as Error).message))
      );
      assert.equal(
        await hasRow(crmDeals, record.crmDealId!),
        true,
        'nothing is removed when the cleanup is blocked'
      );
    } finally {
      await clearIngestedLeads([record.id]);
    }
  }
);

test(
  'DELETE /client-detail returns a safe Portuguese conflict and keeps the data',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert(leadInput('conv-queue-http-delete'));
    const [client] = await db
      .insert(clients)
      .values({ id: randomUUID(), nome: 'Cliente HTTP' })
      .returning();
    await db
      .update(crmDeals)
      .set({ clientId: client.id })
      .where(eq(crmDeals.id, record.crmDealId!));

    try {
      const handler = createClientDetailHandler({
        repository: createPostgresClientRepository(() => db),
      });
      const result = await handler({
        httpMethod: 'DELETE',
        headers: {},
        queryStringParameters: { name: client.id },
        body: '',
      });

      assert.equal(result.statusCode, 409);
      const body = JSON.parse(result.body || '{}');
      assert.match(String(body.error), /histórico/i);
      assert.doesNotMatch(String(body.error), /opportunity_next_actions|23503|postgres/i);
      assert.equal(await hasRow(clients, client.id), true, 'nothing was partially deleted');
      assert.equal(await hasRow(crmDeals, record.crmDealId!), true);
      const [{ total }] = await sql<{ total: string }[]>`
        SELECT count(*)::text AS total FROM opportunity_next_actions
        WHERE opportunity_id = ${record.crmDealId!}::uuid
      `;
      assert.equal(total, '1', 'the action history is preserved');
    } finally {
      await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id = ${record.crmDealId!}::uuid`;
      await clearIngestedLeads([record.id], [client.id]);
    }
  }
);

test(
  'terminal opportunities leave the active queue',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert(leadInput('conv-queue-terminal'));
    try {
      const queue = createPostgresOpportunityActionRepository(() => db);
      assert.equal((await queue.listActive({ pageSize: 100 })).total, 1);

      const deals = createPostgresCrmDealRepository(() => db, {
        now: () => new Date(clock.current),
      });
      await deals.updateStatus(record.crmDealId!, { status: 'Perdido' });
      assert.equal(
        (await queue.listActive({ pageSize: 100 })).total,
        0,
        'a lost opportunity must not expose pending first contact'
      );

      await db
        .update(crmDeals)
        .set({ status: 'Pedido Fechado' })
        .where(eq(crmDeals.id, record.crmDealId!));
      assert.equal(
        (await queue.listActive({ pageSize: 100 })).total,
        0,
        'a converted opportunity must not expose pending first contact'
      );
    } finally {
      await clearIngestedLeads([record.id]);
    }
  }
);

test(
  'concurrent requests for the same lead still produce one opportunity and one active action',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => leads.upsert(leadInput('conv-queue-concurrent')))
    );
    const leadId = results[0].id;
    try {
      assert.equal(new Set(results.map((row) => row.id)).size, 1);
      assert.equal(new Set(results.map((row) => row.crmDealId)).size, 1);
      assert.equal(new Set(results.map((row) => row.created)).size, 2);

      const [{ total }] = await sql<{ total: string }[]>`
        SELECT count(*)::text AS total FROM opportunity_next_actions
        WHERE opportunity_id = ${results[0].crmDealId}::uuid
      `;
      assert.equal(total, '1');
    } finally {
      await clearIngestedLeads([leadId]);
    }
  }
);

test(
  'separate demands from the same phone stay separate opportunities with separate actions',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const first = await leads.upsert(
      leadInput('conv-queue-demand-a', { pedidoTexto: 'Cangas 100' })
    );
    const second = await leads.upsert(
      leadInput('conv-queue-demand-b', { pedidoTexto: 'Toalhas 20' })
    );
    try {
      assert.notEqual(first.crmDealId, second.crmDealId, 'phone equality never fuses demands');

      const page = await createPostgresOpportunityActionRepository(() => db).listActive({
        pageSize: 100,
      });
      const summaries = page.data.map((row) => row.demandSummary).sort();
      assert.deepEqual(summaries, ['Cangas 100', 'Toalhas 20']);
      assert.equal(new Set(page.data.map((row) => row.opportunityId)).size, 2);
    } finally {
      await clearIngestedLeads([first.id, second.id]);
    }
  }
);

test(
  'the queue lists only active actions, in due order, and exposes the client when linked',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const firstDue = await leads.upsert(
      leadInput('conv-queue-first-due', { pedidoTexto: 'Demanda anterior' })
    );
    clock.current = new Date(NOW.getTime() + 3_600_000);
    const laterDue = await leads.upsert(
      leadInput('conv-queue-later-due', { pedidoTexto: 'Demanda posterior' })
    );

    const [client] = await db
      .insert(clients)
      .values({ id: randomUUID(), nome: 'Empresa Sintética' })
      .returning();
    await db
      .update(crmDeals)
      .set({ clientId: client.id })
      .where(eq(crmDeals.id, firstDue.crmDealId!));

    try {
      const queue = createPostgresOpportunityActionRepository(() => db);
      const page = await queue.listActive({ pageSize: 100 });

      assert.deepEqual(
        page.data.map((row) => row.demandSummary),
        ['Demanda anterior', 'Demanda posterior'],
        'the earliest due action comes first'
      );
      const [linked] = page.data;
      assert.equal(linked.clientId, client.id);
      assert.equal(linked.clientName, 'Empresa Sintética');
      const [unlinked] = page.data.filter((row) => row.opportunityId === laterDue.crmDealId);
      assert.equal(unlinked.clientId, null);
      assert.equal(unlinked.clientName, null);

      await db
        .update(opportunityNextActions)
        .set({ state: 'superseded', updatedAt: new Date(NOW.getTime() + 7_200_000) })
        .where(
          and(
            eq(opportunityNextActions.opportunityId, laterDue.crmDealId!),
            eq(opportunityNextActions.state, 'active')
          )
        );

      const afterSupersede = await queue.listActive({ pageSize: 100 });
      assert.equal(afterSupersede.total, 1, 'a superseded action leaves the active queue');

      const history = await sql<{ state: string }[]>`
        SELECT state FROM opportunity_next_actions WHERE opportunity_id = ${laterDue.crmDealId}::uuid
        ORDER BY created_at
      `;
      assert.deepEqual(
        history.map((row) => row.state),
        ['superseded'],
        'history is preserved'
      );
    } finally {
      await clearIngestedLeads([firstDue.id, laterDue.id], [client.id]);
    }
  }
);

test(
  'a lead without demand still records the opportunity without inventing a demand summary',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert({
      source: 'whatsapp',
      externalId: 'conv-queue-no-demand',
      nome: 'Contato Sem Pedido',
      telefone: '21999991111',
    });
    try {
      const [opportunity] = await db
        .select({ demandSummary: crmDeals.demandSummary })
        .from(crmDeals)
        .where(eq(crmDeals.id, record.crmDealId!));
      assert.equal(opportunity.demandSummary, null);

      const page = await createPostgresOpportunityActionRepository(() => db).listActive({
        pageSize: 100,
      });
      assert.equal(page.data.length, 1);
      assert.equal(page.data[0].demandSummary, null);
      assert.equal(page.data[0].contactName, 'Contato Sem Pedido');
      assert.equal(page.data[0].contactPhone, '5521999991111');
    } finally {
      await clearIngestedLeads([record.id]);
    }
  }
);

test(
  'the site submission path reaches the same queue without duplicating on retry',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const submission = {
      source: 'site_form' as const,
      externalId: 'siteQuote.018f47a8-7b6c-7d3e-8f90-123456789abc',
      payloadFingerprint: 'a'.repeat(64),
      originalCreatedAt: '2026-09-11T11:00:00.000Z',
      nome: 'Cliente do Site',
      email: 'synthetic@example.invalid',
      whatsapp: '21988887777',
      produto: 'Bolsas',
      quantidade: '50',
    };
    const first = await leads.ingestSiteSubmission(submission);
    try {
      const retry = await leads.ingestSiteSubmission(submission);
      assert.equal(retry.created, false);
      assert.equal(retry.crmDealId, first.crmDealId);
      assert.match(retry.pedidoTexto, /Bolsas/);

      const page = await createPostgresOpportunityActionRepository(() => db).listActive({
        pageSize: 100,
      });
      assert.equal(page.total, 1);
      assert.match(page.data[0].demandSummary!, /Bolsas/);
      assert.equal(page.data[0].contactEmail, 'synthetic@example.invalid');
    } finally {
      await clearIngestedLeads([first.id]);
    }
  }
);

test(
  'pagination exposes every active action across stable pages with a matching total',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const leadIds: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      clock.current = new Date(NOW.getTime() + index * 1000);
      const record = await leads.upsert(leadInput(`conv-queue-page-${index}`));
      leadIds.push(record.id);
    }
    try {
      const queue = createPostgresOpportunityActionRepository(() => db);
      const first = await queue.listActive({ page: 1, pageSize: 25 });
      assert.equal(first.total, 26);
      assert.equal(first.page, 1);
      assert.equal(first.data.length, 25);

      const second = await queue.listActive({ page: 2, pageSize: 25 });
      assert.equal(second.total, 26);
      assert.equal(second.page, 2);
      assert.equal(second.data.length, 1);

      const ids = [...first.data, ...second.data].map((row) => row.actionId);
      assert.equal(new Set(ids).size, 26, 'each action appears on exactly one page');
      assert.equal(ids.length, second.total, 'pages and total describe the same snapshot');
    } finally {
      await clearIngestedLeads(leadIds);
    }
  }
);

test(
  'a request beyond the last page is clamped to the remaining work',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const leadIds: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      clock.current = new Date(NOW.getTime() + index * 1000);
      const record = await leads.upsert(leadInput(`conv-queue-clamp-${index}`));
      leadIds.push(record.id);
    }
    try {
      const queue = createPostgresOpportunityActionRepository(() => db);
      const page = await queue.listActive({ page: 4, pageSize: 25 });
      assert.equal(page.total, 26);
      assert.equal(page.page, 2, 'the requested page clamps to the last valid one');
      assert.equal(page.data.length, 1, 'the remaining work is returned, not an empty page');

      // Shrinking the queue below the requested page must still return rows.
      const removeLast = leadIds.at(-1)!;
      await clearIngestedLeads([removeLast]);
      const shrunk = await queue.listActive({ page: 2, pageSize: 25 });
      assert.equal(shrunk.total, 25);
      assert.equal(shrunk.page, 1, 'the previously valid page no longer exists');
      assert.equal(shrunk.data.length, 25, 'the valid page is reloaded with its rows');
    } finally {
      await clearIngestedLeads(leadIds.slice(0, -1));
    }
  }
);

test(
  'a listActive response is internally consistent when the queue mutates while the request is in flight',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const leadIds: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      clock.current = new Date(NOW.getTime() + index * 1000);
      const record = await leads.upsert(leadInput(`conv-queue-inflight-${index}`));
      leadIds.push(record.id);
    }
    // Test-only instrumentation: after the FIRST statement of the request
    // resolves, the mutation commits before any subsequent statement could
    // read. A correct single-statement implementation therefore completes its
    // only read before the mutation (one consistent snapshot); a torn
    // implementation that reads total and rows in separate statements gets the
    // total before and the rows after, and the assertions below reject it. No
    // sleeps and no production hooks.
    const removedLeadId = leadIds.at(-1)!;
    let statements = 0;
    const databaseWithHook = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== 'execute') return Reflect.get(target, property, receiver);
        return async (query) => {
          statements += 1;
          const result = await target.execute(query);
          if (statements === 1) await clearIngestedLeads([removedLeadId]);
          return result;
        };
      },
    });
    try {
      const queue = createPostgresOpportunityActionRepository(() => databaseWithHook);
      const allActions = await sql<{ id: string }[]>`
        SELECT id FROM opportunity_next_actions WHERE state = 'active'
      `;
      const expectedIds = new Set(allActions.map((row) => row.id));
      assert.equal(expectedIds.size, 26);

      // The request is in flight when the removal commits: the response must
      // describe exactly one queue state (its own read), never a blend.
      const page = await queue.listActive({ page: 2, pageSize: 25 });
      assert.equal(statements, 1, 'a single statement serves the whole page and its total');
      assert.equal(page.total, 26, 'the read happened before the removal committed');
      assert.equal(page.page, 2);
      assert.equal(page.data.length, 1, 'the served rows match the reported total and page');
      const ids = page.data.map((row) => row.actionId);
      assert.equal(new Set(ids).size, ids.length, 'no duplicate rows within one response');
      assert.equal(
        ids.every((id) => expectedIds.has(id)),
        true,
        'every served row belongs to the pre-mutation snapshot the request read'
      );

      // The mutation is durable: the next request sees the smaller queue and
      // clamps the now-invalid page to the remaining work.
      const next = await createPostgresOpportunityActionRepository(() => db).listActive({
        page: 2,
        pageSize: 25,
      });
      assert.equal(next.total, 25);
      assert.equal(next.page, 1, 'the shortened queue clamps the requested page');
      assert.equal(next.data.length, 25);
    } finally {
      await clearIngestedLeads(leadIds.slice(0, -1));
    }
  }
);

test(
  'a queue smaller than one page reports page 1 with a consistent total',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert(leadInput('conv-queue-small'));
    try {
      const queue = createPostgresOpportunityActionRepository(() => db);
      const page = await queue.listActive({ page: 7, pageSize: 25 });
      assert.equal(page.total, 1);
      assert.equal(page.page, 1);
      assert.equal(page.data.length, 1);
    } finally {
      await clearIngestedLeads([record.id]);
    }
  }
);

test(
  'commercial queue prioritizes urgency and context before pagination and supports its cuts',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const created: string[] = [];
    const seed = async (label: string, dueAt: string) => {
      const record = await leads.upsert(
        leadInput(`conv-queue-priority-${label}`, { pedidoTexto: `Demanda ${label}` })
      );
      created.push(record.id);
      await db
        .update(opportunityNextActions)
        .set({
          dueAt: new Date(dueAt),
          dueDate: dueAt.slice(0, 10),
          dueTime: '09:00',
        })
        .where(eq(opportunityNextActions.opportunityId, record.crmDealId!));
      return record;
    };

    const urgent = await seed('urgente-futuro', '2026-09-20T12:00:00.000Z');
    const agreed = await seed('compromisso-atrasado', '2026-09-01T12:00:00.000Z');
    const awaiting = await seed('aguarda-resposta', '2026-09-20T12:00:00.000Z');
    const firstContact = await seed('primeiro-atendimento-atrasado', '2026-09-02T12:00:00.000Z');
    const otherOverdue = await seed('retorno-atrasado', '2026-09-03T12:00:00.000Z');
    const today = await seed('hoje', '2026-09-11T15:00:00.000Z');
    const scheduled = await seed('agendado', '2026-09-22T12:00:00.000Z');
    const records = [urgent, agreed, awaiting, firstContact, otherOverdue, today, scheduled];

    try {
      await db
        .update(crmDeals)
        .set({ isUrgent: true })
        .where(eq(crmDeals.id, urgent.crmDealId!));
      await db
        .update(opportunityNextActions)
        .set({ kind: 'agreed_commitment', reason: 'Compromisso confirmado' })
        .where(eq(opportunityNextActions.opportunityId, agreed.crmDealId!));
      await db
        .update(opportunityNextActions)
        .set({ kind: 'review', reason: 'Retorno comercial' })
        .where(eq(opportunityNextActions.opportunityId, otherOverdue.crmDealId!));
      for (const record of [today, scheduled]) {
        await db
          .update(opportunityNextActions)
          .set({ kind: 'review', reason: 'Retorno comercial' })
          .where(eq(opportunityNextActions.opportunityId, record.crmDealId!));
      }
      await db.insert(whatsappContactActivity).values({
        id: randomUUID(),
        instance: 'priority-test',
        providerConversationId: 'conv-queue-priority-aguarda-resposta',
        lastInboundAt: new Date('2026-09-11T11:30:00.000Z'),
        lastInboundProviderMessageId: 'inbound-priority',
        lastOutboundAt: new Date('2026-09-10T12:00:00.000Z'),
        lastOutboundProviderMessageId: 'outbound-priority',
        canonicalPhone: '5521999900000',
        identityStatus: 'verified',
        createdAt: NOW,
        updatedAt: NOW,
      });

      const queue = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date(clock.current),
      });
      const firstPage = await queue.listActive({ page: 1, pageSize: 4 });
      assert.equal(firstPage.total, 7);
      assert.deepEqual(firstPage.data.map((row) => row.demandSummary), [
        'Demanda urgente-futuro',
        'Demanda compromisso-atrasado',
        'Demanda aguarda-resposta',
        'Demanda primeiro-atendimento-atrasado',
      ]);
      const responseRow = firstPage.data[2];
      assert.equal(responseRow.contactContext.status, 'available');
      assert.equal(responseRow.contactContext.lastContactAt, '2026-09-11T11:30:00.000Z');
      assert.equal(responseRow.contactContext.lastContactDirection, 'inbound');
      assert.equal(responseRow.whatsappHref, 'https://wa.me/5521999990000');

      const ordered = await queue.listActive({ pageSize: 100 });
      assert.deepEqual(ordered.data.map((row) => row.demandSummary), [
        'Demanda urgente-futuro',
        'Demanda compromisso-atrasado',
        'Demanda aguarda-resposta',
        'Demanda primeiro-atendimento-atrasado',
        'Demanda retorno-atrasado',
        'Demanda hoje',
        'Demanda agendado',
      ]);

      const overdue = await queue.listActive({ filter: 'overdue', pageSize: 100 });
      assert.deepEqual(overdue.data.map((row) => row.demandSummary), [
        'Demanda compromisso-atrasado',
        'Demanda primeiro-atendimento-atrasado',
        'Demanda retorno-atrasado',
      ]);
      assert.equal((await queue.listActive({ filter: 'today', pageSize: 100 })).total, 1);
      assert.equal((await queue.listActive({ filter: 'scheduled', pageSize: 100 })).total, 3);
      assert.equal((await queue.listActive({ filter: 'closed', pageSize: 100 })).total, 0);

      for (const record of records) {
        await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id = ${record.crmDealId!}::uuid`;
        await sql`UPDATE quote_leads SET crm_deal_id = NULL WHERE id = ${record.id}::uuid`;
        await sql`DELETE FROM crm_deals WHERE id = ${record.crmDealId!}::uuid`;
        await sql`DELETE FROM quote_leads WHERE id = ${record.id}::uuid`;
      }
      await sql`DELETE FROM whatsapp_contact_activity WHERE instance = 'priority-test'`;
      created.length = 0;
    } finally {
      for (const leadId of created) await clearIngestedLeads([leadId]);
      await sql`DELETE FROM whatsapp_contact_activity WHERE instance = 'priority-test'`;
    }
  }
);

test(
  'ambiguous inbound WhatsApp identity stays in review and cannot prioritize a response',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const records: Array<{ leadId: string; opportunityId: string; externalId: string }> = [];
    const instance = 'identity-review-test';

    try {
      for (const identityStatus of ['unresolved', 'conflict'] as const) {
        const externalId = `conv-queue-identity-${identityStatus}`;
        const record = await leads.upsert(
          leadInput(externalId, { pedidoTexto: `Identidade ${identityStatus}` })
        );
        records.push({ leadId: record.id, opportunityId: record.crmDealId!, externalId });
        await db
          .update(opportunityNextActions)
          .set({
            kind: 'customer_contact',
            reason: 'Aguardar resposta',
            dueAt: new Date('2026-09-20T12:00:00.000Z'),
            dueDate: '2026-09-20',
            dueTime: '09:00',
          })
          .where(eq(opportunityNextActions.opportunityId, record.crmDealId!));
        await db.insert(whatsappContactActivity).values({
          id: randomUUID(),
          instance,
          providerConversationId: externalId,
          lastInboundAt: new Date('2026-09-11T11:30:00.000Z'),
          lastInboundProviderMessageId: `${identityStatus}-inbound`,
          lastOutboundAt: null,
          lastOutboundProviderMessageId: null,
          canonicalPhone: '5521999990000',
          identityStatus,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }

      const rows = await createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date(clock.current),
      }).listActive({ pageSize: 100 });

      assert.equal(rows.total, 2);
      for (const record of records) {
        const row = rows.data.find((item) => item.opportunityId === record.opportunityId);
        assert.ok(row);
        assert.equal(row.contactContext.status, 'review');
        assert.equal(row.contactContext.lastContactAt, null);
        assert.equal(row.contactContext.lastContactDirection, null);
        assert.equal(row.priority, 7, 'an ambiguous inbound activity cannot be priority 3');
      }
    } finally {
      await sql`DELETE FROM whatsapp_contact_activity WHERE instance = ${instance}`;
      for (const record of records) await clearIngestedLeads([record.leadId]);
    }
  }
);

test(
  'closed queue keeps one latest action per terminal opportunity and exposes terminal context',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const records: Array<{
      leadId: string;
      opportunityId: string;
      successorActionId: string;
      terminalAt: Date;
      terminalReason: string;
    }> = [];
    const queue = createPostgresOpportunityActionRepository(() => db, {
      now: () => new Date(clock.current),
    });

    try {
      for (const [index, terminalAt] of [
        new Date('2026-09-11T14:00:00.000Z'),
        new Date('2026-09-11T16:00:00.000Z'),
      ].entries()) {
        const record = await leads.upsert(
          leadInput(`conv-queue-closed-${index + 1}`, {
            pedidoTexto: `Oportunidade encerrada ${index + 1}`,
          })
        );
        const [initial] = await db
          .select()
          .from(opportunityNextActions)
          .where(eq(opportunityNextActions.opportunityId, record.crmDealId!));
        const successor = await queue.completeAction({
          actionId: initial.id,
          expectedVersion: initial.version,
          actor: 'authenticated-operator',
          now: new Date(terminalAt.getTime() - 60 * 60 * 1000),
          successor: {
            kind: 'review',
            dueDate: '2026-09-20',
            dueTime: '09:00',
            reason: `Ação ativa após fechamento ${index + 1}`,
          },
        });
        assert.ok(successor.successor);
        const successorActionId = successor.successor.actionId;
        await db
          .update(opportunityNextActions)
          .set({ updatedAt: new Date(terminalAt.getTime() - 30 * 60 * 1000) })
          .where(eq(opportunityNextActions.id, successorActionId));
        const terminalReason = `Motivo terminal ${index + 1}`;
        await db
          .update(crmDeals)
          .set({ status: 'Perdido', lostReason: terminalReason, updatedAt: terminalAt })
          .where(eq(crmDeals.id, record.crmDealId!));
        records.push({
          leadId: record.id,
          opportunityId: record.crmDealId!,
          successorActionId,
          terminalAt,
          terminalReason,
        });
      }

      const firstPage = await queue.listActive({ filter: 'closed', page: 1, pageSize: 1 });
      const secondPage = await queue.listActive({ filter: 'closed', page: 2, pageSize: 1 });
      const served = [...firstPage.data, ...secondPage.data];
      assert.equal(firstPage.total, 2);
      assert.equal(secondPage.total, 2);
      assert.equal(firstPage.data.length, 1);
      assert.equal(secondPage.data.length, 1);
      assert.equal(new Set(served.map((row) => row.opportunityId)).size, 2);

      for (const record of records) {
        const row = served.find((item) => item.opportunityId === record.opportunityId);
        assert.ok(row);
        assert.equal(row.actionId, record.successorActionId);
        assert.equal(row.state, 'active');
        assert.equal(row.dueStatus, 'closed');
        assert.equal(row.terminalStatus, 'Perdido');
        assert.equal(row.terminalReason, record.terminalReason);
        assert.equal(row.terminalAt, record.terminalAt.toISOString());
      }
    } finally {
      for (const record of records) await clearIngestedLeads([record.leadId]);
    }
  }
);

test(
  'urgency command requires the current active action and refuses a closed opportunity',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clock = { current: NOW };
    const leads = leadRepository(clock);
    const record = await leads.upsert(leadInput('conv-queue-urgency-command'));
    try {
      const [action] = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, record.crmDealId!));
      const queue = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date(clock.current),
      });
      const marked = await queue.setUrgency({
        opportunityId: record.crmDealId!,
        actionId: action.id,
        expectedVersion: action.version,
        isUrgent: true,
        actor: 'authenticated-operator',
      });
      assert.equal(marked.isUrgent, true);
      await assert.rejects(
        () =>
          queue.setUrgency({
            opportunityId: record.crmDealId!,
            actionId: action.id,
            expectedVersion: action.version + 1,
            isUrgent: false,
            actor: 'authenticated-operator',
          }),
        /fila mudou/i
      );
      await db.update(crmDeals).set({ status: 'Perdido' }).where(eq(crmDeals.id, record.crmDealId!));
      await assert.rejects(
        () =>
          queue.setUrgency({
            opportunityId: record.crmDealId!,
            actionId: action.id,
            expectedVersion: action.version,
            isUrgent: false,
            actor: 'authenticated-operator',
          }),
        /encerrada/i
      );
    } finally {
      await clearIngestedLeads([record.id]);
    }
  }
);
