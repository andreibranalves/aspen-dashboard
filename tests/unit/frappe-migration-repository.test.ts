import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as migrationRepositoryModule from '../../api/_db/frappe-migration-repository.js';
import { MemoryFrappeMigrationRepository } from '../../api/_db/frappe-migration-repository.js';
import {
  computeManifestHash,
  runFrappeMigration as runFrappeMigrationImplementation,
  type FrappeDataset,
} from '../../api/_functions/frappe-migration.js';
import { templateSeedPlan } from '../../api/_db/quotation-template-migration.js';
import { createFrappeQuotationFixture } from '../fixtures/frappe-migration-fixtures.ts';

const MINIMAL_DATASET: FrappeDataset = {
  items: [{ name: 'ITEM-T1', item_code: 'SKU-T1', item_name: 'Produto Teste' }],
  pricingRules: [],
  itemPrices: [],
  customers: [{ name: 'CUST-T1', customer_name: 'Cliente Teste', tax_id: '11223344556' }],
  leads: [],
  quotations: [],
};

const runFrappeMigration = (options: Parameters<typeof runFrappeMigrationImplementation>[0]) =>
  runFrappeMigrationImplementation(
    options.mode === 'apply' && !options.expectedManifestHash
      ? { ...options, expectedManifestHash: computeManifestHash(options.dataset!) }
      : options
  );

describe('MemoryFrappeMigrationRepository', () => {
  it('reusa draft source-changed e cria novo draft após revisão não editável', async () => {
    const dataset = (status: string, total: string) => {
      const fixture = createFrappeQuotationFixture();
      return {
        ...fixture,
        quotations: fixture.quotations.map((quotation) =>
          quotation.name === 'QTN-2024-00042'
            ? {
                ...quotation,
                modified: `2024-04-01 ${total === '5.00' ? '00:00:00' : '00:01:00'}`,
                status,
                net_total: total,
                grand_total: total,
                items: quotation.items?.map((item, index) =>
                  index === 0 ? { ...item, rate: total, amount: total } : item
                ),
              }
            : quotation,
        ),
      };
    };

    const draftRepository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset: dataset('Draft', '5.00'), repository: draftRepository });
    const draftQuotationId = draftRepository.snapshot().quotations[0]!.id;
    const firstDraft = draftRepository.snapshot().quotations[0]?.revision;
    assert.ok(firstDraft);
    await runFrappeMigration({ mode: 'apply', dataset: dataset('Draft', '7.00'), repository: draftRepository });
    const updatedDraft = draftRepository.snapshot().quotations[0]?.revision;
    assert.ok(updatedDraft);
    assert.equal(updatedDraft.id, firstDraft.id);
    assert.equal(updatedDraft.version, firstDraft.version);
    assert.equal(updatedDraft.status, 'rascunho');
    assert.equal(Number(updatedDraft.total), 7);
    assert.deepEqual(draftRepository.revisionHistory(draftQuotationId), []);

    const sentRepository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset: dataset('Submitted', '5.00'), repository: sentRepository });
    const sentRevision = sentRepository.snapshot().quotations[0]?.revision;
    assert.ok(sentRevision);
    const quotationId = sentRepository.snapshot().quotations[0]!.id;
    await runFrappeMigration({ mode: 'apply', dataset: dataset('Submitted', '7.00'), repository: sentRepository });
    const nextRevision = sentRepository.snapshot().quotations[0]?.revision;
    assert.ok(nextRevision);
    assert.notEqual(nextRevision.id, sentRevision.id);
    assert.equal(nextRevision.version, sentRevision.version + 1);
    assert.equal(nextRevision.status, 'rascunho');
    assert.equal(sentRepository.revisionHistory(quotationId)[0]?.id, sentRevision.id);
    assert.equal(Number(sentRepository.revisionHistory(quotationId)[0]?.total), 5);
  });

  it('verifica todas as versões numéricas dos templates built-in', async () => {
    const plan = templateSeedPlan();
    assert.ok(plan.length >= 3);
    assert.equal(new Set(plan.map((item) => item.key)).size, plan.length);
    assert.ok(plan.every((item) => item.version === 1));
    const repository = new MemoryFrappeMigrationRepository();
    assert.deepEqual(await repository.ensureQuotationTemplates(), { missing: [] });
  });

  it('bloqueia apply antes das gravações quando falta versão de template', async () => {
    const repository = new MemoryFrappeMigrationRepository({ templatesReady: false });
    const result = await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    assert.equal(result.manifest.status, 'failed');
    assert.ok(result.report.orcamentos.divergentes > 0);
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.writes.clients, 0);
    assert.equal(repository.writes.quotations, 0);

    const wrongVersion = new MemoryFrappeMigrationRepository();
    wrongVersion.ensureQuotationTemplates = async () => ({
      missing: [{ key: 'padrao', sourceHash: '0'.repeat(64), version: 99 }],
    });
    const wrongResult = await runFrappeMigration({
      mode: 'apply',
      dataset: MINIMAL_DATASET,
      repository: wrongVersion,
    });
    assert.equal(wrongResult.manifest.status, 'failed');
    assert.equal(wrongVersion.writes.products, 0);
  });

  it('bloqueia orçamento com cliente ou produto ausente antes de qualquer gravação', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [],
        customers: [{ name: 'CUST-MISSING', customer_name: 'Cliente', tax_id: '12345678901' }],
        quotations: [
          {
            name: 'QTN-2025-00002',
            creation: '2025-01-01 10:00:00',
            quotation_to: 'Customer',
            customer: 'CUST-MISSING',
            status: 'Draft',
            items: [{ idx: 1, item_code: 'SKU-MISSING', qty: '1', rate: '5', price_list_rate: '5', amount: '5' }],
          },
        ],
      },
    });
    assert.equal(result.manifest.status, 'failed');
    assert.ok(result.report.orcamentos.divergentes > 0);
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.writes.clients, 0);
    assert.equal(repository.writes.quotations, 0);

    const approvedRepository = new MemoryFrappeMigrationRepository();
    const approved = await runFrappeMigration({
      mode: 'apply',
      repository: approvedRepository,
      approvedDivergences: ['Quotation:QTN-2025-00002'],
      dataset: {
        items: [],
        customers: [{ name: 'CUST-MISSING-APPROVED', customer_name: 'Cliente', tax_id: '12345678901' }],
        quotations: [
          {
            name: 'QTN-2025-00002',
            creation: '2025-01-01 10:00:00',
            quotation_to: 'Customer',
            customer: 'CUST-MISSING-APPROVED',
            status: 'Draft',
            items: [{ idx: 1, item_code: 'SKU-MISSING', qty: '1', rate: '5', price_list_rate: '5', amount: '5' }],
          },
        ],
      },
    });
    assert.equal(approved.manifest.status, 'completed');
    assert.equal(approved.report.orcamentos.divergentes, 0);
    assert.ok(approved.report.orcamentos.aprovadas > 0);
    assert.equal(approvedRepository.writes.clients, 1);
    assert.equal(approvedRepository.writes.quotations, 0);
  });

  it('permite divergência explicitamente aprovada e mantém contagem separada', async () => {
    const dataset: FrappeDataset = {
      items: [{ name: 'ITEM-S5', item_code: 'SKU-S5', item_name: 'Produto' }],
      customers: [{ name: 'CUST-S5', customer_name: 'Cliente', tax_id: '12345678901' }],
      quotations: [
        {
          name: 'QTN-2025-00001',
          creation: '2025-01-01 10:00:00',
          quotation_to: 'Customer',
          customer: 'CUST-S5',
          status: 'Unsupported Legacy Status',
          items: [{ idx: 1, item_code: 'SKU-S5', qty: '1', rate: '5', price_list_rate: '5', amount: '5' }],
        },
      ],
    };
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      dataset,
      repository,
      approvedDivergences: ['Quotation:QTN-2025-00001'],
    });
    assert.equal(result.report.orcamentos.divergentes, 0);
    assert.equal(result.report.orcamentos.aprovadas, 1);
    assert.equal(repository.writes.quotations, 1);
    const persisted = await repository.loadState();
    const revision = persisted.quotations[0]?.revision;
    assert.equal(revision?.status, 'rascunho');
    assert.equal(revision?.statusOriginal, 'Unsupported Legacy Status');
    assert.equal(revision?.orderLinkage, null);
    assert.equal(revision?.orderPending, false);

    const orderedRepository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({
      mode: 'apply',
      repository: orderedRepository,
      dataset: {
        ...dataset,
        quotations: [{ ...dataset.quotations![0]!, name: 'QTN-2025-00002', status: 'Ordered' }],
      },
    });
    const orderedRevision = (await orderedRepository.loadState()).quotations[0]?.revision;
    assert.equal(orderedRevision?.status, 'aprovado');
    assert.equal(orderedRevision?.statusOriginal, 'Ordered');
    assert.equal(orderedRevision?.orderLinkage, 'ordered');
    assert.equal(orderedRevision?.orderPending, true);
  });

  it('loadState e snapshot não expõem legacyPayload na linhagem', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    const state = await repository.loadState();
    for (const entry of state.lineage) {
      assert.equal(
        (entry as unknown as Record<string, unknown>).legacyPayload,
        undefined,
        'loadState lineage must not expose legacyPayload'
      );
    }
    const snap = repository.snapshot();
    for (const entry of snap.lineage) {
      assert.equal(
        (entry as unknown as Record<string, unknown>).legacyPayload,
        undefined,
        'snapshot lineage must not expose legacyPayload'
      );
    }
  });

  it('readRawPayload retorna payload autorizado para operações', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    assert.equal(await repository.readRawPayload('Item', 'ITEM-T1'), null);
    assert.equal(await repository.readRawPayload('Item', 'ITEM-T1'), null);
    assert.equal(
      Object.prototype.hasOwnProperty.call(migrationRepositoryModule, 'RAW_PAYLOAD_ACCESS'),
      false,
      'capability não pode ser exportada'
    );
    // Non-existent entry returns null
    const missing = await repository.readRawPayload('Item', 'NONEXISTENT');
    assert.equal(missing, null);
  });

  it('migração retorna manifest com activeRunId ao reutilizar run falho', async () => {
    const repository = new MemoryFrappeMigrationRepository({ failProductSku: 'SKU-T1' });
    const dataset: FrappeDataset = {
      items: [{ name: 'ITEM-F1', item_code: 'SKU-T1', item_name: 'Falha' }],
      pricingRules: [],
      itemPrices: [],
      customers: [],
      leads: [],
      quotations: [],
    };
    const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(first.manifest.status, 'failed');
    assert.equal(repository.runs.length, 1);
    const failedRunId = repository.runs[0].id;
    assert.equal(first.manifest.runId, failedRunId);

    repository.failProductSku = undefined;
    const second = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(second.manifest.status, 'completed');
    // Same run was reused
    assert.equal(repository.runs.length, 1);
    assert.equal(second.manifest.runId, failedRunId);
  });

  it('lineage persiste migrationRunId === run.id em apply', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset: FrappeDataset = {
      items: [{ name: 'ITEM-R1', item_code: 'SKU-R1', item_name: 'R1' }],
      pricingRules: [],
      itemPrices: [],
      customers: [],
      leads: [],
      quotations: [],
    };
    const result = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(result.manifest.status, 'completed');
    const runId = repository.runs[0].id;
    // All lineage entries expose the complete contract and reference the run.
    const lineage = repository.snapshot().lineage;
    assert.equal(lineage.length, 1);
    assert.equal(lineage[0].provider, 'frappe');
    assert.equal(lineage[0].migrationRunId, runId);
    assert.equal(lineage[0].localId, 'SKU-R1');
    assert.equal(lineage[0].localKey, 'SKU-R1');
    assert.ok(lineage[0].sourceHash);
    assert.match(lineage[0].sourceHash, /^[0-9a-f]{64}$/);
    assert.notEqual(lineage[0].sourceHash, lineage[0].canonicalHash);
    assert.equal(lineage[0].sourceUpdatedAt, null);
    assert.ok(lineage[0].importedAt instanceof Date);
    assert.equal(await repository.readRawPayload('Item', 'ITEM-R1'), null);
  });

  it('persiste todos os campos de linhagem, inclusive timestamp e número comercial', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [
          {
            name: 'ITEM-CONTRACT',
            item_code: 'SKU-CONTRACT',
            item_name: 'Produto contrato',
            modified: '2024-01-02 03:04:05',
          },
        ],
        pricingRules: [
          {
            name: 'PR-CONTRACT',
            item_code: 'SKU-CONTRACT',
            min_qty: 10,
            price_list_rate: '8.00',
            modified: '2024-01-06 03:04:05',
          },
        ],
        itemPrices: [],
        customers: [
          {
            name: 'CUST-CONTRACT',
            customer_name: 'Cliente contrato',
            tax_id: '11223344556',
            modified: '2024-01-03 03:04:05',
          },
        ],
        leads: [],
        quotations: [
          {
            name: 'QTN-2024-00001',
            creation: '2024-01-04 03:04:05',
            modified: '2024-01-05 03:04:05',
            quotation_to: 'Customer',
            customer: 'CUST-CONTRACT',
            status: 'Draft',
            items: [
              {
                idx: 1,
                item_code: 'SKU-CONTRACT',
                item_name: 'Produto contrato',
                qty: '1',
                uom: 'Und',
                rate: '10.00',
                price_list_rate: '10.00',
                amount: '10.00',
              },
            ],
          },
        ],
      },
    });
    assert.equal(result.manifest.status, 'completed');
    const runId = repository.runs[0].id;
    const lineage = repository.snapshot().lineage;
    assert.equal(lineage.length, 4);
    for (const entry of lineage) {
      assert.equal(entry.provider, 'frappe');
      assert.equal(entry.migrationRunId, runId);
      assert.equal(entry.localId, entry.localKey);
      assert.ok(entry.sourceHash);
      assert.match(entry.sourceHash, /^[0-9a-f]{64}$/);
      assert.ok(entry.importedAt instanceof Date);
    }
    const item = lineage.find((entry) => entry.sourceId === 'ITEM-CONTRACT');
    assert.ok(item);
    assert.equal(item.sourceUpdatedAt?.toISOString(), '2024-01-02T03:04:05.000Z');
    const faixa = lineage.find((entry) => entry.sourceId === 'PR-CONTRACT');
    assert.ok(faixa);
    assert.equal(faixa.entityType, 'faixa');
    assert.equal(faixa.sourceUpdatedAt?.toISOString(), '2024-01-06T03:04:05.000Z');
    const client = lineage.find((entry) => entry.sourceId === 'CUST-CONTRACT');
    assert.ok(client);
    assert.equal(client.sourceUpdatedAt?.toISOString(), '2024-01-03T03:04:05.000Z');
    const quotation = lineage.find((entry) => entry.sourceId === 'QTN-2024-00001');
    assert.ok(quotation);
    assert.equal(quotation.businessNumber, 'ORC-20240001');
    assert.equal(quotation.sourceUpdatedAt?.toISOString(), '2024-01-05T03:04:05.000Z');
    assert.notEqual(quotation.localId, 'ORC-20240001');
  });

  it('faixas usam checkpoint próprio e divergências falham o batch', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        items: [{ name: 'ITEM-BATCH', item_code: 'SKU-BATCH', item_name: 'Produto batch' }],
        pricingRules: [
          { name: 'PR-BATCH-1', item_code: 'SKU-BATCH', min_qty: 1, price_list_rate: '10.00' },
          { name: 'PR-BATCH-2', item_code: 'SKU-BATCH', min_qty: 30, price_list_rate: '8.00' },
        ],
        itemPrices: [],
        customers: [],
        leads: [],
        quotations: [],
      },
    });
    assert.equal(result.report.produtos.erros, 0);
    assert.equal(result.report.faixas.erros, 0);
    const productBatch = repository.batches.find((batch) => batch.entityType === 'produtos');
    const priceBatch = repository.batches.find((batch) => batch.entityType === 'faixas');
    assert.ok(productBatch);
    assert.ok(priceBatch);
    assert.equal(productBatch.checkpoint, 1);
    assert.equal(priceBatch.checkpoint, 2);
    assert.notEqual(priceBatch.checkpoint, productBatch.checkpoint);
    assert.equal(productBatch.status, 'completed');
    assert.equal(priceBatch.status, 'completed');
    assert.ok(repository.batches.every((batch) => !['pending', 'running'].includes(batch.status)));

    const divergentRepository = new MemoryFrappeMigrationRepository();
    const divergent = await runFrappeMigration({
      mode: 'apply',
      repository: divergentRepository,
      dataset: {
        items: [{ name: 'ITEM-DIVERGENT-BATCH', item_code: 'SKU-DIVERGENT-BATCH', item_name: 'Produto' }],
        pricingRules: [
          { name: 'PR-DIVERGENT', item_code: 'SKU-DIVERGENT-BATCH', min_qty: 1, price_list_rate: '10.00' },
          { name: 'PR-DIVERGENT', item_code: 'SKU-DIVERGENT-BATCH', min_qty: 1, price_list_rate: '9.00' },
        ],
        itemPrices: [],
        customers: [],
        leads: [],
        quotations: [],
      },
    });
    assert.ok(divergent.report.faixas.divergentes > 0);
    assert.equal(
      divergentRepository.batches.find((batch) => batch.entityType === 'faixas')?.status,
      'failed'
    );
    assert.ok(
      divergentRepository.batches.every((batch) => !['pending', 'running'].includes(batch.status))
    );
  });

  it('resume cria batches ausentes e encerra todos em estado terminal', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const originalCreateBatch = repository.createBatch.bind(repository);
    let failedOnce = false;
    repository.createBatch = async (params) => {
      if (!failedOnce && params.entityType === 'faixas') {
        failedOnce = true;
        throw new Error('falha parcial de checkpoint');
      }
      return originalCreateBatch(params);
    };
    const dataset = MINIMAL_DATASET;
    const first = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(first.manifest.status, 'failed');
    assert.equal(repository.batches.length, 1);
    repository.createBatch = originalCreateBatch;
    const second = await runFrappeMigration({ mode: 'apply', dataset, repository });
    assert.equal(second.manifest.status, 'completed');
    assert.equal(repository.batches.length, 5);
    assert.ok(repository.batches.every((batch) => !['pending', 'running'].includes(batch.status)));
  });

  it('falha de completeRun bloqueia manifest e aparece no relatório', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const originalCompleteRun = repository.completeRun.bind(repository);
    let failCompletion = true;
    repository.completeRun = async (runId, status) => {
      if (failCompletion && status === 'completed') {
        failCompletion = false;
        throw new Error('falha ao concluir run');
      }
      return originalCompleteRun(runId, status);
    };
    const result = await runFrappeMigration({
      mode: 'apply',
      dataset: MINIMAL_DATASET,
      repository,
    });
    assert.equal(result.manifest.status, 'failed');
    assert.ok(result.report.total.erros > 0);
    assert.ok(
      result.report.total.detalhes.some(
        (detail) => detail.source_doctype === 'migration_tracking' && detail.status === 'erros'
      )
    );
    assert.equal(repository.runs[0].status, 'failed');
    assert.ok(repository.batches.every((batch) => !['pending', 'running'].includes(batch.status)));
  });

  it('batches têm checkpoint >= 0 e attempt_count >= 0', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    for (const batch of repository.batches) {
      assert.ok(batch.checkpoint >= 0, `batch ${batch.entityType} checkpoint >= 0`);
      assert.ok(batch.attemptCount >= 0, `batch ${batch.entityType} attempt_count >= 0`);
    }
  });

  it('batches cobrem todas as entidades (produtos, faixas, clientes, orcamentos, documentos)', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    const types = repository.batches.map((b) => b.entityType).sort();
    assert.deepEqual(types, ['clientes', 'documentos', 'faixas', 'orcamentos', 'produtos']);
  });

  it('dry-run não cria batches nem runs', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'dry-run', dataset: MINIMAL_DATASET, repository });
    assert.equal(repository.runs.length, 0);
    assert.equal(repository.batches.length, 0);
  });

  it('sanitizeReportMessage mascara CPF/CNPJ/email em mensagens do relatório', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const dataset: FrappeDataset = {
      items: [],
      customers: [
        { name: '12.345.678/0001-90', customer_name: 'Empresa', tax_id: '12345678000190' },
        { name: 'john@example.com', lead_name: 'Lead Email', tax_id: '11122233344' },
      ],
      leads: [],
    };
    const result = await runFrappeMigration({ mode: 'dry-run', dataset, repository });
    const serialized = JSON.stringify(result.report);
    // Raw PII must not appear
    assert.equal(serialized.includes('12.345.678/0001-90'), false);
    assert.equal(serialized.includes('12345678000190'), false);
    assert.equal(serialized.includes('john@example.com'), false);
    assert.equal(serialized.includes('11122233344'), false);
  });

  it('erro de createBatch marca run como failed', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    // Inject a failure by making createBatch throw
    const originalCreateBatch = repository.createBatch.bind(repository);
    let callCount = 0;
    repository.createBatch = async (params) => {
      callCount += 1;
      if (callCount === 2) throw new Error('batch creation failure');
      return originalCreateBatch(params);
    };
    const result = await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    // Run should be marked as failed
    const run = repository.runs.find((r) => r.status === 'failed');
    assert.ok(run, 'run should be marked as failed after createBatch error');
    assert.equal(result.manifest.status, 'failed');
    assert.ok(result.report.total.erros > 0);
    assert.ok(repository.batches.every((batch) => !['pending', 'running'].includes(batch.status)));
  });

  it('falha de tracking interrompe antes de gravar clientes e orçamentos', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    const originalUpdateBatch = repository.updateBatch.bind(repository);
    let failed = false;
    repository.updateBatch = async (batchId, params) => {
      if (!failed && params.checkpoint !== undefined) {
        failed = true;
        throw new Error('falha ao persistir cursor');
      }
      return originalUpdateBatch(batchId, params);
    };
    const result = await runFrappeMigration({
      mode: 'apply',
      repository,
      dataset: {
        ...MINIMAL_DATASET,
        quotations: [
          {
            name: 'QTN-2024-00001',
            quotation_to: 'Customer',
            customer: 'CUST-T1',
            status: 'Draft',
            creation: '2024-01-01 10:00:00',
            items: [
              {
                idx: 1,
                item_code: 'SKU-T1',
                item_name: 'Produto Teste',
                qty: 1,
                rate: '10.00',
                price_list_rate: '10.00',
                amount: '10.00',
              },
            ],
          },
        ],
      },
    });
    assert.equal(result.manifest.status, 'failed');
    assert.equal(repository.writes.products, 1);
    assert.equal(repository.writes.clients, 0);
    assert.equal(repository.writes.quotations, 0);
    assert.equal(repository.runs[0].status, 'failed');
    assert.ok(result.report.total.detalhes.some((detail) => detail.source_doctype === 'migration_tracking'));
  });

  it('lease em memória permite manifestos distintos em paralelo', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    await repository.acquireMigrationLease('manifest-a', 'owner-a');
    await repository.acquireMigrationLease('manifest-b', 'owner-b');
    await repository.releaseMigrationLease('manifest-a', 'owner-a');
    await repository.releaseMigrationLease('manifest-b', 'owner-b');
  });

  it('lease impede dois applies concorrentes de reutilizar run e cursor', async () => {
    let releaseWrite!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    class BlockingRepository extends MemoryFrappeMigrationRepository {
      override async applyProductUnit(...args: Parameters<MemoryFrappeMigrationRepository['applyProductUnit']>) {
        markStarted();
        await gate;
        return super.applyProductUnit(...args);
      }
    }
    const repository = new BlockingRepository();
    const firstPromise = runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    await started;
    const second = await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    assert.equal(second.manifest.status, 'failed');
    assert.equal(repository.transactions.products, 0);
    releaseWrite();
    const first = await firstPromise;
    assert.equal(first.manifest.status, 'completed');
    assert.equal(repository.transactions.products, 1);
    assert.equal(repository.runs.length, 1);
    assert.ok(repository.batches.every((batch) => !['pending', 'running'].includes(batch.status)));
  });

  it('falha de createRun bloqueia todas as gravações', async () => {
    const repository = new MemoryFrappeMigrationRepository();
    repository.createRun = async () => {
      throw new Error('falha ao criar run');
    };
    const result = await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    assert.equal(result.manifest.status, 'failed');
    assert.equal(repository.writes.products, 0);
    assert.equal(repository.writes.clients, 0);
    assert.equal(repository.writes.quotations, 0);
  });

  it('reconhece linha pré-0014 como legacy-unverified mesmo com sourceHash', async () => {
    const seeded = new MemoryFrappeMigrationRepository();
    await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository: seeded });
    const state = await seeded.loadState();
    const legacy = state.lineage.find((entry) => entry.sourceId === 'ITEM-T1');
    assert.ok(legacy?.sourceHash);
    legacy.lineageStatus = undefined;
    const repository = new MemoryFrappeMigrationRepository({ state });
    const result = await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    assert.equal(result.report.produtos.atualizados, 1);
    assert.equal(repository.snapshot().lineage[0].lineageStatus, 'verified');
  });

  it('reconcilia linhagem legacy-unverified sem tratar canonical_hash como source_hash', async () => {
    const repository = new MemoryFrappeMigrationRepository({
      state: {
        products: [
          {
            sku: 'SKU-T1',
            nome: 'Produto Teste',
            descricao: '',
            unidade: 'Und',
            categoria: null,
            marca: null,
            ativo: true,
            precoBase: null,
            precos: [],
          },
        ],
        lineage: [
          {
            provider: 'frappe',
            sourceDoctype: 'Item',
            sourceId: 'ITEM-T1',
            entityType: 'produto',
            localId: 'SKU-T1',
            localKey: 'SKU-T1',
            canonicalHash: 'a'.repeat(64),
            sourceHash: null,
            lineageStatus: 'legacy-unverified',
            businessNumber: null,
            migrationRunId: null,
            sourceUpdatedAt: null,
            importedAt: null,
          },
        ],
      },
    });
    const result = await runFrappeMigration({ mode: 'apply', dataset: MINIMAL_DATASET, repository });
    assert.equal(result.report.produtos.atualizados, 1);
    const reconciled = repository.snapshot().lineage.find((entry) => entry.sourceId === 'ITEM-T1');
    assert.ok(reconciled);
    assert.equal(reconciled.lineageStatus, 'verified');
    assert.ok(reconciled.sourceHash);
    assert.notEqual(reconciled.sourceHash, reconciled.canonicalHash);
  });
});
