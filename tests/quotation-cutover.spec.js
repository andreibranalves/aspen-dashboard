// @ts-check
import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';

const CLIENT = {
  id: '00000000-0000-4000-8000-000000000301',
  nome: 'Cliente Legado Cutover',
  email: 'legacy@example.com',
  telefone: '5511999990000',
};
const PRODUCT = {
  sku: 'CUTOVER-001',
  nome: 'Produto legado',
  descricao: 'Produto de teste',
  unidade: 'Und',
  categoria: 'Teste',
  ativo: true,
  pricing_available: true,
  preco_minimo: '9.00',
};

test('cotação legada não oferece link customer-facing /api/view', async ({ page }) => {
  const customerRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/view')) customerRequests.push(request.url());
  });

  await page.route('**/api/settings**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ operational_mode: false }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ templates: [{ key: 'padrao', name: 'Padrão Aspen', is_default: true }] }),
    });
  });
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
      body: JSON.stringify({ success: true, items: [{ item_code: PRODUCT.sku, qty: 30, rate: '9.00' }] }),
    });
  });
  await page.route('**/api/orcamento', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        quotation_id: 'ERP-QUOTE-CUTOVER',
        cliente: CLIENT.nome,
        items: [{ sku: PRODUCT.sku, qty: 30, rate: 9 }],
        core_mode: false,
        source: 'frappe',
      }),
    });
  });

  await page.goto('/#/manual');
  await page.getByRole('button', { name: 'Buscar cliente existente' }).click();
  await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('Cliente');
  await expect(page.getByText(CLIENT.nome, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Selecionar ${CLIENT.nome}` }).click();
  await page.getByRole('region', { name: 'Seleção de cliente' }).getByRole('combobox').selectOption('Google Ads');
  await page.getByRole('textbox', { name: 'Buscar produto para adicionar ao orçamento' }).fill(PRODUCT.sku);
  await expect(page.getByText(PRODUCT.nome)).toBeVisible();
  await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
  await page.getByRole('button', { name: 'Criar orçamento' }).click();

  await expect(page.getByText('Orçamento criado com sucesso')).toBeVisible();
  await expect(page.getByText('Link público indisponível para esta cotação legada.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^WhatsApp$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /link público/i })).toHaveCount(0);
  expect(customerRequests).toEqual([]);
});

const CORE_ID = 'ORC-20260042';
const CORE_REVISION_ID = '22222222-2222-4222-8222-222222222242';
const CORE_NEXT_REVISION_ID = '22222222-2222-4222-8222-222222222243';
const CORE_TOKEN = 'a'.repeat(40);

function coreDetail(overrides = {}) {
  return {
    id: CORE_ID,
    quotation_id: CORE_ID,
    quotation_uuid: '11111111-1111-4111-8111-111111111142',
    revision_id: CORE_REVISION_ID,
    revision_number: 1,
    status: 'Enviado',
    status_canonical: 'enviado',
    cliente: 'Cliente PostgreSQL Cutover',
    validade_dias: 15,
    validade: '2026-08-23',
    data: '2026-08-08',
    pagamento: 'À vista',
    entrega: '10 dias',
    frete: '0.00',
    observacoes: 'Revisão original',
    prazo_producao: '3 dias',
    subtotal: '90.00',
    total: '90.00',
    valor: '90.00',
    concurrency_token: '2026-08-08T12:00:00.000Z',
    updated_at: '2026-08-08T12:00:00.000Z',
    items: [{
      id: '44444444-4444-4444-8444-444444444442',
      sku: 'CORE-CUTOVER-001',
      item_code: 'CORE-CUTOVER-001',
      nome: 'Produto PostgreSQL',
      item_name: 'Produto PostgreSQL',
      qty: '10.000',
      suggested_unit_price: '9.00',
      applied_unit_price: '9.00',
      price_difference: '0.00',
      line_total: '90.00',
      manual_rate: false,
    }],
    revision_history: [{
      id: CORE_REVISION_ID,
      revision_id: CORE_REVISION_ID,
      revision: 1,
      revision_number: 1,
      created_at: '2026-08-08T12:00:00.000Z',
      createdAt: '2026-08-08T12:00:00.000Z',
      validade_dias: 15,
      validade: '2026-08-23',
      total: '90.00',
      valor: '90.00',
      status: 'Enviado',
      status_canonical: 'enviado',
      template_key: 'padrao',
      template_version: 1,
      template_hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e',
      derived_expired: false,
    }],
    core_mode: true,
    source: 'postgres',
    ...overrides,
  };
}

test('cotação PostgreSQL mantém revisão, PDF, link público e erro sanitizado', async ({ page }) => {
  const requests = [];
  let authoritative = coreDetail();
  const tokens = new Set();
  page.on('request', (request) => requests.push(request.url()));

  await page.context().route('**/api/settings**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ operational_mode: false }) });
  });
  await page.context().route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [{ key: 'padrao', name: 'Padrão', is_default: true, hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e' }] }) });
  });
  await page.context().route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'create_revision') {
      authoritative = coreDetail({
        revision_id: CORE_NEXT_REVISION_ID,
        revision_number: 2,
        status: 'Rascunho',
        status_canonical: 'rascunho',
        revision_history: [authoritative.revision_history[0], {
          ...authoritative.revision_history[0],
          id: CORE_NEXT_REVISION_ID,
          revision_id: CORE_NEXT_REVISION_ID,
          revision: 2,
          revision_number: 2,
          status: 'Rascunho',
          status_canonical: 'rascunho',
        }],
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: CORE_ID, cliente: authoritative.cliente, valor: authoritative.total, status: authoritative.status }], pagination: { page: 1, limit: 10, total: 1, total_pages: 1 }, core_mode: true, source: 'postgres' }) });
  });
  await page.context().route('**/api/quotation-preview**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.7\\n%%EOF') });
  });
  await page.context().route('**/api/public-quotation**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const token = CORE_TOKEN;
      tokens.add(token);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ token, revisionId: authoritative.revision_id, expiresAt: '2026-08-15T12:00:00.000Z' }) });
      return;
    }
    const url = new globalThis.URL(request.url());
    const token = url.searchParams.get('token');
    if (request.method() === 'DELETE') {
      tokens.delete(token);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (token === 'error') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Erro ao processar orçamento. Tente novamente.' }) });
      return;
    }
    if (token === 'expired') {
      await route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ error: 'Link público expirado.' }) });
      return;
    }
    await route.fulfill({ status: tokens.has(token) ? 200 : 404, contentType: 'text/html', body: '<html><body>Cliente PostgreSQL Cutover</body></html>' });
  });
  await page.context().route('**/api/view**', async () => { throw new Error('Customer-facing path must not request /api/view'); });

  await page.goto(`/#/quotations/${CORE_ID}`);
  await expect(page.getByText(CORE_ID, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Enviado', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Revisão 1')).toBeVisible();
  await expect(page.getByText('Produto PostgreSQL')).toBeVisible();

  const pdfPopupPromise = page.waitForEvent('popup');
  const pdfRequestPromise = page.context().waitForEvent('request', { predicate: (request) => request.url().includes('/api/quotation-preview') && request.url().includes('format=pdf') });
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  const [pdfPopup, pdfRequest] = await Promise.all([pdfPopupPromise, pdfRequestPromise]);
  expect(new globalThis.URL(pdfRequest.url()).pathname).toBe('/api/quotation-preview');
  await pdfPopup.close();

  const publicResult = await page.evaluate(async () => {
    const issued = await globalThis.fetch('/api/public-quotation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revisionId: '22222222-2222-4222-8222-222222222242' }) });
    const issuedBody = await issued.json();
    const view = await globalThis.fetch(`/api/public-quotation?token=${issuedBody.token}`);
    return { issued: issued.status, viewed: view.status, body: await view.text() };
  });
  expect(publicResult.issued).toBe(201);
  expect(publicResult.viewed).toBe(200);
  expect(publicResult.body).toContain('Cliente PostgreSQL Cutover');
  expect(publicResult.body).not.toContain('/api/view');

  const expired = await page.evaluate(async () => {
    const response = await globalThis.fetch('/api/public-quotation?token=expired');
    return { status: response.status, body: await response.text() };
  });
  expect(expired.status).toBe(410);
  expect(expired.body).not.toMatch(/ERPNEXT_TOKEN|stack|secret/i);

  const sanitizedError = await page.evaluate(async () => {
    const response = await globalThis.fetch('/api/public-quotation?token=error');
    return { status: response.status, body: await response.text() };
  });
  expect(sanitizedError.status).toBe(503);
  expect(sanitizedError.body).toContain('Erro ao processar orçamento. Tente novamente.');
  expect(sanitizedError.body).not.toMatch(/ERPNEXT_TOKEN|stack|secret|\/home\//i);

  await page.getByRole('button', { name: 'Nova revisão' }).click();
  await expect(page.getByText('Nova revisão criada em rascunho.')).toBeVisible();
  await expect(page.getByText('Revisão 2')).toBeVisible();
  expect(authoritative.revision_id).toBe(CORE_NEXT_REVISION_ID);
  expect(requests.some((url) => /n8n|evolution|\/api\/send-whatsapp/i.test(url))).toBe(false);
  expect(requests.filter((url) => url.includes('/api/view'))).toEqual([]);
});
