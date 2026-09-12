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
  OpportunityActionInputError,
  type ManualContactInput,
} from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  crmDeals,
  manualContactEvents,
  opportunityNextActions,
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
    nome: `Contato manual ${id.slice(0, 8)}`,
    status: 'Novo Lead',
    followUpStage: 0,
    nextStep: 'não deve ser alterado',
  });
  return id;
}

async function action(opportunityId: string): Promise<{ actionId: string; version: number }> {
  const repository = createPostgresOpportunityActionRepository(() => db, {
    now: () => new Date('2026-09-12T12:00:00.000Z'),
  });
  const created = await repository.createAction({
    opportunityId,
    kind: 'customer_contact',
    dueDate: '2026-09-12',
    dueTime: '09:00',
    reason: 'Fazer atendimento',
    actor: 'synthetic-operator',
  });
  return { actionId: created.actionId, version: created.version };
}

function contact(
  opportunityId: string,
  actionId: string,
  expectedVersion: number,
  overrides: Partial<ManualContactInput> = {}
): ManualContactInput {
  return {
    commandId: randomUUID(),
    opportunityId,
    actionId,
    expectedVersion,
    contactType: 'phone_call',
    occurredAt: new Date('2026-09-12T11:30:00.000Z'),
    note: 'Cliente confirmou interesse.',
    resultCode: 'follow_up_agreed',
    countsAsFollowUp: true,
    actor: 'synthetic-operator',
    continuation: {
      type: 'successor',
      schedule: {
        kind: 'review',
        dueDate: '2026-09-15',
        dueTime: '14:00',
        reason: 'Revisar retorno combinado',
      },
    },
    ...overrides,
  };
}

async function cleanup(opportunityId: string): Promise<void> {
  await sql`DELETE FROM manual_contact_events WHERE opportunity_id = ${opportunityId}::uuid`;
  await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id = ${opportunityId}::uuid`;
  await sql`DELETE FROM crm_deals WHERE id = ${opportunityId}::uuid`;
}

test(
  'contato concluído incrementa follow_up_stage uma vez e cria uma sucessora idempotente',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-12T12:00:00.000Z'),
      });
      const input = contact(opportunityId, initial.actionId, initial.version);
      const first = await repository.recordManualContact(input);
      const retry = await repository.recordManualContact(input);

      assert.deepEqual(retry, first);
      assert.equal(first.successor?.actionId, retry.successor?.actionId);
      const [deal] = await db
        .select({ followUpStage: crmDeals.followUpStage, nextStep: crmDeals.nextStep })
        .from(crmDeals)
        .where(eq(crmDeals.id, opportunityId));
      assert.equal(deal?.followUpStage, 1);
      assert.equal(deal?.nextStep, 'não deve ser alterado');
      const events = await db
        .select()
        .from(manualContactEvents)
        .where(eq(manualContactEvents.opportunityId, opportunityId));
      assert.equal(events.length, 1);
      assert.equal(events[0]?.source, 'operator_statement');
      assert.equal(events[0]?.successorActionId, first.successor?.actionId);
      const history = await repository.listHistory(opportunityId);
      const manualEntry = history.find((entry) => entry.type === 'manual_contact');
      assert.equal(manualEntry?.source, 'operator_statement');
      assert.equal(manualEntry?.resultCode, 'follow_up_agreed');
      assert.equal(manualEntry?.continuationType, 'successor');
      const actions = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      assert.equal(actions.length, 2);
      assert.equal(actions.filter((row) => row.state === 'active').length, 1);
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'replay de contato preserva o snapshot da sucessora depois que ela muda',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-12T12:00:00.000Z'),
      });
      const input = contact(opportunityId, initial.actionId, initial.version);
      const first = await repository.recordManualContact(input);
      const originalSuccessor = first.successor;
      assert.ok(originalSuccessor);

      const changedSuccessor = await repository.completeAction({
        actionId: originalSuccessor.actionId,
        expectedVersion: originalSuccessor.version,
        actor: 'synthetic-operator',
        now: new Date('2026-09-12T13:00:00.000Z'),
        successor: {
          kind: 'review',
          dueDate: '2026-09-20',
          dueTime: null,
          reason: 'Nova etapa após a sucessora original',
        },
      });
      assert.equal(changedSuccessor.action?.state, 'completed');
      assert.notEqual(changedSuccessor.action?.updatedAt, originalSuccessor.updatedAt);

      const retry = await repository.recordManualContact(input);

      assert.deepEqual(retry, first);
      assert.equal(retry.successor?.actionId, originalSuccessor.actionId);
      assert.equal(retry.successor?.state, 'active');
      assert.equal(retry.successor?.version, originalSuccessor.version);
      assert.equal(retry.successor?.transitionAt, null);
      assert.equal(retry.successor?.replacedById, null);
      assert.equal(retry.successor?.createdAt, originalSuccessor.createdAt);
      assert.equal(retry.successor?.updatedAt, originalSuccessor.updatedAt);
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'histórico intercala dois contatos manuais na cadeia causal das ações',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db, {
        now: () => new Date('2026-09-12T12:00:00.000Z'),
      });
      const first = await repository.recordManualContact(
        contact(opportunityId, initial.actionId, initial.version, {
          occurredAt: new Date('2026-09-12T11:30:00.000Z'),
        })
      );
      assert.ok(first.successor);
      const second = await repository.recordManualContact(
        contact(opportunityId, first.successor.actionId, first.successor.version, {
          occurredAt: new Date('2026-09-12T11:45:00.000Z'),
          resultCode: 'interested',
        })
      );
      assert.ok(second.successor);

      const history = await repository.listHistory(opportunityId);
      const eventIds = history.map((entry) => entry.eventId);
      const firstDeclaration = eventIds.indexOf(first.eventId);
      const firstSuccessorCreation = eventIds.indexOf(`${first.successor.actionId}:created`);
      const secondTransition = eventIds.indexOf(`${first.successor.actionId}:completed`);
      const secondSuccessorCreation = eventIds.indexOf(`${second.successor!.actionId}:created`);

      assert.ok(firstDeclaration >= 0);
      assert.ok(firstDeclaration < firstSuccessorCreation);
      assert.ok(firstDeclaration < secondTransition);
      assert.ok(firstDeclaration < secondSuccessorCreation);
      assert.equal(history[firstDeclaration]?.occurredAt, '2026-09-12T11:30:00.000Z');
      assert.equal(history[firstDeclaration]?.timestamp, '2026-09-12T12:00:00.000Z');
      assert.equal(
        history[eventIds.indexOf(second.eventId)]?.occurredAt,
        '2026-09-12T11:45:00.000Z'
      );
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'data impossível de contato é rejeitada sem alterar evento, ação ou contador',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db);
      const before = await db
        .select({ state: opportunityNextActions.state, version: opportunityNextActions.version })
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      const [{ events, actions, followUps }] = await sql<
        { events: number; actions: number; followUps: number }[]
      >`
        SELECT
          (SELECT count(*)::int FROM manual_contact_events WHERE opportunity_id = ${opportunityId}::uuid) AS events,
          (SELECT count(*)::int FROM opportunity_next_actions WHERE opportunity_id = ${opportunityId}::uuid) AS actions,
          (SELECT follow_up_stage FROM crm_deals WHERE id = ${opportunityId}::uuid) AS "followUps"
      `;

      await assert.rejects(
        () =>
          repository.recordManualContact(
            contact(opportunityId, initial.actionId, initial.version, {
              occurredAt: '2026-02-31T10:00:00-03:00',
            })
          ),
        (error: unknown) => error instanceof OpportunityActionInputError
      );

      const after = await db
        .select({ state: opportunityNextActions.state, version: opportunityNextActions.version })
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      const [{ events: afterEvents, actions: afterActions, followUps: afterFollowUps }] = await sql<
        { events: number; actions: number; followUps: number }[]
      >`
        SELECT
          (SELECT count(*)::int FROM manual_contact_events WHERE opportunity_id = ${opportunityId}::uuid) AS events,
          (SELECT count(*)::int FROM opportunity_next_actions WHERE opportunity_id = ${opportunityId}::uuid) AS actions,
          (SELECT follow_up_stage FROM crm_deals WHERE id = ${opportunityId}::uuid) AS "followUps"
      `;

      assert.deepEqual(after, before);
      assert.deepEqual(
        { events: afterEvents, actions: afterActions, followUps: afterFollowUps },
        { events, actions, followUps }
      );
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'contato não contado e espera preservam o contador e criam uma ação normal',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db);
      const result = await repository.recordManualContact(
        contact(opportunityId, initial.actionId, initial.version, {
          contactType: 'external_conversation',
          resultCode: 'no_response',
          countsAsFollowUp: false,
          continuation: {
            type: 'wait',
            schedule: {
              kind: 'review',
              dueDate: '2026-09-18',
              dueTime: null,
              reason: 'Aguardar decisão do cliente',
            },
          },
        })
      );

      assert.equal(result.continuationType, 'wait');
      assert.ok(result.successor);
      const [deal] = await db
        .select({ followUpStage: crmDeals.followUpStage })
        .from(crmDeals)
        .where(eq(crmDeals.id, opportunityId));
      assert.equal(deal?.followUpStage, 0);
      const [successor] = await db
        .select()
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.id, result.successor!.actionId));
      assert.equal(successor?.scheduleType, 'date_only');
      const active = await db
        .select({ id: opportunityNextActions.id })
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, opportunityId));
      assert.equal(active.length, 2, 'waiting uses the existing next-action table');
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'aguardando informação é um resultado manual persistível com continuidade única',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db);
      const result = await repository.recordManualContact(
        contact(opportunityId, initial.actionId, initial.version, {
          resultCode: 'awaiting_information',
          countsAsFollowUp: false,
          continuation: {
            type: 'wait',
            schedule: {
              kind: 'customer_contact',
              dueDate: '2026-09-15',
              dueTime: null,
              reason: 'Acompanhar informações pendentes',
            },
          },
        })
      );

      assert.equal(result.resultCode, 'awaiting_information');
      assert.equal(result.continuationType, 'wait');
      const [event] = await db
        .select({ resultCode: manualContactEvents.resultCode })
        .from(manualContactEvents)
        .where(eq(manualContactEvents.opportunityId, opportunityId));
      assert.equal(event?.resultCode, 'awaiting_information');
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'fechamento manual exige e armazena o motivo explícito',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db);
      const result = await repository.recordManualContact(
        contact(opportunityId, initial.actionId, initial.version, {
          resultCode: 'not_interested',
          countsAsFollowUp: false,
          continuation: { type: 'close', reason: 'Cliente decidiu não prosseguir.' },
        })
      );
      assert.equal(result.closed, true);
      const [deal] = await db
        .select({ status: crmDeals.status, lostReason: crmDeals.lostReason })
        .from(crmDeals)
        .where(eq(crmDeals.id, opportunityId));
      assert.equal(deal?.status, 'Perdido');
      assert.equal(deal?.lostReason, 'Cliente decidiu não prosseguir.');
      const [event] = await db
        .select({ closeReason: manualContactEvents.closeReason })
        .from(manualContactEvents)
        .where(eq(manualContactEvents.opportunityId, opportunityId));
      assert.equal(event?.closeReason, 'Cliente decidiu não prosseguir.');
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'mesma chave com payload diferente é conflito e não altera o histórico',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db);
      const input = contact(opportunityId, initial.actionId, initial.version);
      await repository.recordManualContact(input);
      await assert.rejects(
        () => repository.recordManualContact({ ...input, note: 'Payload adulterado.' }),
        (error: unknown) => error instanceof ActionConflictError
      );
      const [deal] = await db
        .select({ followUpStage: crmDeals.followUpStage })
        .from(crmDeals)
        .where(eq(crmDeals.id, opportunityId));
      assert.equal(deal?.followUpStage, 1);
      const events = await db
        .select({ id: manualContactEvents.id })
        .from(manualContactEvents)
        .where(eq(manualContactEvents.opportunityId, opportunityId));
      assert.equal(events.length, 1);
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'duas conexões correndo o mesmo comando produzem um evento, contador e sucessora',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    const firstSql = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    const secondSql = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    const firstDb = drizzle(firstSql, { schema });
    const secondDb = drizzle(secondSql, { schema });
    try {
      const initial = await action(opportunityId);
      const input = contact(opportunityId, initial.actionId, initial.version, {
        commandId: randomUUID(),
      });
      const firstRepository = createPostgresOpportunityActionRepository(() => firstDb);
      const secondRepository = createPostgresOpportunityActionRepository(() => secondDb);
      const results = await Promise.all([
        firstRepository.recordManualContact(input),
        secondRepository.recordManualContact(input),
      ]);
      assert.deepEqual(results[1], results[0]);
      const [{ count }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM manual_contact_events
        WHERE opportunity_id = ${opportunityId}::uuid
      `;
      const [{ follow_up_stage: followUpStage }] = await sql<{ follow_up_stage: number }[]>`
        SELECT follow_up_stage FROM crm_deals WHERE id = ${opportunityId}::uuid
      `;
      assert.equal(count, 1);
      assert.equal(followUpStage, 1);
    } finally {
      await firstSql.end({ timeout: 5 });
      await secondSql.end({ timeout: 5 });
      await cleanup(opportunityId);
    }
  }
);

test(
  'contato sem continuidade é rejeitado antes de gravar evento',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db);
      await assert.rejects(
        () =>
          repository.recordManualContact(
            contact(opportunityId, initial.actionId, initial.version, { continuation: undefined })
          ),
        /continuidade|sucessora|aguardar|fechar/i
      );
      const events = await db
        .select({ id: manualContactEvents.id })
        .from(manualContactEvents)
        .where(eq(manualContactEvents.opportunityId, opportunityId));
      assert.equal(events.length, 0);
    } finally {
      await cleanup(opportunityId);
    }
  }
);

test(
  'reagendar ou concluir a ação existente sem contato não incrementa o ciclo',
  { skip: databaseSkip, concurrency: false },
  async () => {
    const opportunityId = await opportunity();
    try {
      const initial = await action(opportunityId);
      const repository = createPostgresOpportunityActionRepository(() => db);
      const rescheduled = await repository.rescheduleAction({
        actionId: initial.actionId,
        expectedVersion: initial.version,
        kind: 'review',
        dueDate: '2026-09-16',
        dueTime: null,
        reason: 'Aguardar documento',
        actor: 'synthetic-operator',
      });
      await repository.completeAction({
        actionId: rescheduled.successor!.actionId,
        expectedVersion: rescheduled.successor!.version,
        actor: 'synthetic-operator',
        successor: {
          kind: 'review',
          dueDate: '2026-09-17',
          dueTime: null,
          reason: 'Revisar documento',
        },
      });
      const [deal] = await db
        .select({ followUpStage: crmDeals.followUpStage })
        .from(crmDeals)
        .where(eq(crmDeals.id, opportunityId));
      assert.equal(deal?.followUpStage, 0);
    } finally {
      await cleanup(opportunityId);
    }
  }
);
