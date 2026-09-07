import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresQuoteLeadRepository,
  type QuoteLeadRecord,
} from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';

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

async function cleanup(db: ReturnType<typeof drizzle>, identityKey = 'phone:11987654321') {
  const leads = await db
    .select({ id: schema.quoteLeads.id })
    .from(schema.quoteLeads)
    .where(
      and(eq(schema.quoteLeads.identityKey, identityKey), eq(schema.quoteLeads.source, 'typebot'))
    );
  const ids = leads.map((row) => row.id);
  if (ids.length > 0) {
    await db
      .update(schema.quoteLeads)
      .set({ crmDealId: null })
      .where(inArray(schema.quoteLeads.id, ids));
    await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, ids));
    await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, ids));
  }
}

function assertRecord(record: QuoteLeadRecord) {
  assert.ok(record.id);
  assert.equal(record.telefone, PHONE);
  assert.equal(record.identityKey, 'phone:11987654321');
  assert.ok(record.crmDealId);
}

test(
  'mescla entregas Typebot repetidas por identidade normalizada e cria um único deal local',
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
    try {
      await migrate(db, { migrationsFolder });
      await cleanup(db);
      const repository = createPostgresQuoteLeadRepository(() => db, {
        now: () => NOW,
        idFactory: randomUUID,
      });

      const first = await repository.upsert({
        nome: 'Ana',
        telefone: '(11) 98765-4321',
        source: 'typebot',
      });
      const second = await repository.upsert({
        nome: 'Ana',
        telefone: PHONE,
        produto: 'Canga',
      });

      assertRecord(first);
      assertRecord(second);
      assert.equal(first.id, second.id);
      assert.equal(second.produto, 'Canga');
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.quoteLeads);
      assert.equal(Number(count), 1);

      const deals = await db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quoteLeadId, first.id));
      assert.equal(deals.length, 1);
      assert.equal(deals[0]?.id, first.crmDealId);
    } finally {
      await cleanup(db);
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'mantém attribution first-touch, status convertido e contrato de listagem limitado',
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
    try {
      await migrate(db, { migrationsFolder });
      await cleanup(db);
      const repository = createPostgresQuoteLeadRepository(() => db, {
        now: () => NOW,
        idFactory: randomUUID,
      });

      const lead = await repository.upsert({
        nome: 'Ana',
        telefone: PHONE,
        source: 'typebot',
        produto: 'Canga',
        gclid: 'first-touch',
        utm_source: 'google',
      });
      const updated = await repository.update(lead.id, { status: 'converted' });
      assert.equal(updated?.status, 'converted');

      const merged = await repository.upsert({
        nome: 'Ana Atualizada',
        telefone: '(11) 98765-4321',
        source: 'typebot',
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
      await cleanup(db);
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'usa a chave de identidade como gate de concorrência e não duplica deals',
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
    try {
      await migrate(dbA, { migrationsFolder });
      await cleanup(dbA);
      const repositoryA = createPostgresQuoteLeadRepository(() => dbA, {
        now: () => NOW,
        idFactory: randomUUID,
      });
      const repositoryB = createPostgresQuoteLeadRepository(() => dbB, {
        now: () => NOW,
        idFactory: randomUUID,
      });

      const [first, second] = await Promise.all([
        repositoryA.upsert({ nome: 'Ana A', telefone: PHONE, source: 'typebot' }),
        repositoryB.upsert({ nome: 'Ana B', telefone: '(11) 98765-4321', source: 'typebot' }),
      ]);

      assert.equal(first.id, second.id);
      const leads = await dbA
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.identityKey, 'phone:11987654321'));
      const deals = await dbA
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quoteLeadId, first.id));
      assert.equal(leads.length, 1);
      assert.equal(deals.length, 1);
    } finally {
      await cleanup(dbA);
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
