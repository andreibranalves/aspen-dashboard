import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import {
  applyAssociateResponseTransition,
  applyInboundResponseTransition,
  createPostgresOpportunityActionRepository,
} from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { createPostgresQuotationFollowUpRepository } from '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { clients, crmDeals, opportunityNextActions } from '../../api/_infrastructure/db/schema.js';
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

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  client = postgres(TEST_DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
});

test.after(async () => {
  await client?.end({ timeout: 5 });
});

type Fixture = {
  ids: { client: string; opportunity: string };
  now: Date;
  cleanup(): Promise<void>;
};

async function makeFixture(): Promise<Fixture> {
  const ids = {
    client: randomUUID(),
    opportunity: randomUUID(),
  };
  const now = new Date('2026-09-11T15:00:00.000Z');
  await db.insert(clients).values({
    id: ids.client,
    nome: 'Resposta sintética',
    telefone: '5511999990000',
  });
  await db.insert(crmDeals).values({
    id: ids.opportunity,
    clientId: ids.client,
    nome: 'Resposta sintética',
    status: 'Orcamento Enviado',
    createdAt: now,
    updatedAt: now,
  });
  return {
    ids,
    now,
    async cleanup() {
      await db
        .delete(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, ids.opportunity));
      await db.delete(crmDeals).where(eq(crmDeals.id, ids.opportunity));
      await db.delete(clients).where(eq(clients.id, ids.client));
    },
  };
}

async function insertActiveAction(fixture: Fixture, reasonCode: string): Promise<string> {
  const id = randomUUID();
  await db.insert(opportunityNextActions).values({
    id,
    opportunityId: fixture.ids.opportunity,
    kind: 'customer_contact',
    reasonCode,
    origin: 'event',
    state: 'active',
    dueAt: fixture.now,
    dueDate: '2026-09-11',
    dueTime: null,
    scheduleType: 'date_only',
    version: 1,
    actor: 'system',
    reason: 'Retorno pendente',
    createdAt: fixture.now,
    updatedAt: fixture.now,
  });
  return id;
}

async function actionsFor(opportunityId: string) {
  return db
    .select()
    .from(opportunityNextActions)
    .where(eq(opportunityNextActions.opportunityId, opportunityId))
    .orderBy(asc(opportunityNextActions.createdAt));
}

test(
  'applyInboundResponseTransition replaces the pending return with Preciso responder',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      const oldActionId = await insertActiveAction(fixture, 'follow_up_first_return');
      // 2026-09-14T02:30Z is 2026-09-13T23:30 in São Paulo: the successor's
      // due date must be the local civil date, not the UTC date.
      const occurredAt = new Date('2026-09-14T02:30:00.000Z');
      const result = await applyInboundResponseTransition({
        database: db,
        opportunityId: fixture.ids.opportunity,
        occurredAt,
        idFactory: () => randomUUID(),
      });

      const actions = await actionsFor(fixture.ids.opportunity);
      assert.equal(actions.length, 2);

      const oldAction = actions.find((action) => action.id === oldActionId)!;
      assert.equal(oldAction.state, 'completed');
      assert.equal(oldAction.transitionReason, 'Cliente respondeu');
      assert.equal(oldAction.transitionOrigin, 'event');
      assert.equal(oldAction.transitionActor, 'system');
      assert.ok(oldAction.replacedById, 'old action must reference the successor');

      const successor = actions.find((action) => action.id === oldAction.replacedById)!;
      assert.equal(result.actionId, oldActionId);
      assert.equal(result.state, 'completed');
      assert.equal(result.version, 2);
      assert.equal(result.closed, false);
      assert.equal(result.action?.state, 'completed');
      assert.equal(result.successor?.actionId, successor.id);
      assert.equal(successor.kind, 'review');
      assert.equal(successor.reasonCode, 'inbound_needs_response');
      assert.equal(successor.reason, 'Preciso responder');
      assert.equal(successor.origin, 'event');
      assert.equal(successor.scheduleType, 'date_only');
      assert.equal(successor.dueDate, '2026-09-13');
      assert.equal(successor.dueTime, null);
      assert.equal(successor.state, 'active');
      assert.equal(successor.version, oldAction.version + 1);
      assert.equal(new Date(successor.dueAt).toISOString(), '2026-09-13T03:00:00.000Z');
      assert.equal(successor.actor, 'system');
    } finally {
      await fixture.cleanup();
    }
  }
);

test(
  'applyInboundResponseTransition is idempotent when repeated after succeeding',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      await insertActiveAction(fixture, 'follow_up_first_return');
      const occurredAt = new Date('2026-09-14T02:30:00.000Z');
      const first = await applyInboundResponseTransition({
        database: db,
        opportunityId: fixture.ids.opportunity,
        occurredAt,
        idFactory: () => randomUUID(),
      });
      assert.equal(first.state, 'completed');
      assert.ok(first.successor);
      const before = await actionsFor(fixture.ids.opportunity);
      assert.equal(before.length, 2);

      const second = await applyInboundResponseTransition({
        database: db,
        opportunityId: fixture.ids.opportunity,
        occurredAt,
        idFactory: () => randomUUID(),
      });

      const after = await actionsFor(fixture.ids.opportunity);
      assert.equal(after.length, 2);
      assert.equal(second.state, 'active');
      assert.equal(second.successor, null);
      assert.equal(second.actionId, first.successor!.actionId);
      assert.equal(second.version, first.version);
    } finally {
      await fixture.cleanup();
    }
  }
);

test(
  'applyInboundResponseTransition keeps state untouched when the active action already needs response',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    try {
      const activeId = await insertActiveAction(fixture, 'inbound_needs_response');
      const result = await applyInboundResponseTransition({
        database: db,
        opportunityId: fixture.ids.opportunity,
        occurredAt: new Date('2026-09-14T02:30:00.000Z'),
        idFactory: () => randomUUID(),
      });
      const actions = await actionsFor(fixture.ids.opportunity);
      assert.equal(actions.length, 1);
      const [active] = actions;
      assert.equal(active.id, activeId);
      assert.equal(active.state, 'active');
      assert.equal(active.version, 1);
      assert.equal(result.state, 'active');
      assert.equal(result.successor, null);
      assert.equal(result.version, 1);
      assert.equal(result.actionId, activeId);
    } finally {
      await fixture.cleanup();
    }
  }
);

test(
  'associateInboundResponse moves a consolidated alert to the chosen demand',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    const sibling = randomUUID();
    const losingSibling = randomUUID();
    await db.insert(crmDeals).values([
      {
        id: sibling,
        clientId: fixture.ids.client,
        nome: 'Demanda irmã',
        status: 'Orcamento Enviado',
        createdAt: fixture.now,
        updatedAt: fixture.now,
      },
      {
        id: losingSibling,
        clientId: fixture.ids.client,
        nome: 'Outra demanda irmã',
        status: 'Orcamento Enviado',
        createdAt: fixture.now,
        updatedAt: fixture.now,
      },
    ]);
    try {
      await insertActiveAction(fixture, 'follow_up_second_return');
      await db.insert(opportunityNextActions).values(
        [sibling, losingSibling].map((opportunityId) => ({
          id: randomUUID(),
          opportunityId,
          kind: 'customer_contact',
          reasonCode: 'follow_up_second_return',
          origin: 'event',
          state: 'active',
          dueAt: fixture.now,
          dueDate: '2026-09-11',
          dueTime: null,
          scheduleType: 'date_only',
          version: 1,
          actor: 'system',
          reason: 'Retorno pendente',
          createdAt: fixture.now,
          updatedAt: fixture.now,
        })),
      );

      const alert = await applyAssociateResponseTransition({
        database: db,
        opportunityId: fixture.ids.opportunity,
        occurredAt: fixture.now,
        idFactory: randomUUID,
        actor: 'system',
      });
      await db
        .update(opportunityNextActions)
        .set({
          associationClientId: fixture.ids.client,
          associationPhone: '5511999990000',
          associationProviderMessageId: 'inbound-association-test',
        })
        .where(eq(opportunityNextActions.id, alert.successor!.actionId));
      await db
        .update(opportunityNextActions)
        .set({
          state: 'suspended',
          transitionReason: 'Resposta ambígua aguardando associação',
          replacedById: alert.successor!.actionId,
        })
        .where(inArray(opportunityNextActions.opportunityId, [sibling, losingSibling]));

      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-11T16:00:00.000Z'),
      });
      const resolved = await repository.associateInboundResponse({
        actionId: alert.successor!.actionId,
        expectedVersion: alert.successor!.version,
        opportunityId: sibling,
        actor: 'operator-a',
      });
      assert.equal(resolved.state, 'completed');
      assert.equal(resolved.action?.state, 'completed');
      assert.equal(resolved.successor?.reasonCode, 'inbound_needs_response');

      const host = await actionsFor(fixture.ids.opportunity);
      assert.equal(host.filter((row) => row.state === 'active').length, 1);
      assert.equal(
        host.find((row) => row.state === 'active')?.reasonCode,
        'follow_up_second_return',
      );
      assert.equal(host.find((row) => row.id === alert.successor?.actionId)?.state, 'cancelled');

      const sister = await actionsFor(sibling);
      assert.equal(
        sister.filter((row) => row.state === 'active' && row.reasonCode === 'inbound_needs_response').length,
        1,
      );
      const restoredLosingSibling = await actionsFor(losingSibling);
      assert.equal(restoredLosingSibling.length, 1);
      assert.equal(restoredLosingSibling[0]?.state, 'active');
      assert.equal(restoredLosingSibling[0]?.reasonCode, 'follow_up_second_return');
      assert.equal(restoredLosingSibling[0]?.version, 1);
    } finally {
      await db
        .delete(opportunityNextActions)
        .where(inArray(opportunityNextActions.opportunityId, [sibling, losingSibling]));
      await db.delete(crmDeals).where(inArray(crmDeals.id, [sibling, losingSibling]));
      await fixture.cleanup();
    }
  },
);

test(
  'associateInboundResponse rejects an alert owned by another client',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const owner = await makeFixture();
    const target = await makeFixture();
    try {
      await insertActiveAction(owner, 'follow_up_second_return');
      const alert = await applyAssociateResponseTransition({
        database: db,
        opportunityId: owner.ids.opportunity,
        occurredAt: owner.now,
        idFactory: randomUUID,
      });
      await db
        .update(opportunityNextActions)
        .set({
          associationClientId: owner.ids.client,
          associationPhone: '5511999990000',
          associationProviderMessageId: 'inbound-foreign-client-test',
        })
        .where(eq(opportunityNextActions.id, alert.successor!.actionId));
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-11T16:00:00.000Z'),
      });
      await assert.rejects(
        () => repository.associateInboundResponse({
          actionId: alert.successor!.actionId,
          expectedVersion: alert.successor!.version,
          opportunityId: target.ids.opportunity,
          actor: 'operator-a',
        }),
        /cliente do alerta/i,
      );
      const [stillOpen] = await db
        .select({ state: opportunityNextActions.state })
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.id, alert.successor!.actionId));
      assert.equal(stillOpen?.state, 'active');
    } finally {
      await owner.cleanup();
      await target.cleanup();
    }
  },
);


type ClientlessFixture = {
  ids: { host: string; sibling: string };
  phone: string;
  now: Date;
  cleanup(): Promise<void>;
};

async function makeClientlessFixture(): Promise<ClientlessFixture> {
  const ids = { host: randomUUID(), sibling: randomUUID() };
  const now = new Date('2026-09-11T15:00:00.000Z');
  const phone = '5511988887777';
  await db.insert(crmDeals).values([
    {
      id: ids.host,
      nome: 'Pré-proposta A',
      telefone: phone,
      status: 'Novo Lead',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ids.sibling,
      nome: 'Pré-proposta B',
      telefone: phone,
      status: 'Novo Lead',
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(opportunityNextActions).values(
    [ids.host, ids.sibling].map((opportunityId) => ({
      id: randomUUID(),
      opportunityId,
      kind: 'customer_contact',
      reasonCode: 'follow_up_second_return',
      origin: 'event',
      state: 'active',
      dueAt: now,
      dueDate: '2026-09-11',
      dueTime: null,
      scheduleType: 'date_only',
      version: 1,
      actor: 'system',
      reason: 'Retorno pendente',
      createdAt: now,
      updatedAt: now,
    })),
  );
  return {
    ids,
    phone,
    now,
    async cleanup() {
      await db
        .delete(opportunityNextActions)
        .where(inArray(opportunityNextActions.opportunityId, [ids.host, ids.sibling]));
      await db.delete(crmDeals).where(inArray(crmDeals.id, [ids.host, ids.sibling]));
    },
  };
}

test(
  'ambiguous inbound stores phone-keyed context without a client id and stays resolvable',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeClientlessFixture();
    const originalInstance = process.env.EVOLUTION_INSTANCE;
    const instance = `inbound-clientless-${randomUUID()}`;
    process.env.EVOLUTION_INSTANCE = instance;
    try {
      const repository = createPostgresQuotationFollowUpRepository(() => db);
      const providerMessageId = `inbound-clientless-${randomUUID()}`;
      await repository.applyConversationToOpenFollowUps!({
        instance,
        providerConversationId: `${fixture.phone}@s.whatsapp.net`,
        providerMessageId,
        fromMe: false,
        occurredAt: new Date('2026-09-11T16:00:00.000Z'),
        identityStatus: 'verified',
        canonicalPhone: fixture.phone,
      });

      const rows = await db
        .select()
        .from(opportunityNextActions)
        .where(inArray(opportunityNextActions.opportunityId, [fixture.ids.host, fixture.ids.sibling]));
      const alerts = rows.filter(
        (row) => row.state === 'active' && row.reasonCode === 'associate_response',
      );
      assert.equal(alerts.length, 1);
      const alert = alerts[0]!;
      // The relaxed context check accepts phone-keyed context with no client id.
      assert.equal(alert.associationClientId, null);
      assert.equal(alert.associationPhone, fixture.phone);
      assert.equal(alert.associationProviderMessageId, providerMessageId);
      const nonHostIds = [fixture.ids.host, fixture.ids.sibling].filter(
        (id) => id !== alert.opportunityId,
      );
      const suspendedSibling = rows.find(
        (row) => nonHostIds.includes(row.opportunityId) && row.state === 'suspended',
      );
      assert.ok(suspendedSibling);
      assert.equal(suspendedSibling.replacedById, alert.id);

      // A second inbound message on the same phone reuses the existing alert.
      await repository.applyConversationToOpenFollowUps!({
        instance,
        providerConversationId: `${fixture.phone}@s.whatsapp.net`,
        providerMessageId: `inbound-clientless-2-${randomUUID()}`,
        fromMe: false,
        occurredAt: new Date('2026-09-11T16:05:00.000Z'),
        identityStatus: 'verified',
        canonicalPhone: fixture.phone,
      });
      const afterReplay = await db
        .select()
        .from(opportunityNextActions)
        .where(inArray(opportunityNextActions.opportunityId, [fixture.ids.host, fixture.ids.sibling]));
      assert.equal(
        afterReplay.filter(
          (row) => row.state === 'active' && row.reasonCode === 'associate_response',
        ).length,
        1,
      );

      // The queue resolves association candidates by phone, not client id.
      const actions = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-11T16:10:00.000Z'),
      });
      const queue = await actions.listActive({ filter: 'active' });
      const queueAlert = queue.data.find((item) => item.actionId === alert.id);
      assert.ok(queueAlert);
      assert.deepEqual(
        queueAlert.associationCandidates.map((candidate) => candidate.opportunityId).sort(),
        [fixture.ids.host, fixture.ids.sibling].sort(),
      );

      // The operator resolves the alert onto one demand without any client id.
      const resolved = await actions.associateInboundResponse({
        actionId: alert.id,
        expectedVersion: alert.version,
        opportunityId: suspendedSibling.opportunityId,
        actor: 'operator-a',
      });
      assert.equal(resolved.successor?.reasonCode, 'inbound_needs_response');
      const siblingActions = await actionsFor(suspendedSibling.opportunityId);
      assert.equal(
        siblingActions.filter(
          (row) => row.state === 'active' && row.reasonCode === 'inbound_needs_response',
        ).length,
        1,
      );
    } finally {
      process.env.EVOLUTION_INSTANCE = originalInstance;
      await fixture.cleanup();
    }
  },
);

test(
  'associating the ambiguous response to the host restores its suspended siblings',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeClientlessFixture();
    const originalInstance = process.env.EVOLUTION_INSTANCE;
    const instance = `inbound-host-resolve-${randomUUID()}`;
    process.env.EVOLUTION_INSTANCE = instance;
    try {
      const repository = createPostgresQuotationFollowUpRepository(() => db);
      await repository.applyConversationToOpenFollowUps!({
        instance,
        providerConversationId: `${fixture.phone}@s.whatsapp.net`,
        providerMessageId: `inbound-host-resolve-${randomUUID()}`,
        fromMe: false,
        occurredAt: new Date('2026-09-11T16:00:00.000Z'),
        identityStatus: 'verified',
        canonicalPhone: fixture.phone,
      });

      const rows = await db
        .select()
        .from(opportunityNextActions)
        .where(inArray(opportunityNextActions.opportunityId, [fixture.ids.host, fixture.ids.sibling]));
      const alert = rows.find(
        (row) => row.state === 'active' && row.reasonCode === 'associate_response',
      );
      const suspendedSibling = rows.find((row) => row.state === 'suspended');
      assert.ok(alert);
      assert.ok(suspendedSibling);

      const actions = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-11T16:10:00.000Z'),
      });
      await actions.associateInboundResponse({
        actionId: alert.id,
        expectedVersion: alert.version,
        opportunityId: alert.opportunityId,
        actor: 'operator-a',
      });

      const after = await db
        .select({
          opportunityId: opportunityNextActions.opportunityId,
          state: opportunityNextActions.state,
          reasonCode: opportunityNextActions.reasonCode,
        })
        .from(opportunityNextActions)
        .where(inArray(opportunityNextActions.opportunityId, [fixture.ids.host, fixture.ids.sibling]));
      assert.equal(
        after.filter(
          (row) =>
            row.opportunityId === alert.opportunityId &&
            row.state === 'active' &&
            row.reasonCode === 'inbound_needs_response',
        ).length,
        1,
      );
      assert.equal(
        after.filter(
          (row) =>
            row.opportunityId === suspendedSibling.opportunityId &&
            row.state === 'active' &&
            row.reasonCode === 'follow_up_second_return',
        ).length,
        1,
      );
    } finally {
      process.env.EVOLUTION_INSTANCE = originalInstance;
      await fixture.cleanup();
    }
  },
);
