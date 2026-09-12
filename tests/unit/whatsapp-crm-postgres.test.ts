import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  ensureFixtureTemplateVersion,
  type FixtureRevisionFields,
} from '../fixtures/quotation-revision-seeds.ts';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import { createPostgresQuoteLeadRepository } from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';
import { createPostgresOpportunityActionRepository } from '../../api/_infrastructure/db/repositories/opportunity-actions-repository.js';
import { createHandler as createWhatsappHandler } from '../../api/_modules/whatsapp-conversations.js';
import {
  createPostgresWhatsappCrmRepository,
  resolveWhatsappCrmMatch,
} from '../../api/_modules/whatsapp-crm-match.js';
import type { WhatsappConversation } from '../../api/_modules/whatsapp-conversations-store.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);

function conversation(overrides: Partial<WhatsappConversation> = {}): WhatsappConversation {
  return {
    id: 'crm-postgres-test-conversation',
    providerConversationId: '5511999999999@s.whatsapp.net',
    remoteJid: '5511999999999@s.whatsapp.net',
    canonicalPhone: '5511000000000',
    phone: '5511000000000',
    displayLabel: 'Ana Latest',
    displayName: 'Ana Latest',
    identityStatus: 'verified',
    identitySource: 'chat.phone',
    identityConfidence: 'high',
    lastMessageAt: '2026-08-10T12:00:00.000Z',
    lastMessagePreview: 'Oi',
    source: 'evolution',
    status: 'new',
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    ...overrides,
  };
}

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
      const deps = {
        now: () => now.toISOString(),
        id: () => 'crm-postgres-test-id',
        readConversations: async () => [],
        writeConversations: async () => {},
        readMessages: async () => [],
        writeMessages: async () => {},
        localCrm: repository,
      };

      const latestOnly = await resolveWhatsappCrmMatch({
        conversation: conversation(),
        deps,
      });
      assert.equal(latestOnly?.id, clientIds[1]);
      assert.equal(latestOnly?.matchSource, 'name');

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
      const deps = {
        now: () => now.toISOString(),
        id: () => 'crm-postgres-test-id',
        readConversations: async () => [],
        writeConversations: async () => {},
        readMessages: async () => [],
        writeMessages: async () => {},
        localCrm: repository,
      };
      const sourceMatch = await resolveWhatsappCrmMatch({
        conversation: conversation({
          id: sourceScopeId,
          canonicalPhone: '',
          phone: '',
          displayLabel: 'Sem match',
          displayName: 'Sem match',
        }),
        deps,
      });
      assert.equal(sourceMatch?.id, leadIds[1]);
      assert.equal((await repository.getQuoteLead(leadIds[1]))?.source, 'whatsapp');

      const missingSource = await resolveWhatsappCrmMatch({
        conversation: conversation({
          id: sourceScopeMissingId,
          canonicalPhone: '',
          phone: '',
          displayLabel: 'Sem match',
          displayName: 'Sem match',
        }),
        deps,
      });
      assert.equal(missingSource, null);
      await assert.rejects(
        () =>
          resolveWhatsappCrmMatch({
            conversation: conversation({
              id: sourceScopeDuplicateId,
              canonicalPhone: '',
              phone: '',
              displayLabel: 'Sem match',
              displayName: 'Sem match',
            }),
            deps,
          }),
        (error: any) => error.statusCode === 409
      );

      const ambiguousDeals = await resolveWhatsappCrmMatch({
        conversation: conversation({
          id: 'candidate-deals',
          canonicalPhone: targetDealsPhone,
          phone: targetDealsPhone,
          displayLabel: 'Sem match',
          displayName: 'Sem match',
        }),
        deps,
      });
      assert.equal(ambiguousDeals, null);

      const revisionless = await resolveWhatsappCrmMatch({
        conversation: conversation({
          id: 'candidate-revisionless',
          canonicalPhone: targetRevisionlessPhone,
          phone: targetRevisionlessPhone,
          displayLabel: 'Sem match',
          displayName: 'Sem match',
        }),
        deps,
      });
      assert.equal(revisionless?.id, clientIds[2]);
      const savedRevisionless = await resolveWhatsappCrmMatch({
        conversation: conversation({
          id: 'saved-revisionless',
          canonicalPhone: '',
          phone: '',
          identityStatus: 'unresolved',
          displayLabel: 'Sem match',
          displayName: 'Sem match',
          linkedDealId: dealIds[3],
          linkedQuotationId: quotationIds[2],
        }),
        deps,
      });
      assert.equal(savedRevisionless?.id, clientIds[2]);

      const quotationAmbiguous = await resolveWhatsappCrmMatch({
        conversation: conversation({
          id: 'candidate-quotation-ambiguous',
          canonicalPhone: targetQuotesPhone,
          phone: targetQuotesPhone,
          displayLabel: 'Sem match',
          displayName: 'Sem match',
        }),
        deps,
      });
      assert.equal(quotationAmbiguous, null);

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

test(
  'PostgreSQL mixed WhatsApp retry: an explicit second demand does not divert the legacy no-demand retry',
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
    await migrate(db, { migrationsFolder });
    const conversationId = `mixed-retry-${randomUUID()}`;
    const now = new Date('2026-09-11T12:00:00.000Z');
    const messages = [
      {
        id: 'mixed-retry-message',
        conversationId,
        providerMessageId: 'mixed-retry-message',
        direction: 'inbound' as const,
        type: 'text' as const,
        body: 'Preciso de 10 unidades',
        mediaUrl: '',
        timestamp: now.toISOString(),
      },
    ];
    let conversations: WhatsappConversation[] = [
      conversation({
        id: conversationId,
        providerConversationId: `${conversationId}@s.whatsapp.net`,
        remoteJid: `${conversationId}@s.whatsapp.net`,
        canonicalPhone: '5511997000111',
        phone: '5511997000111',
        displayLabel: 'Mixed Client',
        displayName: 'Mixed Client',
      }),
    ];
    const repository = createPostgresQuoteLeadRepository(() => db, {
      now: () => now,
      idFactory: randomUUID,
    });
    // The narrow admission finders are backed directly by the quote lead
    // repository: the exact ingestion key with a null demand, and the exact
    // admitted demand id. No generic conversation-wide lookup.
    const handler = createWhatsappHandler({
      now: () => now.toISOString(),
      id: randomUUID,
      readConversations: async () => conversations,
      writeConversations: async (next) => {
        conversations = next;
      },
      readMessages: async () => messages,
      writeMessages: async () => {},
      localCrm: createPostgresWhatsappCrmRepository(() => db),
      upsertQuoteLead: repository.upsert,
      findQuoteLeadByExternalIdWithoutDemand: (externalId, source) =>
        repository.findByExternalIdWithoutDemand(externalId, source),
      findQuoteLeadByDemandId: (demandId, source) => repository.findByDemandId(demandId, source),
    });
    const call = (demandId?: string) =>
      handler({
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'create-quote-lead',
          id: conversationId,
          ...(demandId ? { demandId } : {}),
        }),
        queryStringParameters: {},
        headers: {},
      });

    try {
      // 1) Legacy no-demand admission creates the original ingestion identity.
      const initial = await call();
      assert.equal(initial.statusCode, 201, await initial.body);
      const initialLead = JSON.parse(initial.body || '{}').data;

      // 2) A second, explicit demand is admitted in the SAME conversation and
      // shares the transport externalId.
      const second = await call('demand-second');
      assert.equal(second.statusCode, 201, await second.body);
      const secondLead = JSON.parse(second.body || '{}').data;
      assert.notEqual(secondLead.id, initialLead.id, 'a second demand is a separate admission');

      // 3) Retrying the ORIGINAL no-demand admission resolves its own identity
      // (null demand), not the later explicit demand — no 409, no duplicate.
      const retry = await call();
      assert.equal(retry.statusCode, 200, await retry.body);
      const retryLead = JSON.parse(retry.body || '{}').data;
      assert.equal(retryLead.id, initialLead.id, 'the retry returns the original admission');

      // The retry of the OLD admission must not revert the conversation links
      // saved by the newer explicit demand, and the CRM resolver must keep
      // choosing the newer selection.
      assert.equal(
        conversations[0]?.linkedLeadId,
        secondLead.id,
        'the retry keeps the newer saved selection'
      );

      const matched = await resolveWhatsappCrmMatch({
        conversation: conversations[0]!,
        deps: {
          now: () => now.toISOString(),
          id: () => randomUUID(),
          readConversations: async () => conversations,
          writeConversations: async () => {},
          readMessages: async () => messages,
          writeMessages: async () => {},
          localCrm: createPostgresWhatsappCrmRepository(() => db),
        },
      });
      assert.equal(matched?.id, secondLead.id, 'the resolver keeps choosing the newer demand');

      const rows = await db
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, conversationId));
      assert.equal(rows.length, 2, 'exactly two admissions: the original and the explicit demand');
      const original = rows.find((row) => row.id === initialLead.id);
      const explicit = rows.find((row) => row.id === secondLead.id);
      assert.equal(original?.demandId, null);
      assert.equal(explicit?.demandId, 'demand-second');

      const [opportunity] = await db
        .select({ demandSummary: schema.crmDeals.demandSummary })
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quoteLeadId, initialLead.id));
      assert.equal(opportunity?.demandSummary, 'Cliente: Preciso de 10 unidades');

      const [secondOpportunity] = await db
        .select({ id: schema.crmDeals.id })
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quoteLeadId, secondLead.id));
      const [initialOpportunity] = await db
        .select({ id: schema.crmDeals.id })
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quoteLeadId, initialLead.id));
      assert.ok(initialOpportunity);
      assert.ok(secondOpportunity);
      assert.notEqual(secondOpportunity.id, initialOpportunity.id);
      assert.equal(
        conversations[0]?.linkedDealId,
        secondOpportunity.id,
        'the retry keeps the newer saved opportunity'
      );

      const page = await createPostgresOpportunityActionRepository(() => db);
      const rowsForDemands = (await page.listActive({ pageSize: 100 })).data.filter(
        (row) =>
          row.opportunityId === initialOpportunity.id || row.opportunityId === secondOpportunity.id
      );
      assert.equal(rowsForDemands.length, 2, 'both demands stay visible in the queue');
      assert.equal(
        new Set(rowsForDemands.map((row) => row.opportunityId)).size,
        2,
        'each demand keeps its own opportunity'
      );
      assert.equal(
        new Set(rowsForDemands.map((row) => row.actionId)).size,
        2,
        'each demand keeps its own action'
      );
    } finally {
      const leads = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, conversationId));
      const leadIds = leads.map((row) => row.id);
      if (leadIds.length > 0) {
        await db
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, leadIds));
        const deals = await db
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, leadIds));
        if (deals.length) {
          await db.delete(schema.opportunityNextActions).where(
            inArray(
              schema.opportunityNextActions.opportunityId,
              deals.map((row) => row.id)
            )
          );
        }
        await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, leadIds));
        await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, leadIds));
      }
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'PostgreSQL concurrent new admissions: a stale admission cannot overwrite the newer selection',
  { concurrency: false, skip: !TEST_DATABASE_URL, timeout: 45_000 },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 2,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    const conversationId = `concurrent-admissions-${randomUUID()}`;
    const now = new Date('2026-09-11T12:00:00.000Z');
    const messages = [
      {
        id: 'concurrent-admissions-message',
        conversationId,
        providerMessageId: 'concurrent-admissions-message',
        direction: 'inbound' as const,
        type: 'text' as const,
        body: 'Quero uma nova demanda',
        mediaUrl: '',
        timestamp: now.toISOString(),
      },
    ];
    let conversations: WhatsappConversation[] = [
      conversation({
        id: conversationId,
        providerConversationId: `${conversationId}@s.whatsapp.net`,
        remoteJid: `${conversationId}@s.whatsapp.net`,
        canonicalPhone: '5511997000222',
        phone: '5511997000222',
        displayLabel: 'Concurrent Client',
        displayName: 'Concurrent Client',
      }),
    ];
    let revision = 0;
    const repository = createPostgresQuoteLeadRepository(() => db, {
      now: () => now,
      idFactory: randomUUID,
    });

    let releaseAlpha!: () => void;
    const alphaGate = new Promise<void>((resolve) => {
      releaseAlpha = resolve;
    });
    let alphaReachedUpsert!: () => void;
    const alphaReached = new Promise<void>((resolve) => {
      alphaReachedUpsert = resolve;
    });

    const handler = createWhatsappHandler({
      now: () => now.toISOString(),
      id: randomUUID,
      readConversations: async () => conversations,
      writeConversations: async () => {
        throw new Error('direct write must not run when the CAS seam is supplied');
      },
      readMessages: async () => messages,
      writeMessages: async () => {},
      // Real single-key CAS semantics: the mutation always sees the latest
      // snapshot and only lands when no other mutation landed in between.
      atomicUpdateConversations: async (mutation) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const seenRevision = revision;
          const changed = await mutation(conversations);
          if (revision !== seenRevision) continue;
          conversations = changed.conversations;
          revision += 1;
          return changed.result;
        }
        throw new Error('CAS contention');
      },
      localCrm: createPostgresWhatsappCrmRepository(() => db),
      upsertQuoteLead: async (input) => {
        const demandId = String(input.demandId);
        if (demandId === 'demand-A') {
          alphaReachedUpsert();
          await alphaGate;
        }
        return repository.upsert(input);
      },
      findQuoteLeadByExternalIdWithoutDemand: (externalId, source) =>
        repository.findByExternalIdWithoutDemand(externalId, source),
      findQuoteLeadByDemandId: (demandId, source) => repository.findByDemandId(demandId, source),
    });
    const call = (demandId: string) =>
      handler({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'create-quote-lead', id: conversationId, demandId }),
        queryStringParameters: {},
        headers: {},
      });

    try {
      const alpha = call('demand-A');
      await alphaReached;
      const beta = await call('demand-B');
      releaseAlpha();
      const alphaResult = await alpha;
      assert.equal(alphaResult.statusCode, 201, await alphaResult.body);
      assert.equal(beta.statusCode, 201, await beta.body);
      const betaLead = JSON.parse(beta.body || '{}').data;

      assert.equal(
        conversations[0]?.linkedLeadId,
        betaLead.id,
        'the stale admission must not overwrite the newer saved selection'
      );
      const leads = await db
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, conversationId));
      assert.equal(leads.length, 2, 'both concurrent admissions remain durable');
      assert.notEqual(leads[0].id, leads[1].id);
    } finally {
      const leads = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, conversationId));
      const leadIds = leads.map((row) => row.id);
      if (leadIds.length > 0) {
        await db
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, leadIds));
        const deals = await db
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, leadIds));
        if (deals.length) {
          await db
            .delete(schema.opportunityNextActions)
            .where(
              inArray(
                schema.opportunityNextActions.opportunityId,
                deals.map((row) => row.id)
              )
            );
        }
        await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, leadIds));
        await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, leadIds));
      }
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'PostgreSQL rejects a demand id bound to a different conversation without changing the original',
  { concurrency: false, skip: !TEST_DATABASE_URL, timeout: 45_000 },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 3,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    const now = new Date('2026-09-11T12:00:00.000Z');
    const repository = createPostgresQuoteLeadRepository(() => db, {
      now: () => now,
      idFactory: randomUUID,
    });
    const ids = Array.from({ length: 3 }, () => randomUUID());
    const demandId = `conflict-${ids[0]}`;
    const conversationA = `conv-a-${ids[1]}`;
    const conversationB = `conv-b-${ids[2]}`;
    const input = (externalId: string, telefone: string) => ({
      nome: 'Cliente Conflito',
      telefone,
      pedidoTexto: 'Pedido conflitante',
      source: 'whatsapp',
      externalId,
      demandId,
    });
    const cleanup = async () => {
      const conversations = [conversationA, conversationB, `${conversationA}-race`, `${conversationB}-race`];
      const leads = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(inArray(schema.quoteLeads.externalId, conversations));
      const leadIds = leads.map((row) => row.id);
      if (leadIds.length > 0) {
        await db
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, leadIds));
        const deals = await db
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, leadIds));
        if (deals.length) {
          await db.delete(schema.opportunityNextActions).where(
            inArray(
              schema.opportunityNextActions.opportunityId,
              deals.map((row) => row.id)
            )
          );
        }
        await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, leadIds));
        await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, leadIds));
      }
    };

    try {
      const first = await repository.upsert(input(conversationA, '5511911111111'));
      assert.equal(first.externalId, conversationA);
      await assert.rejects(
        () => repository.upsert(input(conversationB, '5521922222222')),
        (error: unknown) => Number((error as { statusCode?: unknown })?.statusCode) === 409,
        'a different conversation reusing the demand must be rejected'
      );

      const rows = await db
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.demandId, demandId));
      assert.equal(rows.length, 1, 'the conflicting request must not create a second admission');
      assert.equal(rows[0]?.externalId, conversationA);
      assert.equal(rows[0]?.telefone, '5511911111111', 'the original contact must be preserved');
      const originalDeals = await db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quoteLeadId, first.id));
      assert.equal(originalDeals.length, 1, 'the original opportunity must be preserved');
      const originalActions = await db
        .select()
        .from(schema.opportunityNextActions)
        .where(eq(schema.opportunityNextActions.opportunityId, originalDeals[0]!.id));
      assert.equal(originalActions.length, 1, 'the original action must be preserved');

      // Concurrency: both conversations submit the same demand at once. The
      // unique identity key serializes them; exactly one wins and the other is
      // a conflict that leaves the winner's admission untouched.
      const raceA = `${conversationA}-race`;
      const raceB = `${conversationB}-race`;
      const raceDemand = `race-${ids[0]}`;
      const raceInput = (externalId: string, telefone: string) => ({
        nome: 'Cliente Corrida',
        telefone,
        pedidoTexto: 'Pedido em corrida',
        source: 'whatsapp',
        externalId,
        demandId: raceDemand,
      });
      const settled = await Promise.allSettled([
        repository.upsert(raceInput(raceA, '5511933333333')),
        repository.upsert(raceInput(raceB, '5521944444444')),
      ]);
      const fulfilled = settled.filter((entry) => entry.status === 'fulfilled');
      const rejected = settled.filter(
        (entry): entry is PromiseRejectedResult => entry.status === 'rejected'
      );
      assert.equal(fulfilled.length, 1, 'exactly one concurrent admission may win');
      assert.equal(rejected.length, 1);
      assert.equal(
        Number((rejected[0]!.reason as { statusCode?: unknown })?.statusCode),
        409,
        'the concurrent loser must be a conflict, not a merge'
      );
      const raceRows = await db
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.demandId, raceDemand));
      assert.equal(raceRows.length, 1);
      const winnerExternalId = raceRows[0]?.externalId;
      assert.ok(winnerExternalId === raceA || winnerExternalId === raceB);
      assert.equal(
        raceRows[0]?.telefone,
        winnerExternalId === raceA ? '5511933333333' : '5521944444444',
        'the winner contact is preserved'
      );
    } finally {
      await cleanup();
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'PostgreSQL WhatsApp pre-quote retry links one persisted lead and deal after a transient KV failure',
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
    // This test is standalone: migrate its disposable schema before creating repository state.
    await migrate(db, { migrationsFolder });
    const fixtureFields: FixtureRevisionFields = await ensureFixtureTemplateVersion(db as any);
    const conversationId = `retry-postgres-${randomUUID()}`;
    const now = new Date('2026-08-10T12:00:00.000Z');
    let conversations: WhatsappConversation[] = [
      conversation({
        id: conversationId,
        providerConversationId: `${conversationId}@s.whatsapp.net`,
        remoteJid: `${conversationId}@s.whatsapp.net`,
        canonicalPhone: '5511999888777',
        phone: '5511999888777',
        displayLabel: 'Retry Client',
        displayName: 'Retry Client',
      }),
    ];
    let conversationWrites = 0;
    let failedLinkWrite = false;
    const repository = createPostgresQuoteLeadRepository(() => db, {
      now: () => now,
      idFactory: randomUUID,
    });
    const handler = createWhatsappHandler({
      now: () => now.toISOString(),
      id: randomUUID,
      readConversations: async () => conversations,
      writeConversations: async (next) => {
        conversationWrites += 1;
        // Fail exactly the write that would link the freshly persisted lead, so
        // the retry proves KV-link recovery. The new-admission reservation that
        // precedes the upsert must not consume this transient failure.
        if (!failedLinkWrite && next.some((item) => item.linkedLeadId)) {
          failedLinkWrite = true;
          throw new Error('transient KV failure');
        }
        conversations = next;
      },
      readMessages: async () => [
        {
          id: 'retry-message',
          conversationId,
          providerMessageId: 'retry-message',
          direction: 'inbound',
          type: 'text',
          body: 'Preciso de 10 unidades',
          mediaUrl: '',
          timestamp: now.toISOString(),
        },
      ],
      writeMessages: async () => {},
      localCrm: createPostgresWhatsappCrmRepository(() => db),
      upsertQuoteLead: repository.upsert,
      findQuoteLeadByExternalIdWithoutDemand: (externalId, source) =>
        repository.findByExternalIdWithoutDemand(externalId, source),
      findQuoteLeadByDemandId: (demandId, source) => repository.findByDemandId(demandId, source),
    });
    try {
      const first = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'create-quote-lead', id: conversationId }),
        queryStringParameters: {},
        headers: {},
      });
      assert.equal(first.statusCode, 503);

      const retry = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'create-quote-lead', id: conversationId }),
        queryStringParameters: {},
        headers: {},
      });
      assert.equal(retry.statusCode, 200);
      assert.equal(conversationWrites, 3);
      assert.equal(
        conversations[0]?.linkedLeadId && UUID_PATTERN.test(conversations[0].linkedLeadId),
        true
      );
      assert.equal(
        conversations[0]?.linkedDealId && UUID_PATTERN.test(conversations[0].linkedDealId),
        true
      );

      const leads = await db
        .select()
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, conversationId));
      assert.equal(leads.length, 1);
      assert.equal(leads[0]?.source, 'whatsapp');
      const deals = await db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quoteLeadId, leads[0]!.id));
      assert.equal(deals.length, 1);
    } finally {
      const leads = await db
        .select({ id: schema.quoteLeads.id })
        .from(schema.quoteLeads)
        .where(eq(schema.quoteLeads.externalId, conversationId));
      const leadIds = leads.map((row) => row.id);
      if (leadIds.length > 0) {
        await db
          .update(schema.quoteLeads)
          .set({ crmDealId: null })
          .where(inArray(schema.quoteLeads.id, leadIds));
        // The pre-quote retry upserts a lead, which seeds a durable
        // first-contact action; clear it before removing the opportunity.
        const deals = await db
          .select({ id: schema.crmDeals.id })
          .from(schema.crmDeals)
          .where(inArray(schema.crmDeals.quoteLeadId, leadIds));
        if (deals.length) {
          await db.delete(schema.opportunityNextActions).where(
            inArray(
              schema.opportunityNextActions.opportunityId,
              deals.map((row) => row.id)
            )
          );
        }
        await db.delete(schema.crmDeals).where(inArray(schema.crmDeals.quoteLeadId, leadIds));
        await db.delete(schema.quoteLeads).where(inArray(schema.quoteLeads.id, leadIds));
      }
      await client.end({ timeout: 5 });
    }
  }
);
