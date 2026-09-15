import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import { createPostgresOpportunityActionRepository } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import { createPostgresQuotationFollowUpRepository } from '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.js';
import {
  clients,
  crmDeals,
  manualContactEvents,
  opportunityDeliveryAnchors,
  opportunityNextActions,
  quoteRevisions,
  quotationDeliveries,
  quotationFollowUps,
  quotations,
  whatsappContactActivity,
} from '../../api/_infrastructure/db/schema.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { ensureFixtureTemplateVersion } from '../fixtures/quotation-revision-seeds.ts';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const databaseSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; this seam must run against disposable PostgreSQL.';
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);

let client: postgres.Sql;
let db: AppDatabase;
let businessNumberSequence = 26000000;

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  client = postgres(TEST_DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
  db = drizzle(client, { schema: await import('../../api/_infrastructure/db/schema.js') });
  await migrate(db, { migrationsFolder });
});

test.after(async () => {
  await client?.end({ timeout: 5 });
});

type FixtureOptions = {
  opportunityStatus?: string;
  unlinked?: boolean;
  archived?: boolean;
  deliveryState?: string;
  completionSource?: string;
};

type Fixture = {
  ids: { client: string; opportunity: string; quotation: string; revision: string; delivery: string };
  quotationIds: string[];
  revisionIds: string[];
  deliveryIds: string[];
  instance: string;
  phone: string;
  conversation: string;
  now: Date;
  repository: ReturnType<typeof createPostgresQuotationFollowUpRepository>;
  addAlternative(createdAt: Date): Promise<{ quotationId: string; revisionId: string; deliveryId: string }>;
  cleanup(): Promise<void>;
};

async function makeFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const ids = {
    client: randomUUID(),
    opportunity: randomUUID(),
    quotation: randomUUID(),
    revision: randomUUID(),
    delivery: randomUUID(),
  };
  const instance = `anchor-${randomUUID()}`;
  const phone = '5511999999999';
  const conversation = `${phone}@s.whatsapp.net`;
  const now = new Date('2026-09-11T15:00:00.000Z');
  const quotationIds = [ids.quotation];
  const revisionIds = [ids.revision];
  const deliveryIds = [ids.delivery];
  let proposalCount = 0;
  process.env.EVOLUTION_INSTANCE = instance;

  await db.insert(clients).values({ id: ids.client, nome: 'Âncora sintética' });
  if (!options.unlinked) {
    await db.insert(crmDeals).values({
      id: ids.opportunity,
      clientId: ids.client,
      nome: 'Âncora sintética',
      status: options.opportunityStatus ?? 'Orcamento Enviado',
      createdAt: now,
      updatedAt: now,
    });
  }
  const template = await ensureFixtureTemplateVersion(db as never);

  async function addProposal(createdAt: Date) {
    const isFirstProposal = proposalCount++ === 0;
    const quotationId = isFirstProposal ? ids.quotation : randomUUID();
    const revisionId = isFirstProposal ? ids.revision : randomUUID();
    const deliveryId = isFirstProposal ? ids.delivery : randomUUID();
    if (quotationIds.length > 1 || quotationIds[0] !== quotationId) quotationIds.push(quotationId);
    if (revisionIds.length > 1 || revisionIds[0] !== revisionId) revisionIds.push(revisionId);
    if (deliveryIds.length > 1 || deliveryIds[0] !== deliveryId) deliveryIds.push(deliveryId);
    await db.insert(quotations).values({
      id: quotationId,
      businessNumber: `ORC-${String(businessNumberSequence++).padStart(8, '0')}`,
      clientId: ids.client,
      opportunityId: options.unlinked ? null : ids.opportunity,
      status: 'emitido',
      issuedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(quoteRevisions).values({
      ...template,
      id: revisionId,
      quotationId,
      version: 1,
      status: 'emitido',
      issuedAt: createdAt,
      validadeDias: 30,
      entrega: '',
      fretePadrao: '0.00',
      frete: '0.00',
      clienteNome: 'Âncora sintética',
      companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
      subtotal: '100.00',
      total: '100.00',
      createdAt,
    });
    await db.insert(quotationDeliveries).values({
      id: deliveryId,
      revisionId,
      phone,
      flowId: `flow-${deliveryId}`,
      flowName: 'Âncora sintética',
      state: options.deliveryState ?? 'delivered',
      completionSource: options.completionSource ?? 'provider_receipt',
      createdAt,
      updatedAt: createdAt,
      deliveredAt:
        options.deliveryState === 'delivered' || options.deliveryState === undefined ? createdAt : null,
    });
    return { quotationId, revisionId, deliveryId };
  }

  await addProposal(now);
  return {
    ids,
    quotationIds,
    revisionIds,
    deliveryIds,
    instance,
    phone,
    conversation,
    now,
    repository: createPostgresQuotationFollowUpRepository(() => db),
    addAlternative: addProposal,
    async cleanup() {
      await db.delete(whatsappContactActivity).where(eq(whatsappContactActivity.instance, instance));
      await db.delete(opportunityDeliveryAnchors).where(eq(opportunityDeliveryAnchors.opportunityId, ids.opportunity));
      await db.delete(manualContactEvents).where(eq(manualContactEvents.opportunityId, ids.opportunity));
      await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, ids.opportunity));
      for (const deliveryId of deliveryIds) {
        await db.delete(quotationFollowUps).where(eq(quotationFollowUps.deliveryId, deliveryId));
        await db.delete(quotationDeliveries).where(eq(quotationDeliveries.id, deliveryId));
      }
      for (const revisionId of revisionIds) {
        await db.delete(quoteRevisions).where(eq(quoteRevisions.id, revisionId));
      }
      for (const quotationId of quotationIds) {
        await db.delete(quotationFollowUps).where(eq(quotationFollowUps.quotationId, quotationId));
        await db.delete(quotations).where(eq(quotations.id, quotationId));
      }
      if (!options.unlinked) {
        await db.delete(crmDeals).where(eq(crmDeals.id, ids.opportunity));
      }
      await db.delete(clients).where(eq(clients.id, ids.client));
    },
  };
}

async function project(
  fixture: Fixture,
  input: Partial<{
    deliveryId: string;
    revisionId: string;
    receivedAt: Date;
    phone: string;
    providerConversationId: string;
    allStepsDelivered: boolean;
  }> = {}
) {
  await fixture.repository.upsertFromDeliveryReceipt!({
    deliveryId: input.deliveryId ?? fixture.ids.delivery,
    revisionId: input.revisionId ?? fixture.ids.revision,
    phone: input.phone ?? fixture.phone,
    providerConversationId: input.providerConversationId ?? fixture.conversation,
    allStepsDelivered: input.allStepsDelivered ?? true,
    receivedAt: input.receivedAt ?? fixture.now,
  });
}

async function actionsFor(opportunityId: string) {
  return db.select().from(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, opportunityId));
}

async function insertActiveAction(
  fixture: Fixture,
  kind: 'first_contact' | 'agreed_commitment' | 'internal',
  origin: 'automatic' | 'manual'
) {
  const id = randomUUID();
  await db.insert(opportunityNextActions).values({
    id,
    opportunityId: fixture.ids.opportunity,
    kind,
    reasonCode: 'fixture_action',
    origin,
    state: 'active',
    dueAt: fixture.now,
    dueDate: '2026-09-11',
    dueTime: null,
    scheduleType: 'date_only',
    version: 1,
    actor: origin === 'manual' ? 'operator' : 'legacy-system',
    reason: 'Ação sintética',
    createdAt: fixture.now,
    updatedAt: fixture.now,
  });
  return id;
}

test(
  'provider receipt is date-only, source-linked, and idempotent on duplicate projection',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      await project(fixture);
      await project(fixture);
      const actions = await actionsFor(fixture.ids.opportunity);
      const [anchor] = await db
        .select()
        .from(opportunityDeliveryAnchors)
        .where(eq(opportunityDeliveryAnchors.opportunityId, fixture.ids.opportunity));
      assert.equal(actions.length, 1);
      assert.equal(actions[0]?.kind, 'customer_contact');
      assert.equal(actions[0]?.origin, 'event');
      assert.equal(actions[0]?.state, 'active');
      assert.equal(actions[0]?.scheduleType, 'date_only');
      assert.equal(actions[0]?.dueDate, '2026-09-15');
      assert.equal(actions[0]?.dueTime, null);
      assert.equal(anchor?.quotationId, fixture.ids.quotation);
      assert.equal(anchor?.revisionId, fixture.ids.revision);
      assert.equal(anchor?.deliveryId, fixture.ids.delivery);
      assert.equal(anchor?.createdActionId, actions[0]?.id);
      assert.equal(anchor?.receiptAt.toISOString(), fixture.now.toISOString());
    } finally {
      await fixture.cleanup();
    }
  }
);

test(
  'partial, non-provider, closed, unlinked, and invalid-contact deliveries fail closed',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const cases: Array<{ options: FixtureOptions; input?: Parameters<typeof project>[1] }> = [
      { options: {}, input: { allStepsDelivered: false } },
      { options: { completionSource: 'operator' } },
      { options: { opportunityStatus: 'Pedido Fechado' } },
      { options: { unlinked: true } },
      { options: {}, input: { phone: 'status@broadcast', providerConversationId: 'status@broadcast' } },
    ];
    for (const current of cases) {
      const fixture = await makeFixture(current.options);
      try {
        await project(fixture, current.input);
        assert.equal((await actionsFor(fixture.ids.opportunity)).length, 0);
        assert.equal(
          (
            await db
              .select()
              .from(opportunityDeliveryAnchors)
              .where(eq(opportunityDeliveryAnchors.opportunityId, fixture.ids.opportunity))
          ).length,
          0
        );
      } finally {
        await fixture.cleanup();
      }
    }
  }
);

test(
  'alternative proposals and resends share one opportunity cycle and keep the first source',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      await project(fixture);
      const alternative = await fixture.addAlternative(new Date('2026-09-12T15:00:00.000Z'));
      await project(fixture, {
        deliveryId: alternative.deliveryId,
        revisionId: alternative.revisionId,
        receivedAt: new Date('2026-09-12T15:00:00.000Z'),
      });
      await project(fixture, { receivedAt: new Date('2026-09-10T15:00:00.000Z') });
      const actions = await actionsFor(fixture.ids.opportunity);
      const [anchor] = await db
        .select()
        .from(opportunityDeliveryAnchors)
        .where(eq(opportunityDeliveryAnchors.opportunityId, fixture.ids.opportunity));
      assert.equal(actions.filter((action) => action.state === 'active').length, 1);
      assert.equal(anchor?.quotationId, fixture.ids.quotation);
      assert.equal(anchor?.revisionId, fixture.ids.revision);
      assert.equal(anchor?.deliveryId, fixture.ids.delivery);
    } finally {
      await fixture.cleanup();
    }
  }
);

test(
  'independent PostgreSQL connections racing the same receipt leave one action and anchor',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    const clientA = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    const clientB = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    const schema = await import('../../api/_infrastructure/db/schema.js');
    const dbA = drizzle(clientA, { schema });
    const dbB = drizzle(clientB, { schema });
    try {
      const projectWith = (database: AppDatabase) =>
        createPostgresQuotationFollowUpRepository(() => database).upsertFromDeliveryReceipt!({
          deliveryId: fixture.ids.delivery,
          revisionId: fixture.ids.revision,
          phone: fixture.phone,
          providerConversationId: fixture.conversation,
          allStepsDelivered: true,
          receivedAt: fixture.now,
        });
      await Promise.all([projectWith(dbA), projectWith(dbB)]);
      assert.equal((await actionsFor(fixture.ids.opportunity)).length, 1);
      assert.equal(
        (
          await db
            .select()
            .from(opportunityDeliveryAnchors)
            .where(eq(opportunityDeliveryAnchors.opportunityId, fixture.ids.opportunity))
        ).length,
        1
      );
    } finally {
      await clientA.end({ timeout: 5 });
      await clientB.end({ timeout: 5 });
      await fixture.cleanup();
    }
  }
);

test(
  'manual action and agreed commitment are preserved without a released suggestion',
  { skip: databaseSkip, concurrency: false },
  async () => {
    for (const [kind, origin] of [
      ['internal', 'manual'],
      ['agreed_commitment', 'manual'],
    ] as const) {
      const fixture = await makeFixture();
      try {
        const operatorActionId = await insertActiveAction(fixture, kind, origin);
        await project(fixture);
        const actions = await actionsFor(fixture.ids.opportunity);
        assert.equal(actions.length, 1);
        assert.equal(actions[0]?.id, operatorActionId);
        assert.equal(actions[0]?.state, 'active');
        const [anchor] = await db
          .select()
          .from(opportunityDeliveryAnchors)
          .where(eq(opportunityDeliveryAnchors.opportunityId, fixture.ids.opportunity));
        assert.equal(anchor?.createdActionId, null);
      } finally {
        await fixture.cleanup();
      }
    }
  }
);

test(
  'known inbound response after the anchor replaces the event action with Preciso responder',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      await project(fixture);
      const [created] = await actionsFor(fixture.ids.opportunity);
      const inboundAt = new Date('2026-09-12T15:00:00.000Z');
      await db.insert(whatsappContactActivity).values({
        id: randomUUID(),
        instance: fixture.instance,
        providerConversationId: fixture.conversation,
        canonicalPhone: fixture.phone,
        identityStatus: 'verified',
        lastInboundAt: inboundAt,
        lastInboundProviderMessageId: 'inbound-246',
        lastOutboundAt: null,
        lastOutboundProviderMessageId: null,
        blockedAt: null,
        blockReason: null,
        createdAt: inboundAt,
        updatedAt: inboundAt,
      });
      await fixture.repository.applyConversationToOpenFollowUps!({
        instance: fixture.instance,
        providerConversationId: fixture.conversation,
        providerMessageId: 'inbound-246',
        fromMe: false,
        occurredAt: inboundAt,
        identityStatus: 'verified',
        canonicalPhone: fixture.phone,
      });
      const [closed] = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.id, created!.id));
      assert.equal(closed?.state, 'completed');
      assert.equal(closed?.transitionReason, 'Cliente respondeu');
      const active = (await actionsFor(fixture.ids.opportunity)).filter(
        (row) => row.state === 'active'
      );
      assert.equal(active.length, 1);
      assert.equal(active[0]?.reasonCode, 'inbound_needs_response');
      assert.equal(active[0]?.reason, 'Preciso responder');
      // Without an accepted delivery step the follow-up guard cannot fire, so
      // the pre-anchor authorization stays non-live; it must never be claimable.
      const [followUp] = await db
        .select({
          state: quotationFollowUps.state,
          approvedAt: quotationFollowUps.approvedAt,
          transportStartedAt: quotationFollowUps.transportStartedAt,
        })
        .from(quotationFollowUps)
        .where(eq(quotationFollowUps.quotationId, fixture.ids.quotation));
      assert.notEqual(followUp?.state, 'approved');
      assert.notEqual(followUp?.state, 'processing');
      assert.equal(followUp?.transportStartedAt, null);
    } finally {
      await fixture.cleanup();
    }
  }
);

test(
  'unresolved and blocked contact activity prevent event action creation',
  { skip: databaseSkip, concurrency: false },
  async () => {
    for (const activity of [
      { identityStatus: 'unresolved' as const, blockedAt: null, blockReason: null },
      {
        identityStatus: 'verified' as const,
        blockedAt: new Date('2026-09-10T15:00:00.000Z'),
        blockReason: 'do_not_contact' as const,
      },
    ]) {
      const fixture = await makeFixture();
      try {
        await db.insert(whatsappContactActivity).values({
          id: randomUUID(),
          instance: fixture.instance,
          providerConversationId: fixture.conversation,
          canonicalPhone: fixture.phone,
          identityStatus: activity.identityStatus,
          lastInboundAt: null,
          lastInboundProviderMessageId: null,
          lastOutboundAt: null,
          lastOutboundProviderMessageId: null,
          blockedAt: activity.blockedAt,
          blockReason: activity.blockReason,
          createdAt: fixture.now,
          updatedAt: fixture.now,
        });
        await project(fixture);
        assert.equal((await actionsFor(fixture.ids.opportunity)).length, 0);
      } finally {
        await fixture.cleanup();
      }
    }
  }
);

test(
  'queue source identifiers exist only on the receipt-created action',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      const automaticId = await insertActiveAction(fixture, 'first_contact', 'automatic');
      await project(fixture);
      const repository = createPostgresOpportunityActionRepository(() => db);
      const active = (await repository.listActive({ filter: 'active', pageSize: 20 })).data.find(
        (item) => item.opportunityId === fixture.ids.opportunity
      );
      assert.equal(active?.origin, 'event');
      assert.equal(active?.sourceQuotationId, fixture.ids.quotation);
      assert.equal(active?.sourceRevisionId, fixture.ids.revision);
      assert.equal(active?.sourceDeliveryId, fixture.ids.delivery);
      const [oldAction] = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.id, automaticId));
      assert.equal(oldAction?.state, 'superseded');
      await db
        .update(opportunityNextActions)
        .set({
          state: 'completed',
          transitionActor: 'operator',
          transitionAt: fixture.now,
          transitionOrigin: 'manual',
          transitionReason: 'Ação concluída no fixture',
          updatedAt: fixture.now,
        })
        .where(eq(opportunityNextActions.id, active!.actionId));
      const manualId = await insertActiveAction(fixture, 'internal', 'manual');
      const manualItem = (
        await repository.listActive({ filter: 'active', pageSize: 20 })
      ).data.find((item) => item.actionId === manualId);
      assert.equal(manualItem?.sourceQuotationId, null);
      assert.equal(manualItem?.sourceRevisionId, null);
      assert.equal(manualItem?.sourceDeliveryId, null);
    } finally {
      await fixture.cleanup();
    }
  }
);

test(
  'commercial marker and action roll back on projection failure and retry from durable delivery succeeds',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      await db.execute(sql`
        CREATE OR REPLACE FUNCTION test_issue_246_projection_failure()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.reason_code = 'proposal_delivery_confirmed' THEN
            RAISE EXCEPTION 'synthetic issue 246 projection failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await db.execute(sql`
        CREATE TRIGGER test_issue_246_projection_failure_trigger
        BEFORE INSERT ON opportunity_next_actions
        FOR EACH ROW EXECUTE FUNCTION test_issue_246_projection_failure()
      `);
      await assert.rejects(() => project(fixture));
      await db.execute(sql`DROP TRIGGER test_issue_246_projection_failure_trigger ON opportunity_next_actions`);
      await db.execute(sql`DROP FUNCTION test_issue_246_projection_failure()`);
      assert.equal((await actionsFor(fixture.ids.opportunity)).length, 0);
      assert.equal(
        (
          await db
            .select()
            .from(opportunityDeliveryAnchors)
            .where(eq(opportunityDeliveryAnchors.opportunityId, fixture.ids.opportunity))
        ).length,
        0
      );
      assert.equal(
        (
          await db
            .select()
            .from(quotationFollowUps)
            .where(eq(quotationFollowUps.quotationId, fixture.ids.quotation))
        ).length,
        0
      );
      await project(fixture);
      assert.equal((await actionsFor(fixture.ids.opportunity)).length, 1);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS test_issue_246_projection_failure_trigger ON opportunity_next_actions`);
      await db.execute(sql`DROP FUNCTION IF EXISTS test_issue_246_projection_failure()`);
      await fixture.cleanup();
    }
  }
);

test(
  'historical manual contact before delivery does not block the reopened post-proposal action',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      const initialActionId = await insertActiveAction(fixture, 'internal', 'manual');
      const recorded = await createPostgresOpportunityActionRepository(() => db).recordManualContact({
        commandId: randomUUID(),
        opportunityId: fixture.ids.opportunity,
        actionId: initialActionId,
        expectedVersion: 1,
        contactType: 'phone_call',
        occurredAt: new Date('2026-09-10T15:00:00.000Z'),
        note: 'Contato do ciclo anterior.',
        resultCode: 'interested',
        countsAsFollowUp: false,
        actor: 'synthetic-operator',
        now: new Date('2026-09-10T15:05:00.000Z'),
        continuation: {
          type: 'wait',
          schedule: {
            kind: 'review',
            dueDate: '2026-09-11',
            dueTime: null,
            reason: 'Aguardar o próximo ciclo.',
          },
        },
      });
      assert.ok(recorded.successor);
      await createPostgresOpportunityActionRepository(() => db).createAction({
        opportunityId: fixture.ids.opportunity,
        kind: 'first_contact',
        dueDate: '2026-09-11',
        dueTime: null,
        reason: 'Retomar o atendimento.',
        reasonCode: 'new_lead',
        origin: 'automatic',
        actor: 'system',
        now: new Date('2026-09-11T14:00:00.000Z'),
        replaceActionId: recorded.successor.actionId,
        expectedVersion: recorded.successor.version,
      });

      await project(fixture);

      const actions = await actionsFor(fixture.ids.opportunity);
      const active = actions.filter((action) => action.state === 'active');
      assert.equal(active.length, 1);
      assert.equal(active[0]?.kind, 'customer_contact');
      assert.equal(active[0]?.origin, 'event');
      const [deal] = await db
        .select({ status: crmDeals.status })
        .from(crmDeals)
        .where(eq(crmDeals.id, fixture.ids.opportunity));
      assert.equal(deal?.status, 'Orcamento Enviado');
    } finally {
      await fixture.cleanup();
    }
  }
);

test(
  'manual wait at delivery time recorded before reconciliation prevents the automatic action',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      const initialActionId = await insertActiveAction(fixture, 'internal', 'manual');
      const actionRepository = createPostgresOpportunityActionRepository(() => db);
      const recorded = await actionRepository.recordManualContact({
        commandId: randomUUID(),
        opportunityId: fixture.ids.opportunity,
        actionId: initialActionId,
        expectedVersion: 1,
        contactType: 'external_conversation',
        occurredAt: fixture.now,
        note: 'Contato aguardando retorno.',
        resultCode: 'no_response',
        countsAsFollowUp: false,
        actor: 'synthetic-operator',
        now: new Date('2026-09-11T15:05:00.000Z'),
        continuation: {
          type: 'wait',
          schedule: {
            kind: 'review',
            dueDate: '2026-09-15',
            dueTime: null,
            reason: 'Aguardar retorno do cliente.',
          },
        },
      });
      assert.equal(recorded.continuationType, 'wait');
      assert.ok(recorded.successor);
      await actionRepository.createAction({
        opportunityId: fixture.ids.opportunity,
        kind: 'first_contact',
        dueDate: '2026-09-11',
        dueTime: null,
        reason: 'Retomar o atendimento.',
        reasonCode: 'new_lead',
        origin: 'automatic',
        actor: 'system',
        now: new Date('2026-09-11T15:06:00.000Z'),
        replaceActionId: recorded.successor.actionId,
        expectedVersion: recorded.successor.version,
      });

      await project(fixture);

      const actions = await actionsFor(fixture.ids.opportunity);
      const active = actions.filter((action) => action.state === 'active');
      assert.equal(active.length, 1);
      assert.equal(active[0]?.kind, 'first_contact');
      assert.equal(active[0]?.origin, 'automatic');
      assert.equal(actions.some((action) => action.kind === 'customer_contact'), false);
    } finally {
      await fixture.cleanup();
    }
  }
);
