// @ts-check
import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';
import { withCanonicalQuotationDetail } from './fixtures/quotation-detail.js';

const CORE_ID = 'ORC-20260042';
const CORE_REVISION_ID = '22222222-2222-4222-8222-222222222242';
const CORE_NEXT_REVISION_ID = '22222222-2222-4222-8222-222222222243';
const CORE_TOKEN = 'a'.repeat(40);

function coreDetail(overrides = {}) {
  const revision = overrides.revision ?? overrides.revision_number ?? 1;
  return withCanonicalQuotationDetail({
    id: CORE_ID,
    quotation_id: CORE_ID,
    quotation_name: CORE_ID,
    quotation_uuid: '11111111-1111-4111-8111-111111111142',
    revision_id: CORE_REVISION_ID,
    revision,
    revision_number: revision,
    status: 'Enviado',
    status_canonical: 'emitido',
    cliente: 'Cliente PostgreSQL Cutover',
    client_id: '33333333-3333-4333-8333-333333333342',
    cliente_snapshot: { id: '33333333-3333-4333-8333-333333333342', nome: 'Cliente PostgreSQL Cutover' },
    validade_dias: 15,
    validade: '2026-08-23',
    data: '2026-08-08',
    pagamento: 'À vista',
    entrega: '10 dias',
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: 'Revisão original',
    prazo_producao: '3 dias',
    template_key: 'padrao',
    template_hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e',
    template_version_id: null,
    template_version: null,
    secoes: {
      schema_version: 1,
      prazo_producao: {
        base: { enabled: true, title: 'Prazo de produção' },
        current: { enabled: true, title: 'Prazo de produção' },
      },
      pagamento: {
        base: { enabled: true, title: 'Pagamento', body: 'À vista' },
        current: { enabled: true, title: 'Pagamento', body: 'À vista' },
      },
      condicoes_gerais: {
        base: { enabled: true, title: 'Condições Gerais', body: '10 dias' },
        current: { enabled: true, title: 'Condições Gerais', body: '10 dias' },
      },
    },
    subtotal: '90.00',
    total: '90.00',
    valor: '90.00',
    derived_expired: false,
    expiration_derived: false,
    is_expired: false,
    expirada: false,
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
      subtotal: '90.00',
      total: '90.00',
      valor: '90.00',
      status: 'Enviado',
      status_canonical: 'emitido',
      template_key: 'padrao',
      template_version: 1,
      template_hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e',
      derived_expired: false,
      expiration_derived: false,
      is_expired: false,
      expirada: false,
    }],
    ...overrides,
  });
}

test('cotação PostgreSQL mantém revisão, PDF, link público e erro sanitizado @quotations @database @critical', async ({ page }) => {
  const requests = [];
  let authoritative = coreDetail();
  const tokens = new Set();
  page.on('request', (request) => requests.push(request.url()));

  await page.context().route('**/api/settings**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: CORE_ID, cliente: authoritative.cliente, valor: authoritative.total, status: authoritative.status }], pagination: { page: 1, limit: 10, total: 1, total_pages: 1 } }) });
  });
  await page.context().route('**/api/quotation-preview**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'X-Document-Revision': CORE_REVISION_ID },
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-1.7\\n%%EOF'),
    });
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
  await expect(page.getByRole('heading', { name: CORE_ID })).toBeVisible();
  await expect(page.getByText('Emitido', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Revisão 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Produto PostgreSQL')).toBeVisible();

  const pdfPopupPromise = page.waitForEvent('popup');
  const pdfResponsePromise = page.context().waitForEvent('response', { predicate: (response) => response.url().includes('/api/quotation-preview') && response.url().includes('format=pdf') });
  await page.getByRole('button', { name: 'Visualizar PDF', exact: true }).click();
  const [pdfPopup, pdfResponse] = await Promise.all([pdfPopupPromise, pdfResponsePromise]);
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
  expect(pdfResponse.headers()['x-document-revision']).toBe(CORE_REVISION_ID);
  await pdfPopup.close();

  const pdfResult = await page.evaluate(async () => {
    const response = await globalThis.fetch('/api/quotation-preview?id=ORC-20260042&format=pdf');
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      revision: response.headers.get('x-document-revision'),
      head: Array.from(bytes.slice(0, 5)),
      tail: Array.from(bytes.slice(-5)),
    };
  });
  expect(pdfResult.status).toBe(200);
  expect(pdfResult.contentType).toContain('application/pdf');
  expect(pdfResult.revision).toBe(CORE_REVISION_ID);
  expect(String.fromCharCode(...pdfResult.head)).toBe('%PDF-');
  expect(String.fromCharCode(...pdfResult.tail)).toBe('%%EOF');

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
  expect(expired.body).not.toMatch(/EXTERNAL_API_TOKEN|stack|secret/i);

  const sanitizedError = await page.evaluate(async () => {
    const response = await globalThis.fetch('/api/public-quotation?token=error');
    return { status: response.status, body: await response.text() };
  });
  expect(sanitizedError.status).toBe(503);
  expect(sanitizedError.body).toContain('Erro ao processar orçamento. Tente novamente.');
  expect(sanitizedError.body).not.toMatch(/EXTERNAL_API_TOKEN|stack|secret|\/home\//i);

  await page.getByText('Histórico e revisões').click();
  await page.getByRole('button', { name: 'Nova revisão' }).click();
  await expect(page.getByText('Nova revisão criada em rascunho.')).toBeVisible();
  await expect(page.getByText('Revisão 2')).toBeVisible();
  expect(authoritative.revision_id).toBe(CORE_NEXT_REVISION_ID);
  expect(requests.some((url) => /\/api\/send-whatsapp/i.test(url))).toBe(false);
  expect(requests.filter((url) => url.includes('/api/view'))).toEqual([]);
});
