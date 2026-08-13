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

  test('seleciona o modelo padrão retornado pela API', async ({ page }) => {
    await page.goto('/#/manual');
    await expect(page.getByLabel('Modelo HTML')).toBeVisible();
    await expect(page.getByLabel('Modelo HTML')).toHaveValue('padrao');
    await expect(page.getByLabel('Modelo HTML').locator('option')).toHaveText(['Padrão Aspen', 'Minimalista']);
  });

  test('falha ao carregar modelos mantém formulário utilizável e permite retry', async ({ page }) => {
    let templateAttempts = 0;
    await page.route('**/api/quotation-templates**', async (route) => {
      templateAttempts += 1;
      await route.fulfill(templateAttempts === 1
        ? { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'indisponível' }) }
        : { status: 200, contentType: 'application/json', body: JSON.stringify(TEMPLATE_MANIFEST) });
    });

    await page.goto('/#/manual');
    await expect(page.getByText('Não foi possível carregar os modelos HTML.')).toBeVisible();
    await expect(page.getByLabel('Nome do cliente')).toBeVisible();
    await expect(page.getByLabel('Buscar produto para adicionar ao orçamento')).toBeEnabled();
    await expect(page.getByLabel('Prazo de produção')).toBeEnabled();

    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByLabel('Modelo HTML')).toBeEnabled();
    await expect(page.getByLabel('Modelo HTML')).toHaveValue('padrao');
    expect(templateAttempts).toBeGreaterThanOrEqual(2);
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
        }),
      });
    });
    await page.route('**/api/pricing-lookup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [{ item_code: PRODUCT.sku, qty: 30, rate: '9.00' }] }),
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

  test('envia o mesmo preço exibido para o fluxo local com sinal não manual', async ({ page }) => {
    /** @type {any} */
    let quoteRequest;

    await page.route('**/api/leads-clients**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [CLIENT] }),
      });
    });
    await page.route('**/api/products**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [PRODUCT] }),
      });
    });
    await page.route('**/api/pricing-lookup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [{ item_code: PRODUCT.sku, qty: 30, rate: '9.00' }] }),
      });
    });
    await page.route('**/api/orcamento', async (route) => {
      quoteRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          quotation_id: 'ORC-LOCAL-0001',
          quote_id: 'quote-local-0001',
          revision_id: 'revision-local-0001',
          cliente: CLIENT.nome,
          items: [{ sku: PRODUCT.sku, qty: 30, rate: 9 }],
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

    await expect(page.getByText('Rascunho persistido com sucesso')).toBeVisible();
    await expect(page.getByText(/ORC-LOCAL-0001/)).toBeVisible();
    expect(quoteRequest?.extracted?.items?.[0]?.rate).toBe(9);
    expect(quoteRequest?.extracted?.items?.[0]?.manual_rate).toBe(false);
  });
});
