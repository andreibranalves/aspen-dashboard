import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  ensureFixtureTemplateVersion,
  type FixtureRevisionFields,
} from '../fixtures/quotation-revision-seeds.ts';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresWhatsappCrmRepository,
} from '../../api/_modules/whatsapp-crm-match.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);

test(
  'PostgreSQL CRM matching filters only the latest revision and treats SQL wildcard names literally',
  { concurrency: false, skip: !TEST_DATABASE_URL, timeout: 35_000 },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const clientIds = Array.from({ length: 6 }, () => randomUUID());
    const quotationIds = Array.from({ length: 6 }, () => randomUUID());
    const revisionIds = Array.from({ length: 12 }, () => randomUUID());
    const now = new Date('2026-08-10T12:00:00.000Z');
    const oldDate = new Date('2026-08-09T12:00:00.000Z');
    const businessNumbers = quotationIds.map(
      (_, index) => `ORC-2099${String(index + 1000).slice(-4)}`
    );
    try {
      await migrate(db, { migrationsFolder });
      const fixtureFields: FixtureRevisionFields = await ensureFixtureTemplateVersion(db as any);
      await db.insert(schema.clients).values([
        { id: clientIds[0], nome: 'Cliente antigo' },
        { id: clientIds[1], nome: 'Cliente novo' },
        { id: clientIds[2], nome: 'Cliente percentual' },
        { id: clientIds[3], nome: 'Cliente sublinhado' },
        { id: clientIds[4], nome: 'Cliente barra' },
        { id: clientIds[5], nome: 'Cliente curinga' },
      ]);
      await db.insert(schema.quotations).values(
        quotationIds.map((id, index) => ({
          id,
          businessNumber: businessNumbers[index],
          clientId: clientIds[index],
          status: 'emitido' as const,
          createdAt: oldDate,
          updatedAt: now,
        }))
      );
      await db.insert(schema.quoteRevisions).values([
        {
          ...fixtureFields,
          id: revisionIds[0],
          quotationId: quotationIds[0],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Ana Latest',
          subtotal: '10.00',
          total: '10.00',
          createdAt: oldDate,
        },
        {
          ...fixtureFields,
          id: revisionIds[1],
          quotationId: quotationIds[0],
          version: 2,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Outro nome',
          subtotal: '11.00',
          total: '11.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[2],
          quotationId: quotationIds[1],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Outro antigo',
          subtotal: '12.00',
          total: '12.00',
          createdAt: oldDate,
        },
        {
          ...fixtureFields,
          id: revisionIds[3],
          quotationId: quotationIds[1],
          version: 2,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Ana Latest',
          subtotal: '13.00',
          total: '13.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[4],
          quotationId: quotationIds[2],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Literal% Name',
          subtotal: '14.00',
          total: '14.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[5],
          quotationId: quotationIds[3],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Literal_ Name',
          subtotal: '15.00',
          total: '15.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[6],
          quotationId: quotationIds[4],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Literal\\ Name',
          subtotal: '16.00',
          total: '16.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[7],
          quotationId: quotationIds[5],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'LiteralX Name',
          subtotal: '17.00',
          total: '17.00',
          createdAt: now,
        },
      ]);

      const repository = createPostgresWhatsappCrmRepository(() => db);

      const latestOnly = await repository.findCandidatesByName!('Ana Latest', 2);
      assert.deepEqual(
        latestOnly.map((candidate) => candidate.id),
        [clientIds[1]]
      );

      const percent = await repository.findCandidatesByName!('Literal% Name', 2);
      assert.deepEqual(
        percent.map((candidate) => candidate.id),
        [clientIds[2]]
      );
      const underscore = await repository.findCandidatesByName!('Literal_ Name', 2);
      assert.deepEqual(
        underscore.map((candidate) => candidate.id),
        [clientIds[3]]
      );
      const backslash = await repository.findCandidatesByName!('Literal\\ Name', 2);
      assert.deepEqual(
        backslash.map((candidate) => candidate.id),
        [clientIds[4]]
      );
      const wildcardOnly = await repository.findCandidatesByName!('%', 2);
      assert.deepEqual(wildcardOnly, []);
      const broadPattern = await repository.findCandidatesByName!('Literal% N%', 2);
      assert.deepEqual(broadPattern, []);
    } finally {
      await db.delete(schema.quotations).where(inArray(schema.quotations.id, quotationIds));
      await db.delete(schema.clients).where(inArray(schema.clients.id, clientIds));
      await client.end({ timeout: 5 });
    }
  }
);
test(
  'PostgreSQL CRM matching scopes WhatsApp external IDs, deduplicates relationship candidates, normalizes names, and keeps revisionless deals',
  { concurrency: false, skip: !TEST_DATABASE_URL, timeout: 45_000 },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    // Sorted random IDs make client A's two quotations precede client B in SQL ordering.
    const clientIds = Array.from({ length: 6 }, () => randomUUID()).sort();
    const quotationIds = Array.from({ length: 6 }, () => randomUUID()).sort();
    const revisionIds = Array.from({ length: 5 }, () => randomUUID()).sort();
    const dealIds = Array.from({ length: 4 }, () => randomUUID()).sort();
    const leadIds = Array.from({ length: 5 }, () => randomUUID()).sort();
    const testToken = randomUUID();
    const sourceScopeId = `source-scope-${testToken}`;
    const sourceScopeMissingId = `source-scope-missing-${testToken}`;
    const sourceScopeDuplicateId = `source-scope-duplicate-${testToken}`;
    const now = new Date('2026-08-10T12:00:00.000Z');
    const targetDealsPhone = '5511888777666';
    const targetQuotesPhone = '5511777666555';
    const targetRevisionlessPhone = '5511666777888';
    try {
      await migrate(db, { migrationsFolder });
      const fixtureFields: FixtureRevisionFields = await ensureFixtureTemplateVersion(db as any);
      await db.insert(schema.clients).values([
        { id: clientIds[0], nome: 'Deal Client A' },
        { id: clientIds[1], nome: 'Deal Client B' },
        { id: clientIds[2], nome: 'Revisionless Client' },
        { id: clientIds[3], nome: 'Repeated  Name\tLiteral%' },
        { id: clientIds[4], nome: '\f  Line\v\n\tBreak   Name  \f' },
        { id: clientIds[5], nome: 'Non\u00a0Breaking Name' },
      ]);
      await db.insert(schema.quotations).values([
        {
          id: quotationIds[0],
          businessNumber: 'ORC-20990001',
          clientId: clientIds[0],
          status: 'emitido',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: quotationIds[1],
          businessNumber: 'ORC-20990002',
          clientId: clientIds[0],
          status: 'emitido',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: quotationIds[2],
          businessNumber: 'ORC-20990003',
          clientId: clientIds[2],
          status: 'emitido',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: quotationIds[3],
          businessNumber: 'ORC-20990004',
          clientId: clientIds[3],
          status: 'emitido',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: quotationIds[4],
          businessNumber: 'ORC-20990005',
          clientId: clientIds[3],
          status: 'emitido',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: quotationIds[5],
          businessNumber: 'ORC-20990006',
          clientId: clientIds[1],
          status: 'emitido',
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await db.insert(schema.quoteRevisions).values([
        {
          ...fixtureFields,
          id: revisionIds[0],
          quotationId: quotationIds[0],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Deal Client A',
          clienteEmail: 'a-only@example.com',
          clienteTelefone: targetQuotesPhone,
          subtotal: '10.00',
          total: '10.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[1],
          quotationId: quotationIds[1],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Deal Client A',
          clienteEmail: 'a-only@example.com',
          clienteTelefone: targetQuotesPhone,
          subtotal: '11.00',
          total: '11.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[2],
          quotationId: quotationIds[3],
          version: 1,
          status: 'emitido',
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          validadeDias: 15,
          clienteNome: 'Repeated Name Literal%',
          subtotal: '12.00',
          total: '12.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[3],
          quotationId: quotationIds[4],
          version: 1,
          status: 'emitido',
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          validadeDias: 15,
          clienteNome: 'Repeated Name Literal%',
          subtotal: '13.00',
          total: '13.00',
          createdAt: now,
        },
        {
          ...fixtureFields,
          id: revisionIds[4],
          quotationId: quotationIds[5],
          version: 1,
          status: 'emitido',
          validadeDias: 15,
          companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
          clienteNome: 'Deal Client B',
          clienteEmail: 'b-only@example.com',
          clienteTelefone: targetQuotesPhone,
          subtotal: '14.00',
          total: '14.00',
          createdAt: now,
        },
      ]);
      await db.insert(schema.crmDeals).values([
        {
          id: dealIds[0],
          clientId: clientIds[0],
          quotationId: quotationIds[0],
          nome: 'Deal Client A',
          telefone: targetDealsPhone,
          status: 'Novo Lead',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: dealIds[1],
          clientId: clientIds[0],
          quotationId: quotationIds[1],
          nome: 'Deal Client A',
          telefone: targetDealsPhone,
          status: 'Novo Lead',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: dealIds[2],
          clientId: clientIds[1],
          quotationId: null,
          nome: 'Deal Client B',
          telefone: targetDealsPhone,
          status: 'Novo Lead',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: dealIds[3],
          clientId: clientIds[2],
          quotationId: quotationIds[2],
          nome: 'Revisionless Client',
          telefone: targetRevisionlessPhone,
          status: 'Novo Lead',
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await db.insert(schema.quoteLeads).values([
        {
          id: leadIds[0],
          identityKey: `external:typebot:${sourceScopeId}`,
          externalId: sourceScopeId,
          source: 'typebot',
          nome: 'Typebot Lead',
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: leadIds[1],
          identityKey: `external:whatsapp:${sourceScopeId}`,
          externalId: sourceScopeId,
          source: 'whatsapp',
          nome: 'WhatsApp Lead',
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: leadIds[2],
          identityKey: `external:typebot:${sourceScopeMissingId}`,
          externalId: sourceScopeMissingId,
          nome: 'Missing Source Lead',
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: leadIds[3],
          identityKey: `external:whatsapp:${sourceScopeDuplicateId}:a`,
          externalId: sourceScopeDuplicateId,
          source: 'whatsapp',
          nome: 'Duplicate A',
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: leadIds[4],
          identityKey: `external:whatsapp:${sourceScopeDuplicateId}:b`,
          externalId: sourceScopeDuplicateId,
          source: 'whatsapp',
          nome: 'Duplicate B',
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const repository = createPostgresWhatsappCrmRepository(() => db);
      const sourceMatch = await repository.findQuoteLeadByExternalId!(sourceScopeId, 'whatsapp');
      assert.equal(sourceMatch?.id, leadIds[1]);
      assert.equal((await repository.getQuoteLead(leadIds[1]))?.source, 'whatsapp');

      const missingSource = await repository.findQuoteLeadByExternalId!(sourceScopeMissingId, 'whatsapp');
      assert.notEqual(missingSource?.source, 'whatsapp');
      await assert.rejects(
        () => repository.findQuoteLeadByExternalId!(sourceScopeDuplicateId, 'whatsapp'),
        (error: any) => error.statusCode === 409
      );

      const unique = (candidates: Array<{ id: string }>) => [...new Set(candidates.map((candidate) => candidate.id))];
      assert.ok(unique(await repository.findCandidatesByPhone!(targetDealsPhone, 2)).length > 1);
      assert.deepEqual(unique(await repository.findCandidatesByPhone!(targetRevisionlessPhone, 2)), [clientIds[2]]);
      assert.ok(unique(await repository.findCandidatesByPhone!(targetQuotesPhone, 2)).length > 1);

      const quotationAOnly = await repository.findCandidatesByEmail!(['a-only@example.com'], 2);
      assert.deepEqual(
        quotationAOnly.map((candidate) => candidate.id),
        [clientIds[0]]
      );

      const normalizedName = await repository.findCandidatesByName!('Repeated Name Literal%', 2);
      assert.deepEqual(
        normalizedName.map((candidate) => candidate.id),
        [clientIds[3]]
      );
      const asciiWhitespaceName = await repository.findCandidatesByName!('Line Break Name', 2);
      assert.deepEqual(
        asciiWhitespaceName.map((candidate) => candidate.id),
        [clientIds[4]]
      );
      const nbspName = await repository.findCandidatesByName!('Non\u00a0Breaking Name', 2);
      assert.deepEqual(
        nbspName.map((candidate) => candidate.id),
        [clientIds[5]]
      );
      const nbspAsSpaceName = await repository.findCandidatesByName!('Non Breaking Name', 2);
      assert.deepEqual(nbspAsSpaceName, []);
    } finally {
      await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.id, dealIds));
      await db
        .update(schema.quoteLeads)
        .set({ crmDealId: null })
        .where(inArray(schema.quoteLeads.id, leadIds));
      await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, leadIds));
      await db.delete(schema.quoteRevisions).where(inArray(schema.quoteRevisions.id, revisionIds));
      await db.delete(schema.quotations).where(inArray(schema.quotations.id, quotationIds));
      await db.delete(schema.clients).where(inArray(schema.clients.id, clientIds));
      await client.end({ timeout: 5 });
    }
  }
);
