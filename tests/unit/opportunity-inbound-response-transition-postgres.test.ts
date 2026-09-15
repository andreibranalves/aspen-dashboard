import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import {
  applyAssociateResponseTransition,
  applyInboundResponseTransition,
  resolveAssociateResponseToOpportunity,
} from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
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
  await db.insert(clients).values({ id: ids.client, nome: 'Resposta sintética' });
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
  'resolveAssociateResponseToOpportunity turns Associar resposta into Preciso responder',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const fixture = await makeFixture();
    const sibling = randomUUID();
    await db.insert(crmDeals).values({
      id: sibling,
      clientId: fixture.ids.client,
      nome: 'Demanda irmã',
      status: 'Orcamento Enviado',
      createdAt: fixture.now,
      updatedAt: fixture.now,
    });
    try {
      await insertActiveAction(fixture, 'follow_up_second_return');
      await db.insert(opportunityNextActions).values({
        id: randomUUID(),
        opportunityId: sibling,
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
      });

      await applyAssociateResponseTransition({
        database: db,
        opportunityId: fixture.ids.opportunity,
        occurredAt: fixture.now,
        idFactory: randomUUID,
        actor: 'system',
      });
      await applyAssociateResponseTransition({
        database: db,
        opportunityId: sibling,
        occurredAt: fixture.now,
        idFactory: randomUUID,
        actor: 'system',
      });

      const resolved = await resolveAssociateResponseToOpportunity({
        database: db,
        clientId: fixture.ids.client,
        opportunityId: fixture.ids.opportunity,
        occurredAt: new Date('2026-09-11T16:00:00.000Z'),
        idFactory: randomUUID,
        actor: 'operator-a',
      });
      assert.equal(resolved.state, 'completed');
      assert.equal(resolved.action?.reasonCode, 'associate_response');
      assert.equal(resolved.successor?.reasonCode, 'inbound_needs_response');

      const host = await actionsFor(fixture.ids.opportunity);
      assert.equal(host.filter((row) => row.state === 'active').length, 1);
      assert.equal(host.find((row) => row.state === 'active')?.reasonCode, 'inbound_needs_response');

      const sister = await actionsFor(sibling);
      assert.equal(
        sister.filter((row) => row.state === 'active' && row.reasonCode === 'associate_response').length,
        0,
      );
    } finally {
      await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, sibling));
      await db.delete(crmDeals).where(eq(crmDeals.id, sibling));
      await fixture.cleanup();
    }
  },
);
