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
} from '../../api/_db/quote-draft-management-repository.js';
import { appSettings, clients, productPricingTiers, products, quoteRevisionItems, quoteRevisions, quotations } from '../../api/_db/schema.js';
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
    templatePadrao: 'template-configurado',
  };
  let previousSettings: typeof appSettings.$inferSelect | undefined;
  try {
    await migrate(db, { migrationsFolder });
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
    assert.equal(draft.validade_dias, explicitSettings.validadeDias);
    assert.equal(draft.pagamento, explicitSettings.pagamento);
    assert.equal(draft.entrega, explicitSettings.entrega);
    assert.equal(draft.frete, explicitSettings.fretePadrao);
    assert.equal(draft.observacoes, explicitSettings.observacoes);
    assert.equal(draft.template_padrao, explicitSettings.templatePadrao);
    const management = createPostgresQuoteDraftManagementRepository(() => db, { now: () => new Date('2026-07-04T12:01:00.000Z') });
    const before = await management.get(draft.quotation_name);
    assert.ok(before);
    const laterBefore = await management.get(laterDraft.quotation_name);
    assert.ok(laterBefore);
    assert.equal(before.frete_padrao, explicitSettings.fretePadrao);
    assert.equal(before.pagamento, explicitSettings.pagamento);
    assert.equal(before.items[0].suggested_unit_price, '9.00');
    const updated = await management.update(draft.quotation_name, {
      concurrency_token: before.concurrency_token,
      client_id: secondClientId,
      items: [{ item_code: sku, qty: '30.000', rate: '10.00', manual_rate: true }],
      validade_dias: 1,
      pagamento: '30 dias',
      entrega: '10 dias',
      frete: '1.25',
      observacoes: 'Alterado',
      prazo_producao: '5 dias',
    });
    assert.equal(updated.validade_dias, 1);
    assert.equal(updated.items[0].suggested_unit_price, '9.00');
    assert.equal(updated.items[0].applied_unit_price, '10.00');
    assert.equal(updated.items[0].price_difference, '1.00');
    assert.equal(updated.subtotal, '300.00');
    assert.equal(updated.total, '301.25');
    assert.equal(updated.client_id, secondClientId);
    assert.equal((updated.cliente_snapshot as { nome?: string }).nome, 'Segundo cliente de gerenciamento');
    assert.notEqual(updated.concurrency_token, before.concurrency_token);
    assert.ok(updated.updated_at > laterBefore.updated_at);

    const ownIds = new Set([draft.quotation_name, laterDraft.quotation_name]);
    const ownOrder = async (orderBy?: string) => {
      const listed = await management.list({ limit: 200, orderBy });
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
      () => management.update(draft.quotation_name, { concurrency_token: before.concurrency_token, items: [{ item_code: sku, qty: '1.000' }] }),
      (error: unknown) => error instanceof QuoteManagementConflictError,
    );
    await db.update(quotations).set({ status: 'Open' }).where(eq(quotations.id, updated.quotation_uuid));
    await assert.rejects(
      () => management.update(draft.quotation_name, { concurrency_token: updated.concurrency_token, items: [{ item_code: sku, qty: '1.000' }] }),
      (error: unknown) => error instanceof QuoteManagementConflictError,
    );
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
        templatePadrao: previousSettings.templatePadrao,
      }).where(eq(appSettings.singletonId, 1));
    } else {
      await db.delete(appSettings).where(eq(appSettings.singletonId, 1));
    }
    await client.end({ timeout: 5 });
  }
});
