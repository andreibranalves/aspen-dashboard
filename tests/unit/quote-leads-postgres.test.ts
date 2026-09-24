import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresQuoteLeadRepository,
  type QuoteLeadRecord,
} from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';
import { createPostgresOpportunityActionRepository } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const NOW = new Date('2026-08-10T12:00:00.000Z');
const PHONE = '5511987654321';

test(
  'Atendimento demand admission keeps the first selected text under concurrent retries',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, onnotice: () => undefined });
    const db = drizzle(client, { schema });
    const demandId = randomUUID();
    const secondDemandId = randomUUID();
    const conversationId = randomUUID();
    const repository = createPostgresQuoteLeadRepository(() => db);
    const input = (id: string, text: string, externalId = conversationId) => ({
      source: 'whatsapp', externalId, demandId: id, nome: 'Contato', telefone: PHONE,
      pedidoTexto: text, raw: { atendimentoDraft: { text, messageIds: [randomUUID()] } },
    });
    try {
      await migrate(db, { migrationsFolder });
      const [first, replay] = await Promise.all([
        repository.admitWhatsappDraft(input(demandId, 'Primeira seleção')),
        repository.admitWhatsappDraft(input(demandId, 'Outra seleção')),
      ]);
      assert.equal(first.id, replay.id);
      assert.equal(first.crmDealId, replay.crmDealId);
      assert.deepEqual(first.raw, replay.raw, 'the winner is never rewritten by the other request');
      const persisted = await repository.findByDemandId(demandId, 'whatsapp');
      assert.equal(persisted?.id, first.id);
      assert.deepEqual(persisted?.raw, first.raw);
      const second = await repository.admitWhatsappDraft(input(secondDemandId, 'Nova demanda'));
      assert.notEqual(second.id, first.id);
      await assert.rejects(
        () => repository.admitWhatsappDraft(input(demandId, 'Conflito', randomUUID())),
        (error: unknown) => (error as { statusCode?: number }).statusCode === 409,
      );
    } finally {
      const leads = await db.select({ id: schema.quoteLeads.id }).from(schema.quoteLeads)
        .where(inArray(schema.quoteLeads.demandId, [demandId, secondDemandId]));
      const ids = leads.map((row) => row.id);
      if (ids.length) {
        const deals = await db.select({ id: schema.crmDeals.id }).from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, ids));
        if (deals.length) await db.delete(schema.opportunityNextActions)
          .where(inArray(schema.opportunityNextActions.opportunityId, deals.map((row) => row.id)));
        await db.update(schema.quoteLeads).set({ crmDealId: null }).where(inArray(schema.quoteLeads.id, ids));
        await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
        await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
      }
      await client.end({ timeout: 5 });
    }
  },
);
test('active lead paths depend on KV-free pure logic only', () => {
  const repositorySource = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'api/_infrastructure/db/repositories/quote-leads-repository.ts'
    ),
    'utf8'
  );
  const pureSource = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'api/_modules/quote-leads-pure.ts'
    ),
    'utf8'
  );
  assert.match(repositorySource, /quote-leads-pure/);
  assert.doesNotMatch(repositorySource, /quote-leads-store/);
  assert.doesNotMatch(pureSource, /@vercel\/kv/);
});

function assertDistinct(record: QuoteLeadRecord) {
  assert.ok(record.id);
  assert.equal(record.telefone, PHONE);
  assert.ok(record.crmDealId);
}

test(
  'entregas Typebot sem identidade explícita não fundem contatos pelo telefone',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const externalA = `typebot-${randomUUID()}`;
    const externalB = `typebot-${randomUUID()}`;
    try {
      await migrate(db, { migrationsFolder });
      const repository = createPostgresQuoteLeadRepository(() => db, {
        now: () => NOW,
        idFactory: randomUUID,
      });

      // Same phone/e-mail, no explicit identity: two independent admissions,
      // never a merge by contact.
      const first = await repository.upsert({
        nome: 'Ana',
        telefone: '(11) 98765-4321',
        email: 'ana@example.com',
        source: 'typebot',
        externalId: externalA,
      });
      const second = await repository.upsert({
        nome: 'Ana',
        telefone: PHONE,
        email: 'ana@example.com',
        source: 'typebot',
        produto: 'Canga',
        externalId: externalB,
      });

      assertDistinct(first);
      assertDistinct(second);
      assert.notEqual(first.id, second.id, 'phone/e-mail never select an existing opportunity');
      assert.notEqual(
        first.crmDealId,
        second.crmDealId,
        'distinct demands keep distinct opportunities'
      );
      assert.notEqual(first.identityKey, second.identityKey);
      assert.equal(second.produto, 'Canga', 'the second delivery keeps its own payload');
      assert.equal(first.produto, '', 'the first admission is untouched by the second');

      const page = await createPostgresOpportunityActionRepository(() => db).listActive({
        pageSize: 100,
      });
      const summaries = page.data
        .filter(
          (row) => row.opportunityId === first.crmDealId || row.opportunityId === second.crmDealId
        )
        .map((row) => row.demandSummary)
        .sort();
      assert.equal(summaries.length, 2, 'both demands stay visible in the queue');
    } finally {
      const rows = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(inArray(schema.quoteLeads.externalId, [externalA, externalB]));
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await db
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, ids));
        const deals = await db
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, ids));
        if (deals.length) {
          await db.delete(schema.opportunityNextActions).where(
            inArray(
              schema.opportunityNextActions.opportunityId,
              deals.map((row) => row.id)
            )
          );
        }
        await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
        await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
      }
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'mesma identidade explícita repete a mesma admissão com um único deal',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const externalId = `typebot-${randomUUID()}`;
    try {
      await migrate(db, { migrationsFolder });
      const repository = createPostgresQuoteLeadRepository(() => db, {
        now: () => NOW,
        idFactory: randomUUID,
      });

      const first = await repository.upsert({
        nome: 'Ana',
        telefone: PHONE,
        source: 'typebot',
        externalId,
      });
      const retry = await repository.upsert({
        nome: 'Ana',
        telefone: PHONE,
        source: 'typebot',
        externalId,
        produto: 'Canga',
      });

      assert.equal(retry.id, first.id, 'an explicit retry identity is idempotent');
      assert.equal(retry.crmDealId, first.crmDealId);
      const rows = await db
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, externalId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.produto, 'Canga');
    } finally {
      const rows = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, externalId));
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await db
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, ids));
        const deals = await db
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, ids));
        if (deals.length) {
          await db.delete(schema.opportunityNextActions).where(
            inArray(
              schema.opportunityNextActions.opportunityId,
              deals.map((row) => row.id)
            )
          );
        }
        await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
        await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
      }
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'atribuição first-touch, status convertido e contrato de listagem limitado',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const externalId = `typebot-${randomUUID()}`;
    try {
      await migrate(db, { migrationsFolder });
      const repository = createPostgresQuoteLeadRepository(() => db, {
        now: () => NOW,
        idFactory: randomUUID,
      });

      const lead = await repository.upsert({
        nome: 'Ana',
        telefone: PHONE,
        source: 'typebot',
        externalId,
        produto: 'Canga',
        gclid: 'first-touch',
        utm_source: 'google',
      });
      const updated = await repository.update(lead.id, { status: 'converted' });
      assert.equal(updated?.status, 'converted');

      const merged = await repository.upsert({
        nome: 'Ana Atualizada',
        telefone: PHONE,
        source: 'typebot',
        externalId,
        gclid: 'second-touch',
        utm_source: 'meta',
      });
      assert.equal(merged.id, lead.id);
      assert.equal(merged.status, 'converted');
      assert.equal(merged.attribution?.gclid, 'first-touch');
      assert.equal(merged.attribution?.utm_source, 'google');

      const listed = await repository.list({ status: 'all', limit: 1 });
      assert.equal(listed.length, 1);
      assert.match(listed[0]?.texto || '', /Nome: Ana Atualizada/);
      assert.match(listed[0]?.texto || '', /Pedido: Produto: Canga/);
    } finally {
      const rows = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, externalId));
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await db
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, ids));
        const deals = await db
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, ids));
        if (deals.length) {
          await db.delete(schema.opportunityNextActions).where(
            inArray(
              schema.opportunityNextActions.opportunityId,
              deals.map((row) => row.id)
            )
          );
        }
        await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
        await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
      }
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'usa a chave de identidade explícita como gate de concorrência e não duplica deals',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const options = {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    } as const;
    const clientA = postgres(TEST_DATABASE_URL!, options);
    const clientB = postgres(TEST_DATABASE_URL!, options);
    const dbA = drizzle(clientA, { schema });
    const dbB = drizzle(clientB, { schema });
    const externalId = `typebot-${randomUUID()}`;
    try {
      await migrate(dbA, { migrationsFolder });
      const repositoryA = createPostgresQuoteLeadRepository(() => dbA, {
        now: () => NOW,
        idFactory: randomUUID,
      });
      const repositoryB = createPostgresQuoteLeadRepository(() => dbB, {
        now: () => NOW,
        idFactory: randomUUID,
      });

      const [first, second] = await Promise.all([
        repositoryA.upsert({ nome: 'Ana A', telefone: PHONE, source: 'typebot', externalId }),
        repositoryB.upsert({ nome: 'Ana B', telefone: PHONE, source: 'typebot', externalId }),
      ]);

      assert.equal(first.id, second.id);
      const leads = await dbA
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, externalId));
      const deals = await dbA
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quoteLeadId, first.id));
      assert.equal(leads.length, 1);
      assert.equal(deals.length, 1);
    } finally {
      const rows = await dbA
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, externalId));
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await dbA
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, ids));
        const deals = await dbA
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, ids));
        if (deals.length) {
          await dbA.delete(schema.opportunityNextActions).where(
            inArray(
              schema.opportunityNextActions.opportunityId,
              deals.map((row) => row.id)
            )
          );
        }
        await dbA.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
        await dbA.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
      }
      await Promise.all([clientA.end({ timeout: 5 }), clientB.end({ timeout: 5 })]);
    }
  }
);

test(
  'ingestão do site é idempotente sob concorrência, preserva snapshot e separa submissões do mesmo contato',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const options = {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    } as const;
    const clientA = postgres(TEST_DATABASE_URL!, options);
    const clientB = postgres(TEST_DATABASE_URL!, options);
    const dbA = drizzle(clientA, { schema });
    const dbB = drizzle(clientB, { schema });
    const externalA = `siteQuote.${randomUUID()}`;
    const externalB = `siteQuote.${randomUUID()}`;
    const input = {
      externalId: externalA,
      payloadFingerprint: 'a'.repeat(64),
      originalCreatedAt: '2026-09-01T10:00:00.000Z',
      nome: 'Cliente Sintético',
      email: 'synthetic@example.invalid',
      whatsapp: '21999990000',
      produto: 'Cangas',
      quantidade: '100',
      mensagem: 'Evento sintético',
      utm_source: 'google',
      gclid: 'OpaqueClickValue',
      consent: { given: true, source: 'site_quote_form' },
    };
    try {
      await migrate(dbA, { migrationsFolder });
      const repositoryA = createPostgresQuoteLeadRepository(() => dbA, {
        now: () => NOW,
        idFactory: randomUUID,
      });
      const repositoryB = createPostgresQuoteLeadRepository(() => dbB, {
        now: () => NOW,
        idFactory: randomUUID,
      });
      const [first, retry] = await Promise.all([
        repositoryA.ingestSiteSubmission(input),
        repositoryB.ingestSiteSubmission(input),
      ]);
      assert.equal(first.id, retry.id);
      assert.equal([first.created, retry.created].filter(Boolean).length, 1);

      const secondSubmission = await repositoryA.ingestSiteSubmission({
        ...input,
        externalId: externalB,
        payloadFingerprint: 'b'.repeat(64),
      });
      assert.notEqual(secondSubmission.id, first.id);

      const rows = await dbA
        .select()
        .from(schema.quoteLeads)
        .where(inArray(schema.quoteLeads.externalId, [externalA, externalB]));
      assert.equal(rows.length, 2);
      assert.equal(
        rows.every((row) => row.createdAt.toISOString() === NOW.toISOString()),
        true
      );
      const metadata = (
        rows.find((row) => row.externalId === externalA)?.raw as Record<
          string,
          Record<string, unknown>
        >
      ).siteSubmission;
      assert.equal(metadata.originalCreatedAt, input.originalCreatedAt);
      assert.equal(metadata.primaryAdIdentifier, 'gclid');
      assert.equal(
        rows.find((row) => row.externalId === externalA)?.attribution?.gclid,
        'OpaqueClickValue'
      );
      const deals = await dbA
        .select()
        .from(schema.crmDeals)
        .where(
          inArray(
            schema.crmDeals.quoteLeadId,
            rows.map((row) => row.id)
          )
        );
      assert.equal(deals.length, 2);

      await assert.rejects(
        repositoryA.ingestSiteSubmission({
          ...input,
          payloadFingerprint: 'c'.repeat(64),
          utm_source: 'later-visit',
        }),
        (error: unknown) => (error as { statusCode?: number }).statusCode === 409
      );
      const preserved = await dbA
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, externalA));
      assert.equal(preserved[0]?.attribution?.utm_source, 'google');
    } finally {
      const rows = await dbA
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(inArray(schema.quoteLeads.externalId, [externalA, externalB]));
      if (rows.length) {
        const ids = rows.map((row) => row.id);
        await dbA
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, ids));
        const deals = await dbA
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, ids));
        if (deals.length) {
          await dbA.delete(schema.opportunityNextActions).where(
            inArray(
              schema.opportunityNextActions.opportunityId,
              deals.map((row) => row.id)
            )
          );
        }
        await dbA.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
        await dbA.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
      }
      await Promise.all([clientA.end({ timeout: 5 }), clientB.end({ timeout: 5 })]);
    }
  }
);

test(
  'falha ao criar oportunidade reverte integralmente o lead do site',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const externalId = `siteQuote.${randomUUID()}`;
    const ids = [randomUUID(), 'invalid-deal-id'];
    try {
      await migrate(db, { migrationsFolder });
      const repository = createPostgresQuoteLeadRepository(() => db, {
        now: () => NOW,
        idFactory: () => ids.shift() || 'invalid-id',
      });
      await assert.rejects(
        repository.ingestSiteSubmission({
          externalId,
          payloadFingerprint: 'd'.repeat(64),
          originalCreatedAt: '2026-09-01T10:00:00.000Z',
          nome: 'Cliente Sintético',
          email: 'synthetic@example.invalid',
          whatsapp: '21999990000',
          produto: 'Cangas',
          quantidade: '100',
          consent: { given: true, source: 'site_quote_form' },
        })
      );
      const rows = await db
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, externalId));
      assert.equal(rows.length, 0);
    } finally {
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'explicit demand identities never fuse and are reachable by their own key',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const conversation = `demand-identity-${randomUUID()}`;
    const cleanupIds = async () => {
      const rows = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, conversation));
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) return;
      await db
        .update(schema.quoteLeads)
        .set({ crmDealId: null })
        .where(inArray(schema.quoteLeads.id, ids));
      const deals = await db
        .select({ id: schema.crmDeals.id })
        .from(schema.crmDeals)
        .where(inArray(schema.crmDeals.quoteLeadId, ids));
      if (deals.length) {
        await db.delete(schema.opportunityNextActions).where(
          inArray(
            schema.opportunityNextActions.opportunityId,
            deals.map((row) => row.id)
          )
        );
      }
      await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
      await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
    };
    try {
      await migrate(db, { migrationsFolder });
      await cleanupIds();
      const repository = createPostgresQuoteLeadRepository(() => db, {
        now: () => NOW,
        idFactory: randomUUID,
      });
      const base = {
        nome: 'Cliente Sintético',
        telefone: PHONE,
        source: 'whatsapp',
        externalId: conversation,
      };

      const alpha = await repository.upsert({
        ...base,
        demandId: 'demand-alpha',
        produto: 'Canga',
      });
      const alphaRetry = await repository.upsert({
        ...base,
        demandId: 'demand-alpha',
        produto: 'Canga',
      });
      const beta = await repository.upsert({ ...base, demandId: 'demand-beta', produto: 'Toalha' });

      assert.equal(alpha.id, alphaRetry.id, 'the same demand identity is idempotent');
      assert.equal(alpha.created, true);
      assert.equal(alphaRetry.created, false);
      assert.notEqual(beta.id, alpha.id, 'a second demand is admitted separately');
      assert.equal(new Set([alpha.crmDealId, beta.crmDealId]).size, 2);

      assert.equal((await repository.findByDemandId('demand-alpha', 'whatsapp'))?.id, alpha.id);
      assert.equal((await repository.findByDemandId('demand-beta', 'whatsapp'))?.id, beta.id);
      assert.equal(await repository.findByDemandId('demand-missing', 'whatsapp'), null);

      const page = await createPostgresOpportunityActionRepository(() => db).listActive({
        pageSize: 100,
      });
      const summaries = page.data
        .filter(
          (row) => row.opportunityId === alpha.crmDealId || row.opportunityId === beta.crmDealId
        )
        .map((row) => row.demandSummary)
        .sort();
      assert.deepEqual(summaries, ['Produto: Canga', 'Produto: Toalha']);
    } finally {
      await cleanupIds();
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'identidade ausente usa o id da admissão: mesmo telefone não escolhe oportunidade existente',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const cleanupIds = async () => {
      const rows = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(
          and(eq(schema.quoteLeads.source, 'whatsapp'), eq(schema.quoteLeads.telefone, PHONE))
        );
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) return;
      await db
        .update(schema.quoteLeads)
        .set({ crmDealId: null })
        .where(inArray(schema.quoteLeads.id, ids));
      const deals = await db
        .select({ id: schema.crmDeals.id })
        .from(schema.crmDeals)
        .where(inArray(schema.crmDeals.quoteLeadId, ids));
      if (deals.length) {
        await db.delete(schema.opportunityNextActions).where(
          inArray(
            schema.opportunityNextActions.opportunityId,
            deals.map((row) => row.id)
          )
        );
      }
      await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
      await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
    };
    try {
      await migrate(db, { migrationsFolder });
      await cleanupIds();
      const repository = createPostgresQuoteLeadRepository(() => db, {
        now: () => NOW,
        idFactory: randomUUID,
      });
      // Sem demandId e sem externalId: nada além do contato é informado. Cada
      // admissão tem sua própria identidade — o telefone NUNCA funde nem
      // seleciona uma oportunidade existente, e o payload não é usado para
      // forjar uma idempotência estável.
      const first = await repository.upsert({
        nome: 'Mesmo Telefone',
        telefone: PHONE,
        source: 'whatsapp',
        produto: 'Canga',
      });
      const second = await repository.upsert({
        nome: 'Mesmo Telefone',
        telefone: PHONE,
        source: 'whatsapp',
        produto: 'Toalha',
      });
      const third = await repository.upsert({
        nome: 'Mesmo Telefone',
        telefone: PHONE,
        source: 'whatsapp',
        produto: 'Canga',
      });

      assert.notEqual(
        second.id,
        first.id,
        'shared phone must not select or merge the existing opportunity'
      );
      assert.notEqual(second.crmDealId, first.crmDealId);
      assert.notEqual(second.identityKey, first.identityKey);
      assert.notEqual(
        third.id,
        first.id,
        'an identical payload without an explicit identity is not deduplicated by hash'
      );
      assert.equal(
        new Set([first.identityKey, second.identityKey, third.identityKey]).size,
        3,
        'each absent-identity admission gets its own identity'
      );
    } finally {
      await cleanupIds();
      await client.end({ timeout: 5 });
    }
  }
);
