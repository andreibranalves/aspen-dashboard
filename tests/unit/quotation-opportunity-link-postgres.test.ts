import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq, inArray } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import {
  createPostgresQuoteDraftRepository,
  QuoteDraftConflictError,
} from '../../api/_infrastructure/db/repositories/quote-repository.js';
import {
  createPostgresQuoteDraftManagementRepository,
  QuoteManagementConflictError,
} from '../../api/_infrastructure/db/repositories/quote-draft-management-repository.js';
import {
  listOpenOpportunitiesForClient,
  listProposalsForOpportunity,
} from '../../api/_infrastructure/db/repositories/proposal-opportunity-repository.js';
import {
  createPostgresOpportunityActionRepository,
  ensureFirstContactAction,
} from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import {
  clients,
  crmDeals,
  opportunityNextActions,
  productActivityEvents,
  productPricingTiers,
  products,
  quoteRevisions,
  quotations,
} from '../../api/_infrastructure/db/schema.js';
import * as schema from '../../api/_infrastructure/db/schema.js';

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
  : 'TEST_DATABASE_URL is required; the proposal opportunity adapter must run against a disposable PostgreSQL.';

const NOW = new Date('2026-09-11T12:00:00.000Z');

type Database = PostgresJsDatabase<typeof schema>;

async function cleanupFixture(
  sqlClient: postgres.Sql,
  db: Database,
  clientIds: string[],
  skus: string[]
): Promise<void> {
  try {
    await db
      .delete(opportunityNextActions)
      .where(
        inArray(
          opportunityNextActions.opportunityId,
          db.select({ id: crmDeals.id }).from(crmDeals).where(inArray(crmDeals.clientId, clientIds))
        )
      );
    await db.delete(quotations).where(inArray(quotations.clientId, clientIds));
    await db.delete(crmDeals).where(inArray(crmDeals.clientId, clientIds));
    await db.delete(clients).where(inArray(clients.id, clientIds));
    for (const sku of skus) {
      await db.delete(productActivityEvents).where(eq(productActivityEvents.productSku, sku));
    }
    await db.delete(products).where(inArray(products.sku, skus));
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

async function seedProduct(db: Database, sku: string, name: string): Promise<void> {
  await db.insert(products).values({
    sku,
    nome: name,
    descricao: '',
    unidade: 'Und',
    precoBase: '10.00',
    ativo: true,
  });
  await db.insert(productPricingTiers).values({
    productSku: sku,
    minimumQuantity: '1.000',
    unitPrice: '10.00',
  });
}

test(
  'a proposal links to the chosen opportunity and lists it as a proposal',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-LINK-${suffix}`;
    const clientId = randomUUID();
    const opportunityId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto de oportunidade');
      await db
        .insert(clients)
        .values({ id: clientId, nome: 'Cliente Oportunidade', arquivado: false });
      await db.insert(crmDeals).values({
        id: opportunityId,
        clientId,
        nome: 'Cliente Oportunidade',
        status: 'Novo Lead',
        demandSummary: 'Cangas 100 unidades',
      });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const draft = await repository.createDraft({
        client_id: clientId,
        opportunity_id: opportunityId,
        items: [{ item_code: sku, qty: '2.000' }],
      });

      const [quotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, draft.quotation_uuid));
      assert.equal(
        quotation.opportunityId,
        opportunityId,
        'the proposal records the demand it belongs to'
      );

      const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, opportunityId));
      assert.equal(
        deal.quotationId,
        null,
        'the new link is the source of truth; the legacy single pointer stays untouched'
      );

      const proposals = await listProposalsForOpportunity(db, opportunityId);
      assert.equal(proposals.length, 1);
      assert.equal(proposals[0].quotationId, draft.quotation_uuid);
      assert.equal(proposals[0].businessNumber, draft.quotation_name);
      assert.equal(proposals[0].status, 'rascunho');
      assert.equal(proposals[0].total, draft.total);
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'alternative proposals share one opportunity without creating duplicate actions',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-ALT-${suffix}`;
    const clientId = randomUUID();
    const opportunityId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto alternativo');
      await db.insert(clients).values({ id: clientId, nome: 'Cliente Alternativo', arquivado: false });
      await db.insert(crmDeals).values({
        id: opportunityId,
        clientId,
        nome: 'Cliente Alternativo',
        status: 'Novo Lead',
        demandSummary: 'Cangas 100 unidades',
      });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const first = await repository.createDraft({
        client_id: clientId,
        opportunity_id: opportunityId,
        items: [{ item_code: sku, qty: '2.000' }],
      });
      const second = await repository.createDraft({
        client_id: clientId,
        opportunity_id: opportunityId,
        items: [{ item_code: sku, qty: '5.000' }],
      });

      const proposals = await listProposalsForOpportunity(db, opportunityId);
      assert.deepEqual(
        proposals.map((row) => row.quotationId).sort(),
        [first.quotation_uuid, second.quotation_uuid].sort(),
        'both alternatives stay linked to the same demand'
      );
      assert.equal(new Set(proposals.map((row) => row.total)).size, 2);

      const actions = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      assert.equal(actions.length, 0, 'sharing an opportunity never seeds a second cycle');
      const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, opportunityId));
      assert.equal(deal.quotationId, null, 'the legacy pointer is not overwritten per proposal');
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'the commercial queue shows every proposal of the demand with value and state',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-QUEUE-${suffix}`;
    const clientId = randomUUID();
    const opportunityId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto fila');
      await db.insert(clients).values({ id: clientId, nome: 'Cliente Fila', arquivado: false });
      await db.insert(crmDeals).values({
        id: opportunityId,
        clientId,
        nome: 'Cliente Fila',
        status: 'Novo Lead',
        demandSummary: 'Cangas 100 unidades',
      });
      await ensureFirstContactAction(db, {
        opportunityId,
        dueAt: NOW,
        idFactory: () => randomUUID(),
      });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      await repository.createDraft({
        client_id: clientId,
        opportunity_id: opportunityId,
        items: [{ item_code: sku, qty: '2.000' }],
      });
      await repository.createDraft({
        client_id: clientId,
        opportunity_id: opportunityId,
        items: [{ item_code: sku, qty: '4.000' }],
      });

      const queue = await createPostgresOpportunityActionRepository(() => db).listActive({
        pageSize: 100,
      });
      const item = queue.data.find((row) => row.opportunityId === opportunityId);
      assert.ok(item, 'the demand with an active action is in the queue');
      assert.equal(item!.proposals.length, 2, 'the queue exposes both linked proposals');
      assert.deepEqual(
        item!.proposals.map((proposal) => proposal.status),
        ['rascunho', 'rascunho']
      );
      assert.equal(
        item!.proposals.every((proposal) => typeof proposal.businessNumber === 'string'),
        true
      );
      assert.equal(
        item!.proposals.every((proposal) => proposal.total !== null),
        true
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'starting a new demand creates a distinct opportunity for the same client',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-NEW-${suffix}`;
    const clientId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto nova demanda');
      await db
        .insert(clients)
        .values({ id: clientId, nome: 'Cliente Duas Demandas', arquivado: false });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const first = await repository.createDraft({
        client_id: clientId,
        new_demand: true,
        demand_summary: 'Cangas 100 unidades',
        items: [{ item_code: sku, qty: '2.000' }],
      });
      const second = await repository.createDraft({
        client_id: clientId,
        new_demand: true,
        demand_summary: 'Toalhas 20 unidades',
        items: [{ item_code: sku, qty: '3.000' }],
      });

      const deals = await db.select().from(crmDeals).where(eq(crmDeals.clientId, clientId));
      assert.equal(deals.length, 2, 'two independent demands stay in two opportunities');
      assert.notEqual(deals[0].id, deals[1].id);
      assert.deepEqual(
        deals.map((row) => row.demandSummary).sort(),
        ['Cangas 100 unidades', 'Toalhas 20 unidades']
      );

      const [firstQuotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, first.quotation_uuid));
      const [secondQuotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, second.quotation_uuid));
      assert.ok(firstQuotation.opportunityId, 'the first demand links its own opportunity');
      assert.ok(secondQuotation.opportunityId, 'the second demand links its own opportunity');
      assert.notEqual(firstQuotation.opportunityId, secondQuotation.opportunityId);

      const choices = await listOpenOpportunitiesForClient(db, clientId);
      assert.equal(choices.length, 2, 'the start chooser sees both demands');
      assert.equal(
        choices.every((choice) => choice.clientId === clientId),
        true
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'a new demand seeds exactly one opportunity and one first action that reach the queue',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-ACTION-${suffix}`;
    const clientId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto primeira ação');
      await db
        .insert(clients)
        .values({ id: clientId, nome: 'Cliente Primeira Ação', arquivado: false });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const draft = await repository.createDraft({
        client_id: clientId,
        new_demand: true,
        demand_summary: 'Cangas 100 unidades',
        items: [{ item_code: sku, qty: '2.000' }],
      });

      const deals = await db.select().from(crmDeals).where(eq(crmDeals.clientId, clientId));
      assert.equal(deals.length, 1, 'the new demand creates exactly one opportunity');
      const opportunityId = deals[0].id;
      const actions = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      assert.equal(actions.length, 1, 'the new demand seeds exactly one first action');
      assert.equal(actions[0].kind, 'first_contact');
      assert.equal(actions[0].state, 'active');

      const queue = await createPostgresOpportunityActionRepository(() => db).listActive({ pageSize: 100 });
      const item = queue.data.find((row) => row.opportunityId === opportunityId);
      assert.ok(item, 'the new demand reaches the commercial queue');
      assert.deepEqual(
        item!.proposals.map((proposal) => proposal.quotationId),
        [draft.quotation_uuid],
        'the queue exposes the linked proposal'
      );

      await repository.createDraft({
        client_id: clientId,
        opportunity_id: opportunityId,
        items: [{ item_code: sku, qty: '5.000' }],
      });
      const afterAlternatives = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      assert.equal(afterAlternatives.length, 1, 'an alternative proposal never seeds another action');
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'an opportunity that belongs to another client is rejected',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-FOREIGN-${suffix}`;
    const clientId = randomUUID();
    const otherClientId = randomUUID();
    const foreignOpportunityId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto incompatível');
      await db.insert(clients).values([
        { id: clientId, nome: 'Cliente Correto', arquivado: false },
        { id: otherClientId, nome: 'Cliente Alheio', arquivado: false },
      ]);
      await db.insert(crmDeals).values({
        id: foreignOpportunityId,
        clientId: otherClientId,
        nome: 'Cliente Alheio',
        status: 'Novo Lead',
      });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      await assert.rejects(
        () =>
          repository.createDraft({
            client_id: clientId,
            opportunity_id: foreignOpportunityId,
            items: [{ item_code: sku, qty: '2.000' }],
          }),
        (error: unknown) =>
          error instanceof QuoteDraftConflictError &&
          /não pertence/i.test(String((error as Error).message))
      );

      const created = await db
        .select()
        .from(quotations)
        .where(eq(quotations.clientId, clientId));
      assert.equal(created.length, 0, 'nothing is written when the demand is incompatible');
    } finally {
      await cleanupFixture(sqlClient, db, [clientId, otherClientId], [sku]);
    }
  }
);

test(
  'closed demands are neither offered nor linkable',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-CLOSED-${suffix}`;
    const clientId = randomUUID();
    const closedOpportunityId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto encerrado');
      await db.insert(clients).values({ id: clientId, nome: 'Cliente Encerrado', arquivado: false });
      await db.insert(crmDeals).values({
        id: closedOpportunityId,
        clientId,
        nome: 'Cliente Encerrado',
        status: 'Perdido',
      });

      const choices = await listOpenOpportunitiesForClient(db, clientId);
      assert.equal(choices.length, 0, 'a closed demand leaves the choice surface');

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      await assert.rejects(
        () =>
          repository.createDraft({
            client_id: clientId,
            opportunity_id: closedOpportunityId,
            items: [{ item_code: sku, qty: '2.000' }],
          }),
        (error: unknown) =>
          error instanceof QuoteDraftConflictError && /encerrada/i.test(String((error as Error).message))
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'legacy proposal creation without a chosen opportunity stays unlinked',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-LEGACY-${suffix}`;
    const clientId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto legado');
      await db.insert(clients).values({ id: clientId, nome: 'Cliente Legado', arquivado: false });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const draft = await repository.createDraft({
        client_id: clientId,
        items: [{ item_code: sku, qty: '1.000' }],
      });

      const [quotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, draft.quotation_uuid));
      assert.equal(
        quotation.opportunityId,
        null,
        'the old contract keeps working and never infers a demand'
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'a new demand cannot be combined with an existing origin',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-CONFLICT-${suffix}`;
    const clientId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto conflito');
      await db.insert(clients).values({ id: clientId, nome: 'Cliente Conflito', arquivado: false });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      await assert.rejects(
        () =>
          repository.createDraft({
            client_id: clientId,
            new_demand: true,
            quote_lead_id: randomUUID(),
            crm_deal_id: randomUUID(),
            items: [{ item_code: sku, qty: '1.000' }],
          }),
        (error: unknown) => /nova demanda/i.test(String((error as Error).message))
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'replaying the same creation key returns the original draft without duplicating side effects',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-KEY-${suffix}`;
    const clientId = randomUUID();
    const creationRequestId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto idempotência');
      await db.insert(clients).values({ id: clientId, nome: 'Cliente Idempotente', arquivado: false });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const input = {
        client_id: clientId,
        creation_request_id: creationRequestId,
        new_demand: true,
        demand_summary: 'Cangas 100 unidades',
        items: [{ item_code: sku, qty: '2.000' }],
      };
      const first = await repository.createDraft(input);
      const countsAfterFirst = {
        quotations: (await db.select().from(quotations).where(eq(quotations.clientId, clientId))).length,
        deals: (await db.select().from(crmDeals).where(eq(crmDeals.clientId, clientId))).length,
        revisions: (
          await db.select().from(quoteRevisions).where(eq(quoteRevisions.quotationId, first.quotation_uuid))
        ).length,
        actions: (
          await db
            .select()
            .from(opportunityNextActions)
            .where(
              inArray(
                opportunityNextActions.opportunityId,
                db.select({ id: crmDeals.id }).from(crmDeals).where(eq(crmDeals.clientId, clientId))
              )
            )
        ).length,
      };
      assert.equal(countsAfterFirst.quotations, 1);
      assert.equal(countsAfterFirst.deals, 1);
      assert.equal(countsAfterFirst.revisions, 1);
      assert.equal(countsAfterFirst.actions, 1);

      const replay = await repository.createDraft(input);
      assert.equal(replay.quotation_uuid, first.quotation_uuid, 'the same key replays the same quotation');
      assert.equal(replay.revision_id, first.revision_id);
      assert.equal(replay.business_number ?? replay.quotation_id, first.quotation_id);
      assert.equal(
        (await db.select().from(quotations).where(eq(quotations.clientId, clientId))).length,
        1,
        'a retry never creates a second quotation'
      );
      assert.equal(
        (await db.select().from(crmDeals).where(eq(crmDeals.clientId, clientId))).length,
        1,
        'a retry never creates a second opportunity'
      );
      assert.equal(
        (
          await db
            .select()
            .from(opportunityNextActions)
            .where(
              inArray(
                opportunityNextActions.opportunityId,
                db.select({ id: crmDeals.id }).from(crmDeals).where(eq(crmDeals.clientId, clientId))
              )
            )
        ).length,
        1,
        'a retry never seeds a second action'
      );

      await assert.rejects(
        () => repository.createDraft({ ...input, demand_summary: 'Conteúdo diferente' }),
        (error: unknown) =>
          error instanceof QuoteDraftConflictError && /chave de criação/i.test(String((error as Error).message)),
        'the same key with different content is a conflict, never a silent replay'
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'the creation fingerprint covers template and sections and normalizes aliases',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-FP-${suffix}`;
    const clientId = randomUUID();
    const creationRequestId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto fingerprint');
      await db
        .insert(clients)
        .values({ id: clientId, nome: 'Cliente Fingerprint', arquivado: false });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const input = {
        client_id: clientId,
        creation_request_id: creationRequestId,
        new_demand: true,
        demand_summary: 'Cangas 100 unidades',
        template_key: 'padrao',
        items: [{ item_code: sku, qty: '2.000' }],
      };
      const first = await repository.createDraft(input);
      const replay = await repository.createDraft({ ...input });
      assert.equal(replay.quotation_uuid, first.quotation_uuid, 'same key and content replays');

      const isCreationConflict = (error: unknown) =>
        error instanceof QuoteDraftConflictError &&
        /chave de criação/i.test(String((error as Error).message));

      await assert.rejects(
        () => repository.createDraft({ ...input, template_key: 'minimalista' }),
        isCreationConflict,
        'the same key with another model is a conflict'
      );
      await assert.rejects(
        () => repository.createDraft({ ...input, template_version_id: randomUUID() }),
        isCreationConflict,
        'the same key with another template version is a conflict'
      );
      await assert.rejects(
        () => repository.createDraft({ ...input, template: 'minimalista' }),
        isCreationConflict,
        'the same key with another template payload is a conflict'
      );
      await assert.rejects(
        () =>
          repository.createDraft({
            ...input,
            secoes: { condicoes_gerais: { body: 'Corpo diferente' } },
          }),
        isCreationConflict,
        'the same key with different sections is a conflict'
      );

      const aliasKey = randomUUID();
      const aliasInput = {
        client_id: clientId,
        creation_request_id: aliasKey,
        new_demand: true,
        demand_summary: 'Cangas 200 unidades',
        items: [{ item_code: sku, qty: '3.000' }],
      };
      const aliasFirst = await repository.createDraft(aliasInput);
      const aliasReplay = await repository.createDraft({
        ...aliasInput,
        new_demand: undefined,
        newDemand: true,
      });
      assert.equal(
        aliasReplay.quotation_uuid,
        aliasFirst.quotation_uuid,
        'semantically equivalent aliases replay instead of conflicting'
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'two concurrent creations with the same key produce one quotation',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-RACE-${suffix}`;
    const clientId = randomUUID();
    const creationRequestId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto corrida');
      await db.insert(clients).values({ id: clientId, nome: 'Cliente Corrida', arquivado: false });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const input = {
        client_id: clientId,
        creation_request_id: creationRequestId,
        new_demand: true,
        demand_summary: 'Cangas 100 unidades',
        items: [{ item_code: sku, qty: '3.000' }],
      };
      const [first, second] = await Promise.all([
        repository.createDraft(input),
        repository.createDraft(input),
      ]);
      assert.equal(first.quotation_uuid, second.quotation_uuid);
      assert.equal(
        (await db.select().from(quotations).where(eq(quotations.clientId, clientId))).length,
        1,
        'the unique key plus the write lock collapse the race into one quotation'
      );
      assert.equal(
        (await db.select().from(crmDeals).where(eq(crmDeals.clientId, clientId))).length,
        1
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'duplicating a linked proposal stays on the same demand without a phantom opportunity',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-DUP-${suffix}`;
    const clientId = randomUUID();
    const opportunityId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto duplicação');
      await db
        .insert(clients)
        .values({ id: clientId, nome: 'Cliente Duplicação', arquivado: false });
      await db.insert(crmDeals).values({
        id: opportunityId,
        clientId,
        nome: 'Cliente Duplicação',
        status: 'Novo Lead',
        demandSummary: 'Cangas 100 unidades',
      });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const source = await repository.createDraft({
        client_id: clientId,
        opportunity_id: opportunityId,
        items: [{ item_code: sku, qty: '2.000' }],
      });
      const copy = await repository.duplicateDraft!(source.quotation_uuid);

      assert.equal(copy.crm_deal_id, opportunityId, 'the copy stays on the original demand');
      assert.equal(
        (await db.select().from(crmDeals).where(eq(crmDeals.clientId, clientId))).length,
        1,
        'duplication never inserts a phantom opportunity'
      );
      const [copiedQuotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, copy.quotation_uuid));
      assert.equal(copiedQuotation.opportunityId, opportunityId);
      const proposals = await listProposalsForOpportunity(db, opportunityId);
      assert.equal(proposals.length, 2, 'both the source and the copy are proposals of the demand');

      await db.update(crmDeals).set({ status: 'Perdido' }).where(eq(crmDeals.id, opportunityId));
      await assert.rejects(
        () => repository.duplicateDraft!(source.quotation_uuid),
        (error: unknown) =>
          error instanceof QuoteDraftConflictError &&
          /encerrada/i.test(String((error as Error).message)),
        'a closed demand is not duplicated'
      );
    } finally {
      await cleanupFixture(sqlClient, db, [clientId], [sku]);
    }
  }
);

test(
  'editing the client of a linked proposal is rejected when incompatible',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const sqlClient = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
    const db = drizzle(sqlClient, { schema });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sku = `OPP-EDIT-${suffix}`;
    const clientId = randomUUID();
    const otherClientId = randomUUID();
    const opportunityId = randomUUID();

    try {
      await migrate(db, { migrationsFolder });
      await seedProduct(db, sku, 'Produto edição');
      await db.insert(clients).values([
        { id: clientId, nome: 'Cliente Correto', arquivado: false },
        { id: otherClientId, nome: 'Cliente Incompatível', arquivado: false },
      ]);
      await db.insert(crmDeals).values({
        id: opportunityId,
        clientId,
        nome: 'Cliente Correto',
        status: 'Novo Lead',
      });

      const repository = createPostgresQuoteDraftRepository(() => db, { now: () => new Date(NOW) });
      const draft = await repository.createDraft({
        client_id: clientId,
        opportunity_id: opportunityId,
        items: [{ item_code: sku, qty: '2.000' }],
      });
      const management = createPostgresQuoteDraftManagementRepository(() => db, {
        now: () => new Date(NOW),
      });

      await assert.rejects(
        () =>
          management.update!(draft.quotation_uuid, {
            concurrency_token: draft.concurrency_token,
            client_id: otherClientId,
            items: [{ sku, qty: '3.000' }],
          }),
        (error: unknown) =>
          error instanceof QuoteManagementConflictError &&
          /outro cliente/i.test(String((error as Error).message))
      );
      const [unchanged] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, draft.quotation_uuid));
      assert.equal(unchanged.clientId, clientId, 'the incompatible edit writes nothing');

      const compatible = await management.update!(draft.quotation_uuid, {
        concurrency_token: draft.concurrency_token,
        client_id: clientId,
        items: [{ sku, qty: '3.000' }],
      });
      assert.equal(compatible.quotation_uuid, draft.quotation_uuid);
      assert.equal(compatible.client_id, clientId);
    } finally {
      await cleanupFixture(sqlClient, db, [clientId, otherClientId], [sku]);
    }
  }
);
