// @ts-check
import { expect, test } from '@playwright/test';

const CLIENT = {
  id: '00000000-0000-4000-8000-000000000101',
  nome: 'Maria Cliente Core',
  email: 'maria@example.com',
  telefone: '5511999990000',
  tipo: 'cliente',
};

const TEMPLATE_MANIFEST = {
  templates: [
    { key: 'padrao', name: 'Padrão Aspen', is_default: true },
    { key: 'minimalista', name: 'Minimalista', is_default: false },
  ],
  default_key: 'padrao',
};

const PRODUCT = {
  sku: 'CORE-QUOTE-001',
  nome: 'Produto para rascunho',
  descricao: 'Produto de teste',
  unidade: 'Und',
  categoria: 'Teste',
  marca: 'Aspen',
  ativo: true,
  pricing_available: true,
  preco_minimo: '9.00',
};

test.describe('Orçamento manual — rascunho core', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/quotation-templates**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TEMPLATE_MANIFEST) });
    });
  });

  test('envia ID do cliente existente e mostra apenas a confirmação do rascunho', async ({ page }) => {
    /** @type {any} */
    let quoteRequest;

    await page.route('**/api/leads-clients**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [CLIENT],
          pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
          core_mode: true,
          source: 'postgres',
        }),
      });
    });
    await page.route('**/api/products**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [PRODUCT],
          pagination: { page: 1, limit: 8, total: 1, total_pages: 1 },
          core_mode: true,
          source: 'postgres',
        }),
      });
    });
    await page.route('**/api/pricing-lookup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [{ item_code: PRODUCT.sku, qty: 30, rate: '9.00' }], core_mode: true, source: 'postgres' }),
      });
    });
    await page.route('**/api/orcamento', async (route) => {
      quoteRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          quotation_id: 'ORC-20260042',
          quotation_name: 'ORC-20260042',
          quote_id: '00000000-0000-4000-8000-000000000201',
          revision_id: '00000000-0000-4000-8000-000000000202',
          revision_number: 1,
          status: 'rascunho',
          cliente: CLIENT.nome,
          items: [],
          subtotal: '270.00',
          frete: '0.00',
          total: '270.00',
          core_mode: true,
          source: 'postgres',
        }),
      });
    });

    await page.goto('/#/manual');
    await page.getByRole('button', { name: 'Buscar cliente existente' }).click();
    await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('Maria');
    await expect(page.getByText(CLIENT.nome, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Selecionar ${CLIENT.nome}` }).click();

    await page.getByRole('region', { name: 'Seleção de cliente' }).getByRole('combobox').selectOption('Google Ads');
    await page.getByRole('textbox', { name: 'Buscar produto para adicionar ao orçamento' }).fill(PRODUCT.sku);
    await expect(page.getByText(PRODUCT.nome)).toBeVisible();
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await expect(page.getByText(PRODUCT.sku, { exact: true }).first()).toBeVisible();
    await page.getByLabel('Modelo HTML').selectOption('minimalista');
    await page.getByRole('button', { name: 'Criar orçamento' }).click();

    await expect(page.getByText('Rascunho persistido com sucesso')).toBeVisible();
    await expect(page.getByText(/ORC-20260042/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Visualizar PDF/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^WhatsApp$/ })).toHaveCount(0);
    expect(quoteRequest?.extracted?.client_id).toBe(CLIENT.id);
    expect(quoteRequest?.extracted?.items?.[0]?.rate).toBe(9);
    expect(quoteRequest?.extracted?.items?.[0]?.manual_rate).toBe(false);
    expect(quoteRequest?.extracted?.template_key).toBe('minimalista');
  });

  test('envia o mesmo preço exibido para o boundary legado com sinal não manual', async ({ page }) => {
    /** @type {any} */
    let quoteRequest;

    await page.route('**/api/leads-clients**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [CLIENT], core_mode: false, source: 'frappe' }),
      });
    });
    await page.route('**/api/products**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [PRODUCT], core_mode: false, source: 'frappe' }),
      });
    });
    await page.route('**/api/pricing-lookup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [{ item_code: PRODUCT.sku, qty: 30, rate: '9.00' }], core_mode: false, source: 'frappe' }),
      });
    });
    await page.route('**/api/orcamento', async (route) => {
      quoteRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          quotation_id: 'ERP-QUOTE-0001',
          deal_id: 'DEAL-0001',
          cliente: CLIENT.nome,
          items: [{ sku: PRODUCT.sku, qty: 30, rate: 9 }],
          core_mode: false,
          source: 'frappe',
        }),
      });
    });

    await page.goto('/#/manual');
    await page.getByRole('button', { name: 'Buscar cliente existente' }).click();
    await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('Maria');
    await expect(page.getByText(CLIENT.nome, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Selecionar ${CLIENT.nome}` }).click();
    await page.getByRole('region', { name: 'Seleção de cliente' }).getByRole('combobox').selectOption('Google Ads');
    await page.getByRole('textbox', { name: 'Buscar produto para adicionar ao orçamento' }).fill(PRODUCT.sku);
    await expect(page.getByText(PRODUCT.nome)).toBeVisible();
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await expect(page.getByText(PRODUCT.sku, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Criar orçamento' }).click();

    await expect(page.getByText('Orçamento criado com sucesso')).toBeVisible();
    await expect(page.getByText(/ERP-QUOTE-0001/)).toBeVisible();
    expect(quoteRequest?.extracted?.items?.[0]?.rate).toBe(9);
    expect(quoteRequest?.extracted?.items?.[0]?.manual_rate).toBe(false);
  });
});
