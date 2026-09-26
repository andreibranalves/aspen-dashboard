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
  quotationTemplateVersions,
  quotationTemplates,
} from '../../api/_infrastructure/db/schema.js';
import { createQuotationTemplateRepository } from '../../api/_infrastructure/db/repositories/quotation-template-repository.js';
import {
  createQuotationDeliveryDocuments,
  QuotationDeliveryConflictError,
  QuotationDeliveryPdfError,
  QuotationDeliveryRepositoryError,
  type QuotationDeliveryDocumentsOptions,
} from '../../api/_modules/quotation-delivery-documents.js';
import { renderQuotationDocument } from '../../api/_modules/quotation-document.js';
import {
  createQuotationSectionsSnapshot,
  normalizeQuotationSections,
  withQuotationProductionDeadline,
  type QuotationSectionsSnapshot,
} from '../../api/_modules/quotation-content.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env, ['TEST_QUOTE_DATABASE_URL', 'TEST_DATABASE_URL']);
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

function pdfWithEof(): Buffer {
  return Buffer.from('%PDF-1.7\ncontent\n%%EOF');
}

const SECTION_TEMPLATE = '<!doctype html><html><body>{{quote_number}} {{client.name}} Telefone: {{client.phone}} Data: {{display.quote_date}} Validade: {{display.validity_date}} {{#each items}}{{name}} Quantidade: {{quantity}}{{/each}} {{display.total}} {{secoes.pagamento.body_html}} {{secoes.condicoes_gerais.body_html}} {{secoes.prazo_producao.value}}</body></html>';
const SECTION_TEMPLATE_HASH = createHash('sha256').update(SECTION_TEMPLATE).digest('hex');

function fakePreparationDatabase(options: {
  failRevisionRead?: boolean;
  items?: unknown[];
  total?: string;
  templateKey?: string;
  templateSource?: string;
  sectionsSnapshot?: QuotationSectionsSnapshot | null;
} = {}) {
  const now = new Date('2026-08-13T12:00:00.000Z');
  const templateKey = options.templateKey || 'test';
  const templateSource = options.templateSource || SECTION_TEMPLATE;
  const templateHash = createHash('sha256').update(templateSource).digest('hex');
  const revisionId = '00000000-0000-4000-8000-000000000001';
  const quotationId = '00000000-0000-4000-8000-000000000002';
  const templateVersionId = '00000000-0000-4000-8000-000000000003';
  const revisionTotal = options.total ?? '10.00';
  const canonicalSections = options.sectionsSnapshot ?? createQuotationSectionsSnapshot(
    withQuotationProductionDeadline(normalizeQuotationSections(undefined), '')
  );
  const revision = {
    id: revisionId, quotationId, version: 1, status: 'emitido', issuedAt: now, createdAt: now,
    validadeDias: 15, entrega: '', fretePadrao: '0.00', frete: '0.00',
    templatePadrao: templateKey, templateHash,
    templateVersionId, clienteNome: 'ANDREI ALVES', clienteTelefone: '21999999999',
    clienteEmail: null, clienteDocumento: null, clienteEndereco: null, clienteNumero: null,
    clienteBairro: null, clienteComplemento: null, clienteMunicipio: null, clienteUf: null,
    clienteCep: null, clienteNotas: null, subtotal: revisionTotal, total: revisionTotal,
    sectionsSnapshot: canonicalSections,
  } as any;
  class Query {
    private rows: unknown[];
    private failure?: Error;
    constructor(rows: unknown[], failure?: Error) { this.rows = rows; this.failure = failure; }
    where() { return this; }
    orderBy() { return this; }
    innerJoin() {
      this.rows = this.rows.map((version) => ({
        version,
        model: { key: templateKey, name: templateKey, archived: false },
      }));
      return this;
    }
    limit() { return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.rows); }
    then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
      return (this.failure ? Promise.reject(this.failure) : Promise.resolve(this.rows)).then(resolve, reject);
    }
  }
  const db: any = {
    select: () => ({
      from: (table: unknown) => {
        if (table === quoteRevisions) {
          return new Query([revision], options.failRevisionRead ? new Error('database read failed') : undefined);
        }
        if (table === quotationTemplateVersions) return new Query([{ id: templateVersionId, source: templateSource, sourceHash: templateHash, contractVersion: 2 }]);
        if (table === quoteRevisionItems) return new Query(options.items || []);
        if (table === quotations) return new Query([{
          id: quotationId,
          businessNumber: 'ORC-20260001',
          clientId: '00000000-0000-4000-8000-000000000009',
          status: 'emitido',
          createdAt: now,
          updatedAt: now,
        }]);
        return new Query([]);
      },
    }),
  };
  return { db, now, revisionId };
}

function documents(db: any, now: Date, options: Omit<QuotationDeliveryDocumentsOptions, 'now' | 'repository'> = {}) {
  return createQuotationDeliveryDocuments({
    now: () => now,
    repository: createQuotationTemplateRepository(() => db),
    ...options,
  });
}

test('database reads are not classified as PDF failures', async () => {
  const { db, now, revisionId } = fakePreparationDatabase({ failRevisionRead: true });
  await assert.rejects(
    documents(db, now).prepareDeliveryDocument(revisionId),
    (error: unknown) => error instanceof QuotationDeliveryRepositoryError && !(error instanceof QuotationDeliveryPdfError),
  );
});

test('delivery PDF formats issue and validity dates for display', async () => {
  const { db, now, revisionId } = fakePreparationDatabase();
  let renderedHtml = '';
  const repository = documents(db, now, {
    renderPdf: async (html) => {
      renderedHtml = html;
      return pdfWithEof();
    },
  });

  await repository.prepareDeliveryDocument(revisionId);

  assert.match(renderedHtml, /Andrei Alves/);
  assert.match(renderedHtml, /Telefone: \(21\) 99999-9999/);
  assert.match(renderedHtml, /Data: 13\/08\/2026/);
  assert.match(renderedHtml, /Validade: 28\/08\/2026/);
});

test('delivery PDF uses the canonical document output for section content and visibility', async () => {
  const source = '<!doctype html><html><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}} {{display.total}}<h1>{{secoes.pagamento.title}}</h1><div>{{secoes.pagamento.body_html}}</div><h2>{{secoes.condicoes_gerais.title}}</h2><div>{{secoes.condicoes_gerais.body_html}}</div></body></html>';
  const sections = {
    schema_version: 1,
    prazo_producao: {
      base: { enabled: true, title: 'Prazo' },
      current: { enabled: true, title: 'Prazo' },
    },
    pagamento: {
      base: { enabled: true, title: 'Pagamento' , body: 'Base' },
      current: { enabled: true, title: 'Pagamento customizado', body: 'Pix <script>não executar</script>\nSaldo' },
    },
    condicoes_gerais: {
      base: { enabled: true, title: 'Condições', body: 'Base' },
      current: { enabled: false, title: 'Não mostrar', body: 'segredo' },
    },
  } as QuotationSectionsSnapshot;
  const { db, now, revisionId } = fakePreparationDatabase({
    templateSource: source,
    sectionsSnapshot: sections,
  });
  let seamCalls = 0;
  let renderedHtml = '';
  const repository = documents(db, now, {
    renderDocument: (snapshot) => {
      seamCalls += 1;
      return renderQuotationDocument(snapshot);
    },
    renderPdf: async (html) => {
      renderedHtml = html;
      return pdfWithEof();
    },
  });

  await repository.prepareDeliveryDocument(revisionId);

  assert.equal(seamCalls, 1);
  assert.match(renderedHtml, /Pagamento customizado/);
  assert.match(renderedHtml, /Pix &lt;script&gt;não executar&lt;\/script&gt;<br>Saldo/);
  assert.doesNotMatch(renderedHtml, /Não mostrar|segredo/);
});

test('delivery PDF supplies comparison data to the comparative template', async () => {
  const { db, now, revisionId } = fakePreparationDatabase({
    templateKey: 'comparativo',
    templateSource: '<!doctype html><html><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}} {{display.total}} {{#each comparison.brackets}}{{label}}{{/each}} {{#each comparison.products}}{{name}}{{/each}}</body></html>',
    items: [{
      id: '00000000-0000-4000-8000-000000000005',
      position: 0,
      produtoSku: 'SKU-30',
      produtoNome: 'Produto comparativo',
      produtoDescricao: '',
      produtoUnidade: 'Und',
      quantidade: '30.000',
      precoMinimoFaixa: '30',
      precoAplicado: '10.00',
      totalLinha: '300.00',
    }],
  });
  let renderedHtml = '';
  const repository = documents(db, now, {
    renderPdf: async (html) => {
      renderedHtml = html;
      return pdfWithEof();
    },
  });

  await repository.prepareDeliveryDocument(revisionId);

  assert.match(renderedHtml, /30 - 99/);
  assert.match(renderedHtml, /Produto comparativo/);
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
  const repository = documents(db, now, {
    renderPdf: async (html) => {
      renderedHtml = html;
      return pdfWithEof();
    },
  });

  await repository.prepareDeliveryDocument(revisionId);

  assert.match(renderedHtml, /Quantidade: 70(?:<|\s)/);
  assert.doesNotMatch(renderedHtml, /Quantidade: 70\.000/);
});

test('delivery PDF formats monetary totals with thousands separator', async () => {
  const { db, now, revisionId } = fakePreparationDatabase({ total: '2500.00' });
  let renderedHtml = '';
  const repository = documents(db, now, {
    renderPdf: async (html) => {
      renderedHtml = html;
      return pdfWithEof();
    },
  });

  await repository.prepareDeliveryDocument(revisionId);

  assert.match(renderedHtml, /R\$ 2\.500,00/);
  assert.doesNotMatch(renderedHtml, /R\$ 2500,00/);
});

test('renderer failures, invalid bytes and oversized PDFs are PDF failures', async () => {
  const { db, now, revisionId } = fakePreparationDatabase();
  for (const renderPdf of [
    async () => { throw new Error('renderer failed'); },
    async () => Buffer.from('not a pdf'),
    async () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(11 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF')]),
  ]) {
    await assert.rejects(
      documents(db, now, { renderPdf }).prepareDeliveryDocument(revisionId),
      (error: unknown) => error instanceof QuotationDeliveryPdfError,
    );
  }
});

test(
  'delivery PDF renders the immutable revision snapshot and refuses expired or draft revisions',
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
        entrega: '10 dias',
        templateVersionId: ids.templateVersion,
        fretePadrao: '0.00',
        frete: '0.00',
        templatePadrao: templateKey,
        templateHash: SECTION_TEMPLATE_HASH,
        sectionsSnapshot: ({
          schema_version: 1,
          prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo', value: 'FROZEN-PRAZO' } },
          pagamento: { base: { enabled: true, title: 'Pagamento', body: 'old' }, current: { enabled: true, title: 'Pagamento', body: 'FROZEN-PAGAMENTO' } },
          condicoes_gerais: { base: { enabled: true, title: 'Condições', body: 'old' }, current: { enabled: true, title: 'Condições', body: 'FROZEN-CONDICOES' } },
        } as unknown) as QuotationSectionsSnapshot,
        clienteNome: 'Cliente entrega',
        companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
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

      const repository = documents(db, now, {
        renderPdf: async (html) => {
          assert.match(html, /Cliente Entrega/);
          assert.match(html, /Produto snapshot/);
          assert.match(html, /FROZEN-PAGAMENTO/);
          assert.match(html, /FROZEN-CONDICOES/);
          assert.match(html, /FROZEN-PRAZO/);
          return pdfWithEof();
        },
      });
      const prepared = await repository.prepareDeliveryDocument(ids.revision);
      assert.equal(prepared.pdfSize, pdfWithEof().length);
      assert.match(prepared.pdfSignature, /^[0-9a-f]{64}$/);
      assert.equal(prepared.validUntil.toISOString(), '2026-08-28T12:00:00.000Z');
      await assert.rejects(
        documents(db, now, { renderPdf: async () => Buffer.from('not a pdf') }).prepareDeliveryDocument(ids.revision),
        /PDF da revisão é inválido/i,
      );
      await assert.rejects(
        documents(db, new Date('2026-09-01T12:00:00.000Z')).prepareDeliveryDocument(ids.revision),
        (error: unknown) => error instanceof QuotationDeliveryConflictError && /vencida/i.test(error.message),
      );

      const draftRevision = randomUUID();
      await db.insert(quoteRevisions).values({
        id: draftRevision,
        quotationId: ids.quotation,
        version: 2,
        status: 'rascunho',
        validadeDias: 15,
        entrega: '',
        fretePadrao: '0.00',
        frete: '0.00',
        templateVersionId: ids.templateVersion,
        templatePadrao: templateKey,
        templateHash: SECTION_TEMPLATE_HASH,
        sectionsSnapshot: createQuotationSectionsSnapshot(
          withQuotationProductionDeadline(normalizeQuotationSections(undefined), '')
        ),
        companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
        clienteNome: 'Rascunho',
        subtotal: '0.00',
        total: '0.00',
        createdAt: now,
      });
      await assert.rejects(repository.prepareDeliveryDocument(draftRevision), /emitidas/i);
    } finally {
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
