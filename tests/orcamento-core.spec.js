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

test.describe('Orçamento manual — rascunho core @quotations @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/quotation-templates**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TEMPLATE_MANIFEST) });
    });
  });

  test('seleciona o modelo padrão retornado pela API', async ({ page }) => {
    await page.goto('/#/manual');
    await expect(page.getByLabel('Modelo de orçamento')).toBeVisible();
    await expect(page.getByLabel('Modelo de orçamento')).toHaveValue('padrao');
    await expect(page.getByLabel('Modelo de orçamento').locator('option')).toHaveText(['Padrão Aspen', 'Minimalista']);
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
    await expect(page.getByText('Não foi possível carregar os modelos de orçamento.')).toBeVisible();
    await expect(page.getByLabel('Nome do cliente')).toBeVisible();
    await expect(page.getByLabel('Buscar produto para adicionar ao orçamento')).toBeEnabled();
    await expect(page.getByLabel('Prazo de produção')).toBeEnabled();

    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByLabel('Modelo de orçamento')).toBeEnabled();
    await expect(page.getByLabel('Modelo de orçamento')).toHaveValue('padrao');
    expect(templateAttempts).toBeGreaterThanOrEqual(2);
  });

  test('envia ID do cliente existente e navega ao detalhe após salvar', async ({ page }) => {
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
          concurrency_token: '2026-09-05T11:59:00.000Z',
          revision_number: 1,
          status: 'rascunho',
          cliente: CLIENT.nome,
          items: [{
            item_code: PRODUCT.sku,
            qty: '30',
            nome: PRODUCT.nome,
            applied_unit_price: '9.00',
            manual_rate: false,
          }],
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
    await page.getByRole('button', { name: 'Aplicar ao rascunho' }).click();

    await page.getByRole('region', { name: 'Seleção de cliente' }).getByRole('combobox').selectOption('Google Ads');
    await page.getByRole('textbox', { name: 'Buscar produto para adicionar ao orçamento' }).fill(PRODUCT.sku);
    await expect(page.getByText(PRODUCT.nome)).toBeVisible();
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await expect(page.getByText(PRODUCT.sku, { exact: true }).first()).toBeVisible();
    await page.getByLabel('Modelo de orçamento').selectOption('minimalista');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();

    await expect(page).toHaveURL(/#\/quotations\/00000000-0000-4000-8000-000000000201$/);
    await expect(page.getByRole('link', { name: /Visualizar PDF/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^WhatsApp$/ })).toHaveCount(0);
    expect(quoteRequest?.extracted?.client_id).toBe(CLIENT.id);
    expect(quoteRequest?.extracted?.items?.[0]?.rate).toBe(9);
    expect(quoteRequest?.extracted?.items?.[0]?.manual_rate).toBe(false);
    expect(quoteRequest?.extracted?.template_key).toBe('minimalista');
  });

  test('usa a Origem padrão e confirma emissão sem disparar transporte', async ({ page }) => {
    const quotationUuid = '00000000-0000-4000-8000-000000000301';
    const revisionId = '00000000-0000-4000-8000-000000000302';
    const concurrencyToken = '2026-09-05T12:00:00.000Z';
    /** @type {any} */
    let issueRequest;
    let releaseIssue;
    const issueGate = new Promise((resolve) => { releaseIssue = resolve; });
    let transportRequests = 0;

    page.on('request', (request) => {
      if (request.url().includes('/api/send-whatsapp-flow')) transportRequests += 1;
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
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          quotation_id: 'ORC-20260043',
          quotation_uuid: quotationUuid,
          revision_id: revisionId,
          revision_number: 1,
          concurrency_token: concurrencyToken,
          status: 'rascunho',
          items: [{
            item_code: PRODUCT.sku,
            qty: '30',
            nome: PRODUCT.nome,
            applied_unit_price: '9.00',
            manual_rate: false,
          }],
          frete: '0.00',
          total: '270.00',
        }),
      });
    });
    await page.route('**/api/quotation-issues', async (route) => {
      issueRequest = route.request().postDataJSON();
      await issueGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          quotationId: quotationUuid,
          businessNumber: 'ORC-20260043',
          revisionId,
          revisionNumber: 1,
          status: 'emitido',
          issuedAt: '2026-09-05T12:00:01.000Z',
          validUntil: '2026-09-20',
          pdfUrl: `/api/quotation-preview?id=${revisionId}&format=pdf`,
        }),
      });
    });

    await page.goto('/#/manual');
    await expect(page.getByText('Informe o cliente e adicione ao menos um item para continuar.', { exact: true })).toBeVisible();
    await page.getByLabel('Nome do cliente').fill('Cliente emissão');
    await expect(page.getByText('Adicione ao menos um item para continuar.', { exact: true })).toBeVisible();
    await page.getByLabel('Buscar produto para adicionar ao orçamento').fill(PRODUCT.sku);
    await expect(page.getByText(PRODUCT.nome)).toBeVisible();
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();

    await expect(page.getByLabel('Origem *', { exact: true })).toHaveValue('Google Ads');
    await expect(page.getByRole('button', { name: 'Salvar rascunho' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeEnabled();

    await page.getByRole('button', { name: 'Emitir orçamento' }).click();
    await expect.poll(() => issueRequest).toEqual({
      revision_id: revisionId,
      concurrency_token: concurrencyToken,
    });
    const issueButton = page.getByRole('button', { name: 'Emitir orçamento' });
    await expect(issueButton).toContainText('Emitindo…');
    await expect(issueButton).toBeDisabled();
    releaseIssue();

    await expect(page).toHaveURL(new RegExp(`#/quotations/${quotationUuid}$`));
    await expect(page.getByText(/Orçamento enviado/i)).toHaveCount(0);
    expect(transportRequests).toBe(0);
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
          concurrency_token: '2026-09-05T11:59:00.000Z',
          cliente: CLIENT.nome,
          items: [{
            item_code: PRODUCT.sku,
            qty: '30',
            nome: PRODUCT.nome,
            applied_unit_price: '9.00',
            manual_rate: false,
          }],
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
    await page.getByRole('button', { name: 'Aplicar ao rascunho' }).click();
    await page.getByRole('region', { name: 'Seleção de cliente' }).getByRole('combobox').selectOption('Google Ads');
    await page.getByRole('textbox', { name: 'Buscar produto para adicionar ao orçamento' }).fill(PRODUCT.sku);
    await expect(page.getByText(PRODUCT.nome)).toBeVisible();
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await expect(page.getByText(PRODUCT.sku, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();

    await expect(page).toHaveURL(/#\/quotations\/quote-local-0001$/);
    expect(quoteRequest?.extracted?.items?.[0]?.rate).toBe(9);
    expect(quoteRequest?.extracted?.items?.[0]?.manual_rate).toBe(false);
  });
});
