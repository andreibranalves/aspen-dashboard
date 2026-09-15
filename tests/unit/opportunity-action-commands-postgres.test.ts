import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import {
  ActionConflictError,
  createPostgresOpportunityActionRepository,
} from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { clients, crmDeals, opportunityNextActions, whatsappContactActivity } from '../../api/_infrastructure/db/schema.js';
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

let sql: postgres.Sql;
let db: AppDatabase;

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  sql = postgres(TEST_DATABASE_URL, { max: 4, prepare: false, onnotice: () => {} });
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder });
});

test.after(async () => {
  await sql?.end({ timeout: 5 });
});

async function opportunity(): Promise<string> {
  const id = randomUUID();
  await db.insert(crmDeals).values({
    id,
    nome: `Ação sintética ${id.slice(0, 8)}`,
    status: 'Novo Lead',
    followUpStage: 0,
  });
  return id;
}

async function cleanup(opportunityId: string): Promise<void> {
  await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id = ${opportunityId}::uuid`;
  await sql`DELETE FROM crm_deals WHERE id = ${opportunityId}::uuid`;
}

test(
  'cria agenda civil e calcula Hoje/Atrasada sem deslocar ação de dia inteiro',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-12T02:59:59.000Z'),
      });
      const created = await repository.createAction({
        opportunityId,
        kind: 'internal',
        dueDate: '2026-09-11',
        dueTime: null,
        reason: 'Separar amostras',
        actor: 'synthetic-operator',
      });

      assert.equal(created.action?.scheduleType, 'date_only');
      assert.equal(created.action?.dueDate, '2026-09-11');
      assert.equal(created.action?.dueTime, null);
      assert.equal(created.action?.version, 1);

      const beforeLocalMidnight = await repository.listActive();
      assert.equal(beforeLocalMidnight.data[0]?.dueStatus, 'today');

      const afterLocalMidnight = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-12T03:00:00.000Z'),
      });
      assert.equal((await afterLocalMidnight.listActive()).data[0]?.dueStatus, 'overdue');
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'reagenda preservando a linha antiga e expõe criação e substituição no histórico',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-11T12:00:00.000Z'),
      });
      const first = await repository.createAction({
        opportunityId,
        kind: 'customer_contact',
        dueDate: '2026-09-12',
        dueTime: '10:30',
        reason: 'Confirmar medida',
        actor: 'operator-a',
      });
      const replacement = await repository.rescheduleAction({
        actionId: first.actionId,
        expectedVersion: first.version,
        kind: 'customer_contact',
        dueDate: '2026-09-13',
        dueTime: null,
        reason: 'Cliente pediu retorno na segunda',
        actor: 'operator-a',
      });

      assert.equal(replacement.successor?.scheduleType, 'date_only');
      const rows = await db
        .select({ state: opportunityNextActions.state, replacedById: opportunityNextActions.replacedById })
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      assert.equal(rows.length, 2);
      const old = rows.find((row) => row.state === 'superseded');
      assert.equal(old?.replacedById, replacement.successor?.actionId);

      const history = await repository.listHistory(opportunityId);
      assert.deepEqual(
        history.map((entry) => entry.type),
        ['created', 'rescheduled', 'created']
      );
      assert.equal(history[1]?.actor, 'operator-a');
      assert.equal(history[1]?.origin, 'manual');
      assert.equal(history[1]?.reason, 'Cliente pediu retorno na segunda');
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'separa a origem da criação da origem da transição no histórico',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-11T12:00:00.000Z'),
      });
      const first = await repository.createAction({
        opportunityId,
        kind: 'first_contact',
        dueDate: '2026-09-12',
        dueTime: '10:30',
        reason: 'Primeiro atendimento automático',
        origin: 'automatic',
        actor: 'system',
      });

      await repository.rescheduleAction({
        actionId: first.actionId,
        expectedVersion: first.version,
        kind: 'first_contact',
        dueDate: '2026-09-13',
        dueTime: '10:30',
        reason: 'Operador reagendou o atendimento',
        transitionOrigin: 'manual',
        actor: 'operator-a',
      });

      const [persisted] = await db
        .select({ transitionOrigin: opportunityNextActions.transitionOrigin })
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.id, first.actionId));
      assert.equal(persisted?.transitionOrigin, 'manual');

      const history = await repository.listHistory(opportunityId);
      const creation = history.find(
        (entry) => entry.actionId === first.actionId && entry.type === 'created'
      );
      const transition = history.find(
        (entry) => entry.actionId === first.actionId && entry.type === 'rescheduled'
      );
      assert.equal(creation?.origin, 'automatic');
      assert.equal(transition?.origin, 'manual');
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'concluir exige exatamente sucessor ou fechamento e mantém continuidade na transação',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-11T12:00:00.000Z'),
      });
      const first = await repository.createAction({
        opportunityId,
        kind: 'first_contact',
        dueDate: '2026-09-11',
        dueTime: '09:00',
        reason: 'Primeiro atendimento',
        actor: 'operator-a',
      });

      await assert.rejects(
        () =>
          repository.completeAction({
            actionId: first.actionId,
            expectedVersion: first.version,
            actor: 'operator-a',
          }),
        /sucessora|fechar/i
      );

      const completed = await repository.completeAction({
        actionId: first.actionId,
        expectedVersion: first.version,
        actor: 'operator-a',
        successor: {
          kind: 'review',
          dueDate: '2026-09-12',
          dueTime: '14:00',
          reason: 'Revisar retorno',
        },
      });
      assert.equal(completed.successor?.scheduleType, 'timed');
      assert.equal((await repository.listActive()).total, 1);
      assert.equal((await repository.listHistory(opportunityId)).some((entry) => entry.type === 'completed'), true);
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'duas conexões independentes não conseguem aplicar o mesmo token duas vezes',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    const firstSql = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    const secondSql = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    const firstDb = drizzle(firstSql, { schema });
    const secondDb = drizzle(secondSql, { schema });
    try {
      const firstRepository = createPostgresOpportunityActionRepository(() => firstDb);
      const secondRepository = createPostgresOpportunityActionRepository(() => secondDb);
      const initial = await firstRepository.createAction({
        opportunityId,
        kind: 'internal',
        dueDate: '2026-09-12',
        dueTime: null,
        reason: 'Preparar retorno',
        actor: 'operator-a',
      });
      const commands = await Promise.allSettled([
        firstRepository.rescheduleAction({
          actionId: initial.actionId,
          expectedVersion: initial.version,
          kind: 'review',
          dueDate: '2026-09-13',
          dueTime: null,
          reason: 'Primeiro comando',
          actor: 'operator-a',
        }),
        secondRepository.rescheduleAction({
          actionId: initial.actionId,
          expectedVersion: initial.version,
          kind: 'review',
          dueDate: '2026-09-14',
          dueTime: null,
          reason: 'Comando atrasado',
          actor: 'operator-b',
        }),
      ]);
      assert.equal(commands.filter((command) => command.status === 'fulfilled').length, 1);
      assert.equal(
        commands.filter(
          (command) => command.status === 'rejected' && command.reason instanceof ActionConflictError
        ).length,
        1
      );
      assert.equal((await firstRepository.listActive()).total, 1);
      assert.equal((await firstRepository.listHistory(opportunityId)).filter((entry) => entry.type === 'rescheduled').length, 1);
    } finally {
      await firstSql.end({ timeout: 5 });
      await secondSql.end({ timeout: 5 });
      await cleanup(opportunityId);
    }
  }
);

test(
  'encerramento manual exige motivo, remove da fila ativa e não bloqueia o contato nem outra demanda',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const clientId = randomUUID();
    const firstId = randomUUID();
    const secondId = randomUUID();
    await db.insert(clients).values({ id: clientId, nome: 'Cliente encerramento' });
    await db.insert(crmDeals).values([
      {
        id: firstId,
        clientId,
        nome: 'Demanda A',
        status: 'Novo Lead',
        followUpStage: 0,
      },
      {
        id: secondId,
        clientId,
        nome: 'Demanda B',
        status: 'Novo Lead',
        followUpStage: 0,
      },
    ]);
    await db.insert(whatsappContactActivity).values({
      id: randomUUID(),
      instance: 'close-test',
      providerConversationId: '5511999888777@s.whatsapp.net',
      canonicalPhone: '5511999888777',
      identityStatus: 'verified',
      lastInboundAt: null,
      lastOutboundAt: null,
      blockedAt: null,
      blockReason: null,
      createdAt: new Date('2026-09-11T12:00:00.000Z'),
      updatedAt: new Date('2026-09-11T12:00:00.000Z'),
    });
    try {
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-11T12:00:00.000Z'),
      });
      const first = await repository.createAction({
        opportunityId: firstId,
        kind: 'customer_contact',
        dueDate: '2026-09-11',
        dueTime: null,
        reason: 'Retorno comercial',
        actor: 'operator-a',
      });
      const second = await repository.createAction({
        opportunityId: secondId,
        kind: 'customer_contact',
        dueDate: '2026-09-12',
        dueTime: null,
        reason: 'Outra demanda',
        actor: 'operator-a',
      });

      await assert.rejects(
        () =>
          repository.completeAction({
            actionId: first.actionId,
            expectedVersion: first.version,
            actor: 'operator-a',
            close: { reason: '   ' },
          }),
        /motivo/i,
      );

      const closed = await repository.completeAction({
        actionId: first.actionId,
        expectedVersion: first.version,
        actor: 'operator-a',
        close: { reason: 'Sem interesse no momento' },
      });
      assert.equal(closed.closed, true);
      assert.equal(closed.successor, null);

      const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, firstId));
      assert.equal(deal?.status, 'Perdido');
      assert.equal(deal?.lostReason, 'Sem interesse no momento');

      const active = await repository.listActive();
      assert.equal(active.data.some((row) => row.opportunityId === firstId), false);
      assert.equal(active.data.some((row) => row.opportunityId === secondId), true);

      const [sibling] = await db.select().from(crmDeals).where(eq(crmDeals.id, secondId));
      assert.equal(sibling?.status, 'Novo Lead');

      const activity = await db
        .select()
        .from(whatsappContactActivity)
        .where(eq(whatsappContactActivity.canonicalPhone, '5511999888777'));
      assert.equal(activity[0]?.blockedAt, null);
      assert.equal(activity[0]?.blockReason, null);

      // Repeated close on a terminal opportunity must not invent a new active action.
      await assert.rejects(
        () =>
          repository.completeAction({
            actionId: first.actionId,
            expectedVersion: first.version,
            actor: 'operator-a',
            close: { reason: 'Repetir fechamento' },
          }),
      );
      const history = await repository.listHistory(firstId);
      assert.equal(history.filter((entry) => entry.type === 'completed' || entry.type === 'closed').length >= 1, true);
      const stillActiveSecond = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.id, second.actionId));
      assert.equal(stillActiveSecond[0]?.state, 'active');
    } finally {
      await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id IN (${firstId}::uuid, ${secondId}::uuid)`;
      await sql`DELETE FROM whatsapp_contact_activity WHERE canonical_phone = ${'5511999888777'}`;
      await sql`DELETE FROM crm_deals WHERE id IN (${firstId}::uuid, ${secondId}::uuid)`;
      await sql`DELETE FROM clients WHERE id = ${clientId}::uuid`;
    }
  }
);

