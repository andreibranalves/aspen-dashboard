import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../api/_infrastructure/db/schema.js';
import { appSettings, crmDeals, products } from '../api/_infrastructure/db/schema.js';
import { createPostgresQuoteLeadRepository } from '../api/_infrastructure/db/repositories/quote-leads-repository.js';
import { createPostgresQuoteDraftRepository } from '../api/_infrastructure/db/repositories/quote-repository.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../api/_modules/quotation-template-catalog.js';
import { requireMatchingDisposableTestDatabaseUrl } from './support/disposable-postgres.js';

const suffix = randomUUID().slice(0, 8);
const leadName = `Origem UI ${suffix}`;
const sku = `UI-ORIGIN-${suffix}`;
let missingQuotation = '';
let conflictQuotation = '';

test.beforeAll(async () => {
  const databaseUrl = requireMatchingDisposableTestDatabaseUrl(process.env);
  const client = postgres(databaseUrl, { max: 2, prepare: false });
  const db = drizzle(client, { schema });
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.resolve(here, '..', 'drizzle') });
  await db.insert(appSettings).values({
    singletonId: 1,
    templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key,
  }).onConflictDoUpdate({
    target: appSettings.singletonId,
    set: { templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key },
  });
  await db.insert(products).values({
    sku,
    nome: `Produto origem UI ${suffix}`,
    descricao: 'Fixture sintética #203',
    unidade: 'Und',
    precoBase: '12.00',
    ativo: true,
  });
  const repository = createPostgresQuoteLeadRepository(() => db, {
    now: () => new Date('2026-09-05T12:00:00.000Z'),
  });
  const mainLead = await repository.ingestSiteSubmission({
    externalId: `siteQuote.${randomUUID()}`,
    payloadFingerprint: 'c'.repeat(64),
    originalCreatedAt: '2026-09-05T11:59:00.000Z',
    nome: leadName,
    email: `ui-${suffix}@example.test`,
    whatsapp: '5511999992222',
    produto: 'Produto origem UI',
    quantidade: '30',
    consent: { given: true, source: 'site_quote_form' },
  });
  const quoteRepository = createPostgresQuoteDraftRepository(() => db, {
    now: () => new Date('2026-09-05T13:00:00.000Z'),
  });
  await quoteRepository.createDraft({
    quoteLeadId: mainLead.id,
    crmDealId: mainLead.crmDealId,
    nome: `${leadName} anterior`,
    items: [{ item_code: sku, qty: '1.000' }],
  });
  const missing = await quoteRepository.createDraft({
    nome: `Origem ausente UI ${suffix}`,
    items: [{ item_code: sku, qty: '1.000' }],
  });
  missingQuotation = missing.quotation_id;
  const conflictingLead = await repository.ingestSiteSubmission({
    externalId: `siteQuote.${randomUUID()}`,
    payloadFingerprint: 'd'.repeat(64),
    originalCreatedAt: '2026-09-05T12:01:00.000Z',
    nome: `Origem conflitante UI ${suffix}`,
    email: `ui-${suffix}@example.test`,
    whatsapp: '5511999992222',
    produto: 'Produto origem UI',
    quantidade: '30',
    consent: { given: true, source: 'site_quote_form' },
  });
  const conflict = await quoteRepository.createDraft({
    quoteLeadId: conflictingLead.id,
    crmDealId: conflictingLead.crmDealId,
    nome: `Origem conflitante UI ${suffix}`,
    items: [{ item_code: sku, qty: '1.000' }],
  });
  conflictQuotation = conflict.quotation_id;
  await db
    .update(crmDeals)
    .set({ quoteLeadId: mainLead.id })
    .where(eq(crmDeals.id, conflictingLead.crmDealId));
  await client.end({ timeout: 5 });
});

test('opportunity creates quotation whose origin remains visible through approval and order @smoke', async ({ page }) => {
  await page.goto(`/#/crm?search=${encodeURIComponent(leadName)}`);
  const card = page.getByRole('article', { name: new RegExp(`Negócio ${leadName}`) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Novo orçamento' }).click();

  await expect(page.getByRole('heading', { name: 'Novo orçamento' })).toBeVisible();
  await expect(page.getByText('Origem: Formulário do site')).toBeVisible();
  await expect(page.getByLabel('Nome do cliente')).toHaveValue(leadName);
  await page.getByLabel('Origem *').selectOption('Google Ads');
  await page.getByLabel('Buscar produto para adicionar ao orçamento').fill(sku);
  await page.getByRole('button', { name: `Adicionar ${sku} ao orçamento` }).click();
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();

  await expect(page.getByText('Rascunho salvo')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir orçamento' }).click();
  await expect(page.getByLabel('Origem do orçamento')).toContainText('Formulário do site');

  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Emitir', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aprovar e criar pedido' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Aprovar e criar pedido' }).click();
  await expect(page.getByText(/Pedido PED-\d{4}-\d{4} criado\./)).toBeVisible();
  await page.getByRole('button', { name: /Abrir pedido/ }).click();

  await expect(page.getByRole('heading', { name: 'Pedido' })).toBeVisible();
  await expect(page.getByText('Formulário do site')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir orçamento de origem' }).click();
  await expect(page.getByLabel('Origem do orçamento')).toContainText('Formulário do site');
});

test('restoring a manual draft without hash parameters preserves its direct origin', async ({ page }) => {
  await page.goto(`/#/crm?search=${encodeURIComponent(leadName)}`);
  const card = page.getByRole('article', { name: new RegExp(`Negócio ${leadName}`) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Novo orçamento' }).click();

  await expect(page.getByText('Origem: Formulário do site')).toBeVisible();
  await page.getByLabel('Origem *').selectOption('Google Ads');
  await page.getByLabel('Buscar produto para adicionar ao orçamento').fill(sku);
  await page.getByRole('button', { name: `Adicionar ${sku} ao orçamento` }).click();
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.localStorage.getItem('aspen_manual_draft')))).toBe(true);

  await page.goto('/#/manual');
  await page.getByRole('dialog').getByRole('button', { name: 'Sair da página' }).click();
  await page.reload();
  await expect(page.getByText('Origem: Formulário do site')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();

  await expect(page.getByText('Rascunho salvo')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir orçamento' }).click();
  await expect(page.getByLabel('Origem do orçamento')).toContainText('Formulário do site');
});

test('quotation detail distinguishes missing and conflicting historical origins', async ({ page }) => {
  await page.goto(`/#/quotations/${missingQuotation}`);
  await expect(page.getByLabel('Origem do orçamento')).toContainText('Origem ausente');

  await page.goto(`/#/quotations/${conflictQuotation}`);
  await expect(page.getByLabel('Origem do orçamento')).toContainText('Origem conflitante');
});
