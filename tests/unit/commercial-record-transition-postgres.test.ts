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
import {
  applyCommercialRecordTransition,
  previewCommercialRecordTransition,
} from '../../api/_infrastructure/db/repositories/commercial-record-transition-repository.js';
import { createPostgresOpportunityActionRepository } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import { createPostgresWhatsappContactActivityRepository } from '../../api/_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  clients,
  crmDeals,
  opportunityNextActions,
  whatsappContactActivity,
  whatsappContactBlockEvents,
} from '../../api/_infrastructure/db/schema.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const databaseSkip = TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL is required; this seam must run against disposable PostgreSQL.';
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
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

/** Test seam: active-action cardinality read straight from persisted state. */
async function countActiveActions(opportunityId: string): Promise<number> {
  const rows = await db
    .select({ id: opportunityNextActions.id })
    .from(opportunityNextActions)
    .where(
      and(
        eq(opportunityNextActions.opportunityId, opportunityId),
        eq(opportunityNextActions.state, 'active'),
      ),
    );
  return rows.length;
}

test(
  'preview classifies open/closed/uncertain without mutating, and authorized apply is idempotent',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clientId = randomUUID();
    const openId = randomUUID();
    const siblingId = randomUUID();
    const closedId = randomUUID();
    const now = new Date('2026-09-15T12:00:00.000Z');

    await db.insert(clients).values({ id: clientId, nome: 'Transição sintética' });
    await db.insert(crmDeals).values([
      {
        id: openId,
        clientId,
        nome: 'Demanda A',
        status: 'Orcamento Enviado',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: siblingId,
        clientId,
        nome: 'Demanda B',
        status: 'Orcamento Enviado',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: closedId,
        clientId,
        nome: 'Demanda fechada',
        status: 'Pedido Fechado',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    try {
      const preview = await previewCommercialRecordTransition(db);
      const byId = new Map(preview.decisions.map((row) => [row.opportunityId, row]));
      assert.equal(byId.get(openId)?.classification, 'uncertain_association');
      assert.equal(byId.get(siblingId)?.classification, 'uncertain_association');
      assert.equal(byId.get(closedId)?.classification, 'closed');
      assert.ok(preview.unmergedClientGroups.some((group) => group.opportunityIds.length === 2));

      const beforeOpen = await countActiveActions(openId);
      assert.equal(beforeOpen, 0);

      await assert.rejects(
        () =>
          applyCommercialRecordTransition(db, {
            authorization: { applyAuthorized: false },
            occurredAt: now,
            idFactory: randomUUID,
          }),
        /autorização operacional/i,
      );

      const first = await applyCommercialRecordTransition(db, {
        authorization: { applyAuthorized: true },
        occurredAt: now,
        idFactory: randomUUID,
      });
      assert.equal(first.messagesSent, 0);
      assert.equal(first.workerEnabled, false);
      assert.equal(first.historicalBacklogReprocessed, false);
      assert.equal(await countActiveActions(openId), 1);
      assert.equal(await countActiveActions(siblingId), 1);
      assert.equal(await countActiveActions(closedId), 0);

      const openActions = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, openId));
      assert.equal(openActions.filter((row) => row.state === 'active').length, 1);
      assert.equal(openActions[0]?.reasonCode, 'verify_conversation');
      assert.notEqual(openActions[0]?.reason, 'Sem resposta');

      const second = await applyCommercialRecordTransition(db, {
        authorization: { applyAuthorized: true },
        occurredAt: new Date('2026-09-15T13:00:00.000Z'),
        idFactory: randomUUID,
      });
      assert.equal(await countActiveActions(openId), 1);
      assert.equal(await countActiveActions(siblingId), 1);
      assert.equal(second.appliedOpportunityIds.includes(openId), false);
    } finally {
      await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, openId));
      await db
        .delete(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, siblingId));
      await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, closedId));
      await db.delete(crmDeals).where(eq(crmDeals.id, openId));
      await db.delete(crmDeals).where(eq(crmDeals.id, siblingId));
      await db.delete(crmDeals).where(eq(crmDeals.id, closedId));
      await db.delete(clients).where(eq(clients.id, clientId));
    }
  },
);

test(
  'restricted transition stays visible and unblock restores its action',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clientId = randomUUID();
    const opportunityId = randomUUID();
    const terminalOpportunityId = randomUUID();
    const activityId = randomUUID();
    const phone = '5511666555444';
    const instance = `transition-${randomUUID()}`;
    const rotatedInstance = `transition-rotated-${randomUUID()}`;
    const now = new Date('2026-09-15T12:00:00.000Z');
    await db.insert(clients).values({ id: clientId, nome: 'Contato restrito', telefone: phone });
    await db.insert(crmDeals).values([
      {
        id: opportunityId,
        clientId,
        nome: 'Demanda restrita',
        telefone: phone,
        status: 'Orcamento Enviado',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: terminalOpportunityId,
        clientId,
        nome: 'Demanda restrita encerrada',
        telefone: phone,
        status: 'Orcamento Enviado',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(whatsappContactActivity).values({
      id: activityId,
      instance,
      providerConversationId: `${phone}@s.whatsapp.net`,
      canonicalPhone: phone,
      identityStatus: 'verified',
      blockedAt: now,
      blockReason: 'do_not_contact',
      createdAt: now,
      updatedAt: now,
    });

    try {
      await applyCommercialRecordTransition(db, {
        authorization: { applyAuthorized: true },
        occurredAt: now,
        idFactory: randomUUID,
      });
      const [suspended] = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      assert.equal(suspended?.state, 'suspended');
      assert.equal(suspended?.transitionReason, 'Não contatar');

      const queue = await createPostgresOpportunityActionRepository(() => db).listActive();
      assert.equal(queue.data.find((item) => item.opportunityId === opportunityId)?.state, 'suspended');
      await db
        .update(crmDeals)
        .set({ status: 'Pedido Fechado', updatedAt: new Date('2026-09-15T12:30:00.000Z') })
        .where(eq(crmDeals.id, terminalOpportunityId));

      await createPostgresWhatsappContactActivityRepository(() => db).unblockContact({
        instance: rotatedInstance,
        canonicalPhone: phone,
        actor: 'operator-a',
        reason: 'Cliente autorizou retomada',
        now: new Date('2026-09-15T13:00:00.000Z'),
      });
      const [restored] = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      assert.equal(restored?.state, 'active');
      assert.equal(restored?.version, suspended?.version);
      const [terminalAction] = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, terminalOpportunityId));
      assert.equal(terminalAction?.state, 'suspended');
    } finally {
      await db.delete(whatsappContactBlockEvents).where(eq(whatsappContactBlockEvents.canonicalPhone, phone));
      await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, opportunityId));
      await db.delete(opportunityNextActions).where(eq(opportunityNextActions.opportunityId, terminalOpportunityId));
      await db.delete(whatsappContactActivity).where(eq(whatsappContactActivity.id, activityId));
      await db.delete(crmDeals).where(eq(crmDeals.id, opportunityId));
      await db.delete(crmDeals).where(eq(crmDeals.id, terminalOpportunityId));
      await db.delete(clients).where(eq(clients.id, clientId));
    }
  },
);
