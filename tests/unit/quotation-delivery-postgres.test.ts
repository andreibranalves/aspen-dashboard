import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  clients,
  products,
  quotations,
  quoteRevisionItems,
  quoteRevisions,
  quotationDeliveries,
  quotationTemplateVersions,
  quotationTemplates,
} from '../../api/_infrastructure/db/schema.js';
import {
  canRecordQuotationDeliveryState,
  createPostgresQuotationDeliveryRepository,
  QuotationDeliveryConflictError,
  QuotationDeliveryPdfError,
  QuotationDeliveryRepositoryError,
} from '../../api/_infrastructure/db/repositories/quotation-delivery-repository.js';
import type { QuotationSectionsSnapshot } from '../../api/_modules/quotation-content.js';

const DATABASE_URL = process.env.TEST_QUOTE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

function pdfWithEof(): Buffer {
  return Buffer.from('%PDF-1.7\ncontent\n%%EOF');
}

const SECTION_TEMPLATE = '<!doctype html><html><body>{{quote_number}} {{client.name}} Telefone: {{client.phone}} Data: {{display.quote_date}} Validade: {{display.validity_date}} {{#each items}}{{name}} Quantidade: {{quantity}}{{/each}} {{display.total}} {{secoes.pagamento.body_html}} {{secoes.condicoes_gerais.body_html}} {{secoes.prazo_producao.value}}</body></html>';
const SECTION_TEMPLATE_HASH = createHash('sha256').update(SECTION_TEMPLATE).digest('hex');

function fakePreparationDatabase(options: { failRevisionRead?: boolean; items?: unknown[]; total?: string } = {}) {
  const now = new Date('2026-08-13T12:00:00.000Z');
  const revisionId = '00000000-0000-4000-8000-000000000001';
  const quotationId = '00000000-0000-4000-8000-000000000002';
  const templateVersionId = '00000000-0000-4000-8000-000000000003';
  const revisionTotal = options.total ?? '10.00';
  const revision = {
    id: revisionId, quotationId, version: 1, status: 'emitido', issuedAt: now, createdAt: now,
    validadeDias: 15, pagamento: 'Pix', entrega: '', fretePadrao: '0.00', frete: '0.00',
    observacoes: '', prazoProducao: '', templatePadrao: 'test', templateHash: SECTION_TEMPLATE_HASH,
    templateVersionId, sectionsSnapshot: null, clienteNome: 'ANDREI ALVES', clienteTelefone: '21999999999',
    clienteEmail: null, clienteDocumento: null, clienteEndereco: null, clienteNumero: null,
    clienteBairro: null, clienteComplemento: null, clienteMunicipio: null, clienteUf: null,
    clienteCep: null, clienteNotas: null, subtotal: revisionTotal, total: revisionTotal,
  } as any;
  const delivery = {
    id: '00000000-0000-4000-8000-000000000004', revisionId, phone: '5511999990000', flowId: 'flow',
    state: 'pending', providerAcceptanceId: null, publicError: null,
    diagnosticsExpiresAt: new Date('2026-11-11T12:00:00.000Z'), resumableUntil: new Date('2026-09-12T12:00:00.000Z'),
    createdAt: now, updatedAt: now,
  };
  let revisionReads = 0;
  class Query {
    private rows: unknown[];
    private failure?: Error;
    constructor(rows: unknown[], failure?: Error) { this.rows = rows; this.failure = failure; }
    where() { return this; }
    limit() { return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.rows); }
    then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
      return (this.failure ? Promise.reject(this.failure) : Promise.resolve(this.rows)).then(resolve, reject);
    }
  }
  const db: any = {
    transaction: async (callback: (tx: unknown) => unknown) => callback(db),
    select: () => ({
      from: (table: unknown) => {
        if (table === quoteRevisions) {
          revisionReads += 1;
          return new Query([revision], options.failRevisionRead && revisionReads > 1 ? new Error('database read failed') : undefined);
        }
        if (table === quotationTemplateVersions) return new Query([{ id: templateVersionId, source: SECTION_TEMPLATE, sourceHash: SECTION_TEMPLATE_HASH }]);
        if (table === quoteRevisionItems) return new Query(options.items || []);
        if (table === quotations) return new Query([{ businessNumber: 'ORC-20260001' }]);
        return new Query([]);
      },
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [delivery] }) }) }),
  };
  return { db, now, revisionId };
}

test('durable terminal and active delivery states cannot regress to transport', () => {
  assert.equal(canRecordQuotationDeliveryState('completed', 'pending'), false);
  assert.equal(canRecordQuotationDeliveryState('completed', 'transporting'), false);
  assert.equal(canRecordQuotationDeliveryState('reconciling', 'pending'), false);
  assert.equal(canRecordQuotationDeliveryState('reconciling', 'transporting'), false);
  assert.equal(canRecordQuotationDeliveryState('accepted_partial', 'retryable'), false);
  assert.equal(canRecordQuotationDeliveryState('retryable', 'transporting'), true);
  assert.equal(canRecordQuotationDeliveryState('reconciling', 'completed'), true);
});

test('repository does not classify database reads as PDF failures', async () => {
  const { db, now, revisionId } = fakePreparationDatabase({ failRevisionRead: true });
  const repository = createPostgresQuotationDeliveryRepository(() => db, { now: () => now });
  await assert.rejects(
    repository.prepareDelivery({ revisionId, phone: '5511999990000', flowId: 'flow' }),
    (error: unknown) => error instanceof QuotationDeliveryRepositoryError && !(error instanceof QuotationDeliveryPdfError),
  );
});

test('delivery PDF formats issue and validity dates for display', async () => {
  const { db, now, revisionId } = fakePreparationDatabase();
  let renderedHtml = '';
  const repository = createPostgresQuotationDeliveryRepository(() => db, {
    now: () => now,
    renderPdf: async (html) => {
      renderedHtml = html;
      return pdfWithEof();
    },
  });

  await repository.prepareDelivery({ revisionId, phone: '5511999990000', flowId: 'flow' });

  assert.match(renderedHtml, /Andrei Alves/);
  assert.match(renderedHtml, /Telefone: \(21\) 99999-9999/);
  assert.match(renderedHtml, /Data: 13\/08\/2026/);
  assert.match(renderedHtml, /Validade: 28\/08\/2026/);
});

test('delivery PDF removes storage scale from integer quantities', async () => {
  const { db, now, revisionId } = fakePreparationDatabase({
    items: [{
      id: '00000000-0000-4000-8000-000000000005',
      position: 0,
      produtoSku: 'SKU-70',
      produtoNome: 'Produto setenta',
      produtoDescricao: '',
      produtoUnidade: 'Und',
      quantidade: '70.000',
      precoAplicado: '10.00',
      totalLinha: '700.00',
    }],
  });
  let renderedHtml = '';
  const repository = createPostgresQuotationDeliveryRepository(() => db, {
    now: () => now,
    renderPdf: async (html) => {
      renderedHtml = html;
      return pdfWithEof();
    },
  });

  await repository.prepareDelivery({ revisionId, phone: '5511999990000', flowId: 'flow' });

  assert.match(renderedHtml, /Quantidade: 70(?:<|\s)/);
  assert.doesNotMatch(renderedHtml, /Quantidade: 70\.000/);
});

test('delivery PDF formats monetary totals with thousands separator', async () => {
  const { db, now, revisionId } = fakePreparationDatabase({ total: '2500.00' });
  let renderedHtml = '';
  const repository = createPostgresQuotationDeliveryRepository(() => db, {
    now: () => now,
    renderPdf: async (html) => {
      renderedHtml = html;
      return pdfWithEof();
    },
  });

  await repository.prepareDelivery({ revisionId, phone: '5511999990000', flowId: 'flow' });

  assert.match(renderedHtml, /R\$ 2\.500,00/);
  assert.doesNotMatch(renderedHtml, /R\$ 2500,00/);
});

test('repository classifies renderer failures and invalid bytes as PDF failures', async () => {
  const { db, now, revisionId } = fakePreparationDatabase();
  for (const renderPdf of [
    async () => { throw new Error('renderer failed'); },
    async () => Buffer.from('not a pdf'),
  ]) {
    const repository = createPostgresQuotationDeliveryRepository(() => db, { now: () => now, renderPdf });
    await assert.rejects(
      repository.prepareDelivery({ revisionId, phone: '5511999990000', flowId: 'flow' }),
      (error: unknown) => error instanceof QuotationDeliveryPdfError,
    );
  }
});

test(
  'quotation delivery freezes revision operation, retains safe summary and renders immutable snapshot',
  { skip: !DATABASE_URL },
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false, connect_timeout: 10, onnotice: () => undefined });
    const db = drizzle(sql, { schema });
    const now = new Date('2026-08-13T12:00:00.000Z');
    const ids = {
      client: randomUUID(),
      quotation: randomUUID(),
      revision: randomUUID(),
      template: randomUUID(),
      templateVersion: randomUUID(),
      item: randomUUID(),
      product: `DELIVERY-${Date.now()}`,
    };
    const templateKey = `delivery-${Date.now()}`;
    try {
      await migrate(db, { migrationsFolder });
      await db.insert(clients).values({ id: ids.client, nome: 'Cliente entrega' });
      await db.insert(quotations).values({
        id: ids.quotation,
        businessNumber: `ORC-${now.getUTCFullYear()}9999`,
        clientId: ids.client,
        status: 'emitido',
        issuedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(quotationTemplates).values({
        id: ids.template,
        key: templateKey,
        name: 'Delivery test',
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(quotationTemplateVersions).values({
        id: ids.templateVersion,
        templateId: ids.template,
        version: 1,
        source: SECTION_TEMPLATE,
        sourceHash: SECTION_TEMPLATE_HASH,
        createdAt: now,
      });
      await db.insert(products).values({
        sku: ids.product,
        nome: 'Produto snapshot',
        descricao: 'Original',
        unidade: 'Und',
        precoBase: '10.00',
        ativo: true,
      });
      await db.insert(quoteRevisions).values({
        id: ids.revision,
        quotationId: ids.quotation,
        version: 1,
        status: 'emitido',
        issuedAt: now,
        validadeDias: 15,
        pagamento: 'À vista',
        entrega: '10 dias',
        templateVersionId: ids.templateVersion,
        fretePadrao: '0.00',
        frete: '0.00',
        observacoes: 'Resumo',
        prazoProducao: '',
        templatePadrao: templateKey,
        templateHash: SECTION_TEMPLATE_HASH,
        sectionsSnapshot: ({
          schema_version: 1,
          prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo', value: 'FROZEN-PRAZO' } },
          pagamento: { base: { enabled: true, title: 'Pagamento', body: 'old' }, current: { enabled: true, title: 'Pagamento', body: 'FROZEN-PAGAMENTO' } },
          condicoes_gerais: { base: { enabled: true, title: 'Condições', body: 'old' }, current: { enabled: true, title: 'Condições', body: 'FROZEN-CONDICOES' } },
        } as unknown) as QuotationSectionsSnapshot,
        clienteNome: 'Cliente entrega',
        clienteTelefone: '5521995419741',
        subtotal: '10.00',
        total: '10.00',
        createdAt: now,
      });
      await db.insert(quoteRevisionItems).values({
        id: ids.item,
        revisionId: ids.revision,
        position: 0,
        productSku: ids.product,
        quantidade: '1.000',
        produtoSku: ids.product,
        produtoNome: 'Produto snapshot',
        produtoDescricao: 'Original',
        produtoUnidade: 'Und',
        precoFonte: 'base',
        precoSugerido: '10.00',
        precoAplicado: '10.00',
        diferencaPreco: '0.00',
        totalLinha: '10.00',
        manualRate: true,
      });

      const repository = createPostgresQuotationDeliveryRepository(() => db, {
        now: () => now,
        renderPdf: async (html) => {
          assert.match(html, /Cliente entrega/);
          assert.match(html, /Produto snapshot/);
          assert.match(html, /FROZEN-PAGAMENTO/);
          assert.match(html, /FROZEN-CONDICOES/);
          assert.match(html, /FROZEN-PRAZO/);
          return pdfWithEof();
        },
      });
      const first = await repository.reserve({ revisionId: ids.revision, phone: '(21) 99541-9741', flowId: 'already-talking' });
      assert.equal(first.phone, '5521995419741');
      assert.equal(first.flowId, 'already-talking');
      const retry = await repository.reserve({ revisionId: ids.revision, phone: '55 21 99541 9741', flowId: 'already-talking' });
      assert.equal(retry.id, first.id);
      await assert.rejects(
        repository.reserve({ revisionId: ids.revision, phone: '5511999999999', flowId: 'email-first-contact' }),
        (error: unknown) => error instanceof QuotationDeliveryConflictError && /nova revisão/i.test(error.message),
      );

      const prepared = await repository.prepareDelivery({ revisionId: ids.revision, phone: first.phone, flowId: first.flowId });
      assert.equal(prepared.pdfSize, pdfWithEof().length);
      assert.match(prepared.pdfSignature, /^[0-9a-f]{64}$/);
      assert.equal(prepared.delivery.id, first.id);

      await assert.rejects(repository.prepareDelivery({ revisionId: ids.revision, phone: first.phone, flowId: first.flowId, maxPdfBytes: Number.NaN }), /Limite de PDF inválido/i);
      await assert.rejects(repository.prepareDelivery({ revisionId: ids.revision, phone: first.phone, flowId: first.flowId, maxPdfBytes: Number.POSITIVE_INFINITY }), /Limite de PDF inválido/i);
      await assert.rejects(repository.prepareDelivery({ revisionId: ids.revision, phone: first.phone, flowId: first.flowId, maxPdfBytes: -1 }), /Limite de PDF inválido/i);
      const oversized = createPostgresQuotationDeliveryRepository(() => db, { now: () => now, renderPdf: async () => pdfWithEof() });
      await assert.rejects(oversized.prepareDelivery({ revisionId: ids.revision, phone: first.phone, flowId: first.flowId, maxPdfBytes: 10 }), /PDF da revisão é inválido/i);
      const badSignature = createPostgresQuotationDeliveryRepository(() => db, { now: () => now, renderPdf: async () => Buffer.from('not a pdf') });
      await assert.rejects(badSignature.prepareDelivery({ revisionId: ids.revision, phone: first.phone, flowId: first.flowId }), /PDF da revisão é inválido/i);

      const completed = await repository.recordState({ revisionId: ids.revision, state: 'completed', providerAcceptanceId: 'accepted-1', publicError: 'temporary diagnostic' });
      assert.equal(completed.state, 'completed');
      assert.equal(completed.providerAcceptanceId, 'accepted-1');
      await assert.rejects(repository.recordState({ revisionId: ids.revision, state: 'transporting' }), /estado.*entrega|reconciliação|concluída/i);
      await assert.rejects(repository.prepareDelivery({ revisionId: ids.revision, phone: first.phone, flowId: first.flowId }), /concluída|reconciliação|nova revisão/i);
      await db.update(quotationDeliveries).set({ state: 'retryable', providerAcceptanceId: null, publicError: null, updatedAt: now }).where(eq(quotationDeliveries.revisionId, ids.revision));
      const casRepository = createPostgresQuotationDeliveryRepository(() => db, {
        now: () => now,
        beforeStateUpdate: async () => {
          await db.update(quotationDeliveries).set({ state: 'retryable', updatedAt: new Date(now.getTime() + 1) })
            .where(eq(quotationDeliveries.revisionId, ids.revision));
        },
      });
      await assert.rejects(
        casRepository.recordState({ revisionId: ids.revision, state: 'accepted_partial' }),
        (error: unknown) => error instanceof QuotationDeliveryConflictError && /outra tentativa/i.test(error.message),
      );
      const read = await repository.readDeliveryByRevision(ids.revision);
      assert.equal(read?.state, 'retryable');
      assert.equal(read?.publicError, null);
      const reclaimed = await repository.claimTransport(ids.revision);
      assert.equal(reclaimed?.state, 'transporting');
      assert.equal(await repository.claimTransport(ids.revision), null);

      await repository.recordState({ revisionId: ids.revision, state: 'transporting', publicError: 'diagnostic retained' });
      const lateRepository = createPostgresQuotationDeliveryRepository(() => db, {
        now: () => new Date(now.getTime() + 31 * 86400000),
      });
      const late = await lateRepository.readDeliveryByRevision(ids.revision);
      assert.equal(late?.readOnly, true);
      assert.equal(late?.publicError, 'diagnostic retained');
      const redactedRepository = createPostgresQuotationDeliveryRepository(() => db, {
        now: () => new Date(now.getTime() + 91 * 86400000),
      });
      const redacted = await redactedRepository.readDeliveryByRevision(ids.revision);
      assert.equal(redacted?.readOnly, true);
      assert.equal(redacted?.publicError, null);
      assert.equal(redacted?.phone, '5521995419741');
      assert.equal(redacted?.flowId, 'already-talking');

      const expiredRepository = createPostgresQuotationDeliveryRepository(() => db, {
        now: () => new Date('2026-09-01T12:00:00.000Z'),
      });
      await db.update(quoteRevisions).set({ issuedAt: new Date('2020-01-01T12:00:00.000Z') }).where(eq(quoteRevisions.id, ids.revision));
      await assert.rejects(
        expiredRepository.reserve({ revisionId: ids.revision, phone: first.phone, flowId: first.flowId }),
        /vencida/i,
      );

      const draftRevision = randomUUID();
      await db.insert(quoteRevisions).values({
        id: draftRevision,
        quotationId: ids.quotation,
        version: 2,
        status: 'rascunho',
        validadeDias: 15,
        pagamento: 'À vista',
        entrega: '',
        fretePadrao: '0.00',
        frete: '0.00',
        observacoes: '',
        prazoProducao: '',
        templatePadrao: templateKey,
        templateHash: SECTION_TEMPLATE_HASH,
        clienteNome: 'Rascunho',
        subtotal: '0.00',
        total: '0.00',
        createdAt: now,
      });
      await assert.rejects(repository.reserve({ revisionId: draftRevision, phone: first.phone, flowId: first.flowId }), /emitidas/i);
    } finally {
      await db.delete(quotationDeliveries).where(eq(quotationDeliveries.revisionId, ids.revision));
      await db.delete(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, ids.revision));
      await db.delete(quoteRevisions).where(eq(quoteRevisions.quotationId, ids.quotation));
      await db.delete(quotations).where(eq(quotations.id, ids.quotation));
      await db.delete(clients).where(eq(clients.id, ids.client));
      await db.delete(products).where(eq(products.sku, ids.product));
      await db.delete(quotationTemplateVersions).where(eq(quotationTemplateVersions.id, ids.templateVersion));
      await db.delete(quotationTemplates).where(eq(quotationTemplates.id, ids.template));
      await sql.end({ timeout: 5 });
    }
  },
);
