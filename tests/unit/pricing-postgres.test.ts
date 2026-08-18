import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

import { createPostgresPricingRepository } from '../../api/_db/pricing-repository.js';
import { createPostgresProductCatalogRepository } from '../../api/_db/product-catalog-repository.js';
import { createPostgresProductsRepository } from '../../api/_db/products-repository.js';
import { productActivityEvents, productPricingTiers, products } from '../../api/_db/schema.js';
import { resolveProductPrice } from '../../api/modules/pricing-core.js';
import * as schema from '../../api/_db/schema.js';
import { createCoreHandler as createProductsCoreHandler } from '../../api/modules/products-core.js';
import { createCoreHandler as createProductUpdateCoreHandler } from '../../api/modules/product-update-core.js';

const TEST_DATABASE_URL = process.env.TEST_PRICING_DATABASE_URL || process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

function event(method: string, body: unknown, query: Record<string, string> = {}) {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: query,
  } as any;
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, any>;
}

test('PostgreSQL pricing persists exact numerics, rejects duplicates and replaces atomically', { skip: !TEST_DATABASE_URL }, async () => {
  const client = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const sku = `TEST-PRICING-${Date.now()}`;
  const createFailureSku = `${sku}-CREATE`;
  const updateFailureSku = `${sku}-UPDATE`;
  const catalogOrderSku = `${sku}-ORDER`;
  const emptyPricingSku = `${sku}-EMPTY`;
  const archiveSku = `${sku}-ARCHIVE`;
  const productsRepository = createPostgresProductsRepository(() => db);
  const pricingRepository = createPostgresPricingRepository(() => db);

  try {
    await migrate(db, { migrationsFolder });
    await productsRepository.create({ sku, nome: 'Produto de teste de preço' });

    const saved = await pricingRepository.replace(sku, {
      preco_base: '12.30',
      precos: [
        { minimum_quantity: '30.000', unit_price: '10.00' },
        { minimum_quantity: '100.125', unit_price: '8.75' },
      ],
    });
    assert.equal(saved.preco_base, '12.30');
    assert.deepEqual(saved.precos.map((row) => [row.minimum_quantity, row.unit_price]), [
      ['30.000', '10.00'],
      ['100.125', '8.75'],
    ]);
    assert.equal(resolveProductPrice(saved, '100.125').rate, '8.75');
    assert.equal(resolveProductPrice(saved, '100.124').rate, '10.00');
    const activityRows = () => db
      .select()
      .from(productActivityEvents)
      .where(eq(productActivityEvents.productSku, sku));
    assert.equal((await activityRows()).filter((row) => row.tipo === 'preco').length, 1);

    await assert.rejects(
      () => pricingRepository.replace(sku, {
        preco_base: '12.30',
        precos: [
          { minimum_quantity: '30', unit_price: '10.00' },
          { minimum_quantity: '30.000', unit_price: '9.00' },
        ],
      }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    );

    const catalogRepository = createPostgresProductCatalogRepository(() => db);
    const productsCore = createProductsCoreHandler({
      repository: productsRepository,
      pricingRepository,
      catalogRepository,
    });
    const updateCore = createProductUpdateCoreHandler({
      repository: productsRepository,
      pricingRepository,
      catalogRepository,
    });

    await productsRepository.create({ sku: updateFailureSku, nome: 'Atualização original' });
    await pricingRepository.replace(updateFailureSku, {
      preco_base: '20.00',
      precos: [{ minimum_quantity: '30', unit_price: '18.00' }],
    });
    await client.unsafe(`
      CREATE OR REPLACE FUNCTION pricing_test_fail_tier_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pricing trigger test'; END; $$;
      CREATE TRIGGER pricing_test_fail_tier_insert_trigger
      BEFORE INSERT ON product_pricing_tiers FOR EACH ROW
      EXECUTE FUNCTION pricing_test_fail_tier_insert();
    `);
    try {
      const failedCreate = await productsCore(event('POST', {
        sku: createFailureSku,
        nome: 'Criação deve reverter',
        preco_base: '15.00',
        precos: [{ minimum_quantity: '30', unit_price: '12.00' }],
      }));
      assert.equal(failedCreate.statusCode, 503);
      assert.equal(await productsRepository.get(createFailureSku), null);
      assert.equal((await db.select().from(productActivityEvents).where(eq(productActivityEvents.productSku, createFailureSku))).length, 0);

      const failedUpdate = await updateCore(event('PATCH', {
        nome: 'Não deve persistir',
        preco_base: '11.00',
        precos: [{ minimum_quantity: '30', unit_price: '9.00' }, { minimum_quantity: '100', unit_price: '7.00' }],
      }, { sku: updateFailureSku }));
      assert.equal(failedUpdate.statusCode, 503);
      assert.equal((await productsRepository.get(updateFailureSku))?.nome, 'Atualização original');
      const unchangedPricing = await pricingRepository.get(updateFailureSku);
      assert.equal(unchangedPricing?.preco_base, '20.00');
      assert.deepEqual(unchangedPricing?.precos.map((row) => [row.minimum_quantity, row.unit_price]), [['30.000', '18.00']]);
      assert.equal(parse(failedUpdate).source, undefined);
      assert.equal((await db.select().from(productActivityEvents).where(eq(productActivityEvents.productSku, updateFailureSku))).filter((row) => row.tipo === 'preco').length, 1);
    } finally {
      await client.unsafe('DROP TRIGGER IF EXISTS pricing_test_fail_tier_insert_trigger ON product_pricing_tiers');
      await client.unsafe('DROP FUNCTION IF EXISTS pricing_test_fail_tier_insert()');
    }

    await pricingRepository.replace(sku, {
      preco_base: '20.00',
      precos: [{ minimum_quantity: '1.500', unit_price: '19.00' }],
    });
    const replaced = await pricingRepository.get(sku);
    assert.equal(replaced?.preco_base, '20.00');
    assert.deepEqual(replaced?.precos.map((row) => row.minimum_quantity), ['1.500']);

    await pricingRepository.replace(sku, { preco_base: null, precos: [] });
    const emptied = await pricingRepository.get(sku);
    assert.equal(emptied?.preco_base, null);
    assert.deepEqual(emptied?.precos, []);
    assert.equal(emptied?.pricing_available, false);

    const beforeRapidUpdates = (await activityRows()).filter((row) => row.tipo === 'preco');
    await pricingRepository.replace(sku, { preco_base: '21.00', precos: [] });
    await pricingRepository.replace(sku, { preco_base: '22.00', precos: [] });
    const afterRapidUpdates = (await activityRows()).filter((row) => row.tipo === 'preco');
    assert.equal(afterRapidUpdates.length, beforeRapidUpdates.length + 2);
    assert.equal(new Set(afterRapidUpdates.map((row) => row.referenceId)).size, afterRapidUpdates.length);
    await pricingRepository.replace(sku, { preco_base: '22.00', precos: [] });
    assert.equal((await activityRows()).filter((row) => row.tipo === 'preco').length, afterRapidUpdates.length);

    await catalogRepository.create(
      { sku: catalogOrderSku, nome: 'Produto com faixas reordenadas' },
      {
        preco_base: '30.00',
        precos: [
          { minimum_quantity: '100', unit_price: '20.00' },
          { minimum_quantity: '30', unit_price: '25.00' },
        ],
      },
    );
    const catalogActivitiesBeforeReorder = await db
      .select()
      .from(productActivityEvents)
      .where(eq(productActivityEvents.productSku, catalogOrderSku));
    await db.transaction(async (tx) => {
      const tiers = await tx
        .select()
        .from(productPricingTiers)
        .where(eq(productPricingTiers.productSku, catalogOrderSku));
      await tx.delete(productPricingTiers).where(eq(productPricingTiers.productSku, catalogOrderSku));
      await tx.insert(productPricingTiers).values([...tiers].reverse().map((tier) => ({
        productSku: tier.productSku,
        minimumQuantity: tier.minimumQuantity,
        unitPrice: tier.unitPrice,
        criadoEm: tier.criadoEm,
        atualizadoEm: tier.atualizadoEm,
      })));
    });
    await catalogRepository.update(catalogOrderSku, {}, {
      preco_base: '30.00',
      precos: [
        { minimum_quantity: '30', unit_price: '25.00' },
        { minimum_quantity: '100', unit_price: '20.00' },
      ],
    });
    const catalogActivitiesAfterReorder = await db
      .select()
      .from(productActivityEvents)
      .where(eq(productActivityEvents.productSku, catalogOrderSku));
    assert.equal(catalogActivitiesAfterReorder.length, catalogActivitiesBeforeReorder.length);
    const catalogProductEventsBeforeRapid = catalogActivitiesAfterReorder.filter((row) => row.tipo === 'produto');
    await catalogRepository.update(catalogOrderSku, { nome: 'Produto reordenado A' });
    await catalogRepository.update(catalogOrderSku, { nome: 'Produto reordenado B' });
    const catalogProductEventsAfterRapid = (await db
      .select()
      .from(productActivityEvents)
      .where(eq(productActivityEvents.productSku, catalogOrderSku))).filter((row) => row.tipo === 'produto');
    assert.equal(catalogProductEventsAfterRapid.length, catalogProductEventsBeforeRapid.length + 2);
    assert.equal(new Set(catalogProductEventsAfterRapid.map((row) => row.referenceId)).size, catalogProductEventsAfterRapid.length);
    await catalogRepository.update(catalogOrderSku, { nome: 'Produto reordenado B' });
    assert.equal((await db
      .select()
      .from(productActivityEvents)
      .where(eq(productActivityEvents.productSku, catalogOrderSku))).filter((row) => row.tipo === 'produto').length, catalogProductEventsAfterRapid.length);

    await catalogRepository.create({ sku: emptyPricingSku, nome: 'Produto sem preço' }, {
      preco_base: null,
      precos: [],
    });
    const emptyPricingActivities = await db
      .select()
      .from(productActivityEvents)
      .where(eq(productActivityEvents.productSku, emptyPricingSku));
    assert.deepEqual(emptyPricingActivities.map((row) => row.texto), ['Produto criado']);

    const archiveCreate = await productsCore(event('POST', { sku: archiveSku, nome: 'Produto arquivável' }));
    assert.equal(archiveCreate.statusCode, 201);
    const hardDelete = await productsCore(event('DELETE', undefined, { id: archiveSku, permanent: 'true' }));
    assert.equal(hardDelete.statusCode, 409);
    const archive = await productsCore(event('DELETE', undefined, { id: archiveSku }));
    assert.equal(archive.statusCode, 200);
    assert.equal((await productsRepository.get(archiveSku))?.ativo, false);
    const archiveAgain = await productsCore(event('DELETE', undefined, { id: archiveSku }));
    assert.equal(archiveAgain.statusCode, 200);
    const archiveActivities = await db
      .select()
      .from(productActivityEvents)
      .where(eq(productActivityEvents.productSku, archiveSku));
    assert.equal(archiveActivities.filter((row) => row.texto === 'Produto arquivado').length, 1);
    await assert.rejects(() => db.delete(products).where(eq(products.sku, archiveSku)));

    await assert.rejects(
      () => db.insert(productPricingTiers).values([
        { productSku: sku, minimumQuantity: '2.000', unitPrice: '1.00' },
        { productSku: sku, minimumQuantity: '2.000', unitPrice: '0.90' },
      ]),
      (error: unknown) => {
        let current = error as { cause?: unknown; code?: unknown } | null;
        for (let depth = 0; depth < 4 && current; depth += 1) {
          if (current.code === '23505') return true;
          current = current.cause as typeof current;
        }
        return false;
      },
    );
  } finally {
    for (const cleanupSku of [sku, createFailureSku, updateFailureSku, catalogOrderSku, emptyPricingSku, archiveSku]) {
      await db.delete(productActivityEvents).where(eq(productActivityEvents.productSku, cleanupSku)).catch(() => undefined);
      await db.delete(productPricingTiers).where(eq(productPricingTiers.productSku, cleanupSku)).catch(() => undefined);
      await db.delete(products).where(eq(products.sku, cleanupSku)).catch(() => undefined);
    }
    await client.end({ timeout: 5 });
  }
});
