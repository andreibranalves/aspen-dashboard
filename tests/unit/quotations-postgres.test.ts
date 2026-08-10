import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { createPostgresQuoteDraftRepository } from '../../api/_db/quote-repository.js';
import {
  createPostgresQuoteDraftManagementRepository,
  QuoteManagementConflictError,
  QuoteManagementInputError,
} from '../../api/_db/quote-draft-management-repository.js';
import { createQuotationTemplateRepository, quotationSnapshotViewModel } from '../../api/_db/quotation-template-repository.js';
import {
  getQuotationTemplate,
  getQuotationTemplateManifest,
  renderQuotationTemplate,
} from '../../api/_functions/lib/quotation-templates.js';
import { appSettings, clients, productPricingTiers, products, quoteRevisionItems, quoteRevisions, quotations, quotationTemplateVersions, quotationTemplates } from '../../api/_db/schema.js';
import * as schema from '../../api/_db/schema.js';

const TEST_DATABASE_URL = process.env.TEST_QUOTE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

test('PostgreSQL draft management persists terms/manual prices atomically and protects stale/non-draft revisions', { skip: !TEST_DATABASE_URL }, async () => {
  const client = postgres(TEST_DATABASE_URL!, { max: 4, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sku = `QUOTE-MGMT-${suffix}`;
  const clientId = '77777777-7777-4777-8777-777777777777';
  const secondClientId = '88888888-8888-4888-8888-888888888888';
  const explicitSettings = {
    singletonId: 1,
    validadeDias: 42,
    pagamento: 'Pagamento da configuração',
    entrega: 'Entrega da configuração',
    fretePadrao: '2.25',
    observacoes: 'Observações da configuração',
    quotationSections: {
      schema_version: 1 as const,
      prazo_producao: { enabled: true, title: 'Prazo de produção' },
      pagamento: { enabled: false, title: 'Título de pagamento configurado', body: 'Pagamento da configuração' },
      condicoes_gerais: { enabled: false, title: 'Título de condições configurado', body: 'Observações da configuração' },
    },
    templatePadrao: 'padrao',
  };
  let previousSettings: typeof appSettings.$inferSelect | undefined;
  try {
    await migrate(db, { migrationsFolder });
    const templateHashes = new Map(getQuotationTemplateManifest().map((template) => [template.key, template.hash]));
    const migratedRevisions = await db
      .select({ templatePadrao: quoteRevisions.templatePadrao, templateHash: quoteRevisions.templateHash })
      .from(quoteRevisions);
    for (const migratedRevision of migratedRevisions) {
      assert.equal(templateHashes.get(migratedRevision.templatePadrao), migratedRevision.templateHash);
    }
    [previousSettings] = await db.select().from(appSettings).where(eq(appSettings.singletonId, 1));
    await db
      .insert(appSettings)
      .values(explicitSettings)
      .onConflictDoUpdate({ target: appSettings.singletonId, set: explicitSettings });
    const oldQuotations = await db.select({ id: quotations.id }).from(quotations).where(eq(quotations.clientId, clientId));
    if (oldQuotations.length) await db.delete(quotations).where(inArray(quotations.id, oldQuotations.map((row) => row.id)));
    const oldSecondQuotations = await db.select({ id: quotations.id }).from(quotations).where(eq(quotations.clientId, secondClientId));
    if (oldSecondQuotations.length) await db.delete(quotations).where(inArray(quotations.id, oldSecondQuotations.map((row) => row.id)));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(clients).where(eq(clients.id, secondClientId));
    await db.delete(products).where(eq(products.sku, sku));
    await db.insert(products).values({ sku, nome: 'Produto de gerenciamento', descricao: 'Original', unidade: 'Und', precoBase: '12.00', ativo: true });
    await db.insert(productPricingTiers).values({ productSku: sku, minimumQuantity: '30.000', unitPrice: '9.00' });
    await db.insert(clients).values({ id: clientId, nome: 'Cliente de gerenciamento', email: 'management@example.com', arquivado: false });
    await db.insert(clients).values({ id: secondClientId, nome: 'Segundo cliente de gerenciamento', email: 'management-second@example.com', arquivado: false });
    const create = createPostgresQuoteDraftRepository(() => db, { now: () => new Date('2026-07-01T12:00:00.000Z') });
    const draft = await create.createDraft({ client_id: clientId, items: [{ item_code: sku, qty: '30.000' }] });
    const createLater = createPostgresQuoteDraftRepository(() => db, { now: () => new Date('2026-07-02T12:00:00.000Z') });
    const laterDraft = await createLater.createDraft({ client_id: clientId, items: [{ item_code: sku, qty: '30.000' }] });
    const terminalDraft = await createLater.createDraft({ client_id: clientId, items: [{ item_code: sku, qty: '30.000' }] });
    const pendingDraft = await createLater.createDraft({ client_id: clientId, items: [{ item_code: sku, qty: '30.000' }] });
    assert.equal(draft.validade_dias, explicitSettings.validadeDias);
    assert.equal(draft.pagamento, explicitSettings.pagamento);
    assert.equal(draft.entrega, explicitSettings.entrega);
    assert.equal(draft.frete, explicitSettings.fretePadrao);
    assert.equal(draft.observacoes, explicitSettings.observacoes);
    const defaultTemplate = getQuotationTemplateManifest().find((template) => template.is_default)!;
    assert.equal(draft.template_padrao, defaultTemplate.key);
    assert.equal(draft.template_key, defaultTemplate.key);
    assert.equal(draft.template_hash, defaultTemplate.hash);
    assert.equal(draft.secoes.pagamento.current.body, explicitSettings.quotationSections.pagamento.body);
    assert.notEqual(draft.secoes, explicitSettings.quotationSections);
    const alternateDraft = await create.createDraft({
      client_id: clientId,
      template_key: 'minimalista',
      items: [{ item_code: sku, qty: '30.000' }],
    });
    assert.equal(alternateDraft.template_key, 'minimalista');
    assert.match(alternateDraft.template_version_id, /^[0-9a-f-]{36}$/);
    const overrideDraft = await create.createDraft({
      client_id: clientId,
      template_key: 'minimalista',
      secoes: {
        pagamento: { body: 'Override' },
      },
      items: [{ item_code: sku, qty: '30.000' }],
    });
    assert.equal(overrideDraft.secoes.pagamento.base.body, explicitSettings.quotationSections.pagamento.body);
    assert.equal(overrideDraft.secoes.pagamento.current.body, 'Override');
    assert.equal(overrideDraft.secoes.pagamento.current.enabled, false);
    assert.equal(overrideDraft.secoes.pagamento.current.title, 'Título de pagamento configurado');
    assert.deepEqual(overrideDraft.secoes.condicoes_gerais.current, explicitSettings.quotationSections.condicoes_gerais);
    assert.deepEqual(overrideDraft.secoes.prazo_producao.current, explicitSettings.quotationSections.prazo_producao);
    overrideDraft.secoes.pagamento.current.body = 'Mutado';
    assert.equal(overrideDraft.secoes.pagamento.base.body, explicitSettings.quotationSections.pagamento.body);
    const [createdRevision] = await db.select().from(quoteRevisions).where(eq(quoteRevisions.id, draft.revision_id));
    assert.equal(createdRevision?.templatePadrao, defaultTemplate.key);
    assert.equal(createdRevision?.templateHash, defaultTemplate.hash);
    const management = createPostgresQuoteDraftManagementRepository(() => db, { now: () => new Date('2026-07-04T12:01:00.000Z') });
    const managementGet = management.get!;
    const managementUpdate = management.update!;
    const managementList = management.list!;
    const before = await managementGet(draft.quotation_name);
    assert.ok(before);
    const laterBefore = await managementGet(laterDraft.quotation_name);
    const [minimalVersion] = await db
      .select({ id: quotationTemplateVersions.id })
      .from(quotationTemplateVersions)
      .innerJoin(quotationTemplates, eq(quotationTemplateVersions.templateId, quotationTemplates.id))
      .where(eq(quotationTemplates.key, 'minimalista'))
      .limit(1);
    assert.ok(minimalVersion);
    await assert.rejects(
      () => managementUpdate(draft.quotation_name, {
        concurrency_token: before.concurrency_token,
        template_key: defaultTemplate.key,
        template_version_id: minimalVersion.id,
        items: [{ item_code: sku, qty: '30.000' }],
      }),
      (error: unknown) => error instanceof Error && error.name === 'QuoteManagementInputError',
    );
    const [defaultTemplateState] = await db
      .select({ archived: quotationTemplates.archived })
      .from(quotationTemplates)
      .where(eq(quotationTemplates.key, defaultTemplate.key))
      .limit(1);
    await db.update(quotationTemplates).set({ archived: true }).where(eq(quotationTemplates.key, defaultTemplate.key));
    try {
      const archivedCurrentBefore = await managementGet(draft.quotation_name);
      assert.ok(archivedCurrentBefore);
      const archivedCurrentSaved = await managementUpdate(draft.quotation_name, {
        concurrency_token: archivedCurrentBefore.concurrency_token,
        items: [{ item_code: sku, qty: '30.000' }],
      });
      assert.equal(archivedCurrentSaved.template_key, defaultTemplate.key);
      assert.equal(archivedCurrentSaved.template_version_id, draft.template_version_id);
    } finally {
      await db.update(quotationTemplates).set({ archived: defaultTemplateState?.archived ?? false }).where(eq(quotationTemplates.key, defaultTemplate.key));
    }
    const [minimalTemplate] = await db
      .select({ archived: quotationTemplates.archived })
      .from(quotationTemplates)
      .where(eq(quotationTemplates.key, 'minimalista'))
      .limit(1);
    const currentBeforeMinimal = await managementGet(draft.quotation_name);
    assert.ok(currentBeforeMinimal);
    await db.update(quotationTemplates).set({ archived: true }).where(eq(quotationTemplates.key, 'minimalista'));
    try {
      await assert.rejects(
        () => managementUpdate(draft.quotation_name, {
          concurrency_token: currentBeforeMinimal.concurrency_token,
          template_key: 'minimalista',
          items: [{ item_code: sku, qty: '30.000' }],
        }),
        (error: unknown) => error instanceof Error && error.name === 'QuoteManagementInputError',
      );
    } finally {
      await db.update(quotationTemplates).set({ archived: minimalTemplate?.archived ?? false }).where(eq(quotationTemplates.key, 'minimalista'));
    }
    await db
      .update(quoteRevisions)
      .set({ templateVersionId: null })
      .where(eq(quoteRevisions.id, alternateDraft.revision_id));
    const legacyFallbackBefore = await managementGet(alternateDraft.quotation_name);
    assert.ok(legacyFallbackBefore);
    await db.update(quotationTemplates).set({ archived: true }).where(eq(quotationTemplates.key, 'minimalista'));
    try {
      await assert.rejects(
        () => managementUpdate(alternateDraft.quotation_name, {
          concurrency_token: legacyFallbackBefore.concurrency_token,
          items: [{ item_code: sku, qty: '30.000' }],
        }),
        (error: unknown) => error instanceof QuoteManagementInputError,
      );
    } finally {
      await db.update(quotationTemplates).set({ archived: minimalTemplate?.archived ?? false }).where(eq(quotationTemplates.key, 'minimalista'));
    }
    assert.ok(laterBefore);
    assert.equal(before.frete_padrao, explicitSettings.fretePadrao);
    assert.equal(before.pagamento, explicitSettings.pagamento);
    assert.equal(before.items[0].suggested_unit_price, '9.00');
    const currentBeforeMalformed = await managementGet(draft.quotation_name);
    assert.ok(currentBeforeMalformed);
    for (const malformedBase of [null, 'invalid', []]) {
      await assert.rejects(
        () => managementUpdate(draft.quotation_name, {
          concurrency_token: currentBeforeMalformed.concurrency_token,
          secoes: { base: malformedBase },
          items: [{ item_code: sku, qty: '30.000' }],
        }),
        (error: unknown) => error instanceof Error && error.name === 'QuoteManagementInputError',
      );
    }
    const storedBase = JSON.parse(JSON.stringify(laterBefore.secoes));
    const longPagamento = 'P'.repeat(4000);
    const sectionOverride = await managementUpdate(laterDraft.quotation_name, {
      concurrency_token: laterBefore.concurrency_token,
      items: [{ item_code: sku, qty: '30.000' }],
      pagamento: longPagamento,
      entrega: 'Legacy entrega',
      observacoes: 'Legacy observações',
      secoes: {
        pagamento: { enabled: true, title: 'Pagamento', body: 'Seção pagamento' },
        condicoes_gerais: { enabled: true, title: 'Condições', body: 'Seção condição' },
        prazo_producao: { enabled: false, title: 'Prazo de produção' },
      },
    });
    assert.equal(sectionOverride.pagamento, longPagamento);
    assert.equal(sectionOverride.observacoes, 'Legacy observações');
    assert.equal(sectionOverride.entrega, 'Legacy entrega');
    assert.equal(sectionOverride.secoes?.pagamento.current.body, longPagamento);
    assert.equal(sectionOverride.secoes?.condicoes_gerais.current.body, 'Legacy observações');
    assert.equal(sectionOverride.prazo_producao, '');
    assert.ok(sectionOverride.secoes);
    assert.deepEqual(sectionOverride.secoes.prazo_producao.base, storedBase.prazo_producao.base);
    assert.deepEqual(sectionOverride.secoes.pagamento.base, storedBase.pagamento.base);
    assert.equal(sectionOverride.secoes.prazo_producao.current.enabled, false);
    assert.ok(sectionOverride.secoes);
    const restored = await managementUpdate(laterDraft.quotation_name, {
      concurrency_token: sectionOverride.concurrency_token,
      items: [{ item_code: sku, qty: '30.000' }],
      secoes: {
        current: {
          pagamento: sectionOverride.secoes.pagamento.base,
          condicoes_gerais: sectionOverride.secoes.condicoes_gerais.base,
          prazo_producao: sectionOverride.secoes.prazo_producao.base,
        },
      },
    });
    assert.ok(restored.secoes);
    assert.deepEqual(restored.secoes.pagamento.current, restored.secoes.pagamento.base);
    assert.deepEqual(restored.secoes.condicoes_gerais.current, restored.secoes.condicoes_gerais.base);
    const currentBeforeUpdate = await managementGet(draft.quotation_name);
    assert.ok(currentBeforeUpdate);
    const updated = await managementUpdate(draft.quotation_name, {
      concurrency_token: currentBeforeUpdate.concurrency_token,
      client_id: secondClientId,
      items: [{ item_code: sku, qty: '30.000', rate: '10.00', manual_rate: true }],
      validade_dias: 1,
      pagamento: '30 dias',
      entrega: '10 dias',
      frete: '1.25',
      observacoes: 'Alterado',
      prazo_producao: '5 dias',
      template_key: 'minimalista',
    });
    assert.equal(updated.validade_dias, 1);
    assert.equal(updated.items[0].suggested_unit_price, '9.00');
    assert.equal(updated.items[0].applied_unit_price, '10.00');
    assert.equal(updated.items[0].price_difference, '1.00');
    assert.equal(updated.subtotal, '300.00');
    assert.equal(updated.total, '301.25');
    assert.equal(updated.client_id, secondClientId);
    assert.equal((updated.cliente_snapshot as { nome?: string }).nome, 'Segundo cliente de gerenciamento');
    const alternateTemplate = getQuotationTemplate('minimalista')!;
    assert.equal(updated.template_key, alternateTemplate.key);
    assert.equal(updated.template_hash, alternateTemplate.hash);
    assert.notEqual(updated.concurrency_token, currentBeforeUpdate.concurrency_token);
    assert.ok(updated.updated_at > laterBefore.updated_at);

    const ownIds = new Set([draft.quotation_name, laterDraft.quotation_name]);
    const ownOrder = async (orderBy?: string) => {
      const listed = await managementList({ limit: 200, orderBy, search: 'Cliente de gerenciamento' });
      return listed.rows.filter((row) => ownIds.has(row.id)).map((row) => row.id);
    };
    assert.deepEqual(await ownOrder(), [laterDraft.quotation_name, draft.quotation_name]);
    assert.deepEqual(await ownOrder('creation desc'), [laterDraft.quotation_name, draft.quotation_name]);
    assert.deepEqual(await ownOrder('creation asc'), [draft.quotation_name, laterDraft.quotation_name]);
    assert.deepEqual(await ownOrder('transaction_date desc'), [laterDraft.quotation_name, draft.quotation_name]);
    assert.deepEqual(await ownOrder('transaction_date asc'), [draft.quotation_name, laterDraft.quotation_name]);
    assert.deepEqual(await ownOrder('valid_till asc'), [draft.quotation_name, laterDraft.quotation_name]);
    assert.deepEqual(await ownOrder('valid_till desc'), [laterDraft.quotation_name, draft.quotation_name]);

    await assert.rejects(
      () => managementUpdate(draft.quotation_name, { concurrency_token: currentBeforeUpdate.concurrency_token, items: [{ item_code: sku, qty: '1.000' }] }),
      (error: unknown) => error instanceof QuoteManagementConflictError,
    );
    await db.update(quotations).set({ status: 'enviado' }).where(eq(quotations.id, updated.quotation_uuid));
    await db.update(quoteRevisions).set({ status: 'enviado' }).where(eq(quoteRevisions.id, updated.revision_id));
    await db.update(quotations).set({ status: 'aprovado' }).where(eq(quotations.id, laterDraft.quotation_uuid));
    await db.update(quoteRevisions).set({ status: 'aprovado' }).where(eq(quoteRevisions.id, laterDraft.revision_id));
    await db.update(quotations).set({ status: 'perdido' }).where(eq(quotations.id, terminalDraft.quotation_uuid));
    await db.update(quoteRevisions).set({ status: 'perdido' }).where(eq(quoteRevisions.id, terminalDraft.revision_id));
    const assertTerminalUpdateRejected = async (quotationName: string) => {
      const terminalDetail = await managementGet(quotationName);
      assert.ok(terminalDetail);
      await assert.rejects(
        () => managementUpdate(quotationName, {
          concurrency_token: terminalDetail.concurrency_token,
          items: [{ item_code: sku, qty: '1.000' }],
        }),
        (error: unknown) => error instanceof QuoteManagementConflictError,
      );
    };
    await assertTerminalUpdateRejected(updated.quotation_name);
    await assertTerminalUpdateRejected(laterDraft.quotation_name);
    await assertTerminalUpdateRejected(terminalDraft.quotation_name);
    const assertStatusAliases = async (aliases: string[], quotationId: string, canonical: string) => {
      for (const alias of aliases) {
        const listed = await managementList({ status: alias, limit: 200 });
        const row = listed.rows.find((candidate) => candidate.id === quotationId);
        assert.ok(row, `status filter ${alias} should include ${quotationId}`);
        assert.equal(row.status_canonical, canonical, `status filter ${alias} should map to ${canonical}`);
        assert.ok(listed.total >= 1, `status filter ${alias} should not be empty`);
      }
    };
    await assertStatusAliases(['Draft', 'Rascunho', 'rascunho', ' dRaFt ', ' RASCUNHO '], pendingDraft.quotation_name, 'rascunho');
    await assertStatusAliases(['Issued', 'Open', 'Replied', 'Expired', 'emitido', 'Enviado', 'enviado', ' oPeN ', ' ENVIADO ', ' iSsUeD '], updated.quotation_name, 'enviado');
    await assertStatusAliases(['Ordered', 'Aprovado', 'aprovado', ' OrDeReD ', ' APROVADO '], laterDraft.quotation_name, 'aprovado');
    await assertStatusAliases(['Lost', 'Cancelled', 'Perdido', 'perdido', ' cAnCeLLeD ', ' PERDIDO '], terminalDraft.quotation_name, 'perdido');
    const statusSummary = (await managementList({ limit: 200 })).statusSummary;
    assert.ok(statusSummary.Rascunho >= 1);
    assert.ok(statusSummary.Enviado >= 1);
    assert.ok(statusSummary.Aprovado >= 1);
    assert.ok(statusSummary.Perdido >= 1);
    const [product] = await db.select().from(products).where(eq(products.sku, sku));
    const [tier] = await db.select().from(productPricingTiers).where(eq(productPricingTiers.productSku, sku));
    const [settingsAfter] = await db.select().from(appSettings).where(eq(appSettings.singletonId, 1));
    assert.equal(product?.precoBase, '12.00');
    assert.equal(tier?.unitPrice, '9.00');
    assert.equal(settingsAfter?.validadeDias, explicitSettings.validadeDias);
    assert.equal(settingsAfter?.pagamento, explicitSettings.pagamento);
    assert.equal(settingsAfter?.entrega, explicitSettings.entrega);
    assert.equal(settingsAfter?.fretePadrao, explicitSettings.fretePadrao);
    assert.equal(settingsAfter?.observacoes, explicitSettings.observacoes);
    assert.equal(settingsAfter?.templatePadrao, explicitSettings.templatePadrao);
    const [quotation] = await db.select().from(quotations).where(eq(quotations.id, updated.quotation_uuid));
    assert.equal(quotation?.clientId, secondClientId);
    const [revision] = await db.select().from(quoteRevisions).where(eq(quoteRevisions.id, updated.revision_id));
    const [item] = await db.select().from(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, updated.revision_id));
    assert.equal(revision?.observacoes, 'Alterado');
    assert.equal(revision?.clienteNome, 'Segundo cliente de gerenciamento');
    assert.equal(revision?.clienteEmail, 'management-second@example.com');
    assert.equal(item?.precoAplicado, '10.00');

    const snapshotRepository = createQuotationTemplateRepository(() => db);
    const beforeSnapshot = await snapshotRepository.get(updated.quotation_name);
    assert.ok(beforeSnapshot);
    const beforeHtml = renderQuotationTemplate(alternateTemplate, quotationSnapshotViewModel(beforeSnapshot));
    await db.update(products).set({ nome: 'Produto alterado depois' }).where(eq(products.sku, sku));
    await db.update(clients).set({ nome: 'Cliente alterado depois' }).where(eq(clients.id, secondClientId));
    await db.update(appSettings).set({ templatePadrao: 'minimalista' }).where(eq(appSettings.singletonId, 1));
    const afterSnapshot = await snapshotRepository.get(updated.quotation_name);
    assert.ok(afterSnapshot);
    const afterHtml = renderQuotationTemplate(alternateTemplate, quotationSnapshotViewModel(afterSnapshot));
    assert.equal(afterHtml, beforeHtml);
  } finally {
    const rows = await db.select({ id: quotations.id }).from(quotations).where(inArray(quotations.clientId, [clientId, secondClientId]));
    if (rows.length) await db.delete(quotations).where(inArray(quotations.id, rows.map((row) => row.id)));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(clients).where(eq(clients.id, secondClientId));
    await db.delete(products).where(eq(products.sku, sku));
    if (previousSettings) {
      await db.update(appSettings).set({
        validadeDias: previousSettings.validadeDias,
        pagamento: previousSettings.pagamento,
        entrega: previousSettings.entrega,
        fretePadrao: previousSettings.fretePadrao,
        observacoes: previousSettings.observacoes,
        quotationSections: previousSettings.quotationSections,
        templatePadrao: previousSettings.templatePadrao,
      }).where(eq(appSettings.singletonId, 1));
    } else {
      await db.delete(appSettings).where(eq(appSettings.singletonId, 1));
    }
    await client.end({ timeout: 5 });
  }
});
