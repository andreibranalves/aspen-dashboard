import { expect, test } from '@playwright/test';

const id = 'ORC-20260012';
const token = '2026-07-01T12:00:00.000Z';
const hash = 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e';

function detail(overrides = {}) {
  return {
    id,
    quotation_id: id,
    quotation_uuid: '11111111-1111-4111-8111-111111111111',
    revision_id: '22222222-2222-4222-8222-222222222222',
    revision_number: 1,
    status: 'Enviado',
    status_canonical: 'enviado',
    cliente: 'Cliente lifecycle',
    client_id: '33333333-3333-4333-8333-333333333333',
    validade_dias: 15,
    validade: '2026-07-16',
    data: '2026-07-01',
    pagamento: 'À vista',
    entrega: '10 dias',
    frete: '0.00',
    observacoes: '',
    prazo_producao: '',
    template_padrao: 'padrao',
    template_key: 'padrao',
    template_hash: hash,
    template_version_id: '55555555-5555-4555-8555-555555555555',
    template_version: 1,
    secoes: {
      schema_version: 1,
      prazo_producao: { base: { enabled: true, title: 'Prazo de produção' }, current: { enabled: true, title: 'Prazo de produção' } },
      pagamento: { base: { enabled: true, title: 'Pagamento', body: 'À vista' }, current: { enabled: true, title: 'Pagamento', body: 'À vista' } },
      condicoes_gerais: { base: { enabled: true, title: 'Condições Gerais', body: '' }, current: { enabled: true, title: 'Condições Gerais', body: '' } },
    },
    subtotal: '90.00',
    total: '90.00',
    valor: '90.00',
    concurrency_token: token,
    updated_at: token,
    items: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        sku: 'SKU-1',
        item_code: 'SKU-1',
        nome: 'Produto lifecycle',
        item_name: 'Produto lifecycle',
        qty: '10.000',
        suggested_unit_price: '9.00',
        applied_unit_price: '9.00',
        price_difference: '0.00',
        line_total: '90.00',
        manual_rate: false,
      },
    ],
    revision_history: [
      {
        id: 'stored-document-id-must-not-be-used',
        revision_id: '22222222-2222-4222-8222-222222222222',
        revision: 1,
        revision_number: 1,
        created_at: token,
        createdAt: token,
        validade_dias: 15,
        validity_date: '2026-07-16',
        validade: '2026-07-16',
        subtotal: '90.00',
        total: '90.00',
        valor: '90.00',
        status: 'Enviado',
        status_canonical: 'enviado',
        template_key: 'padrao',
        template_version: 1,
        template_hash: hash,
        derived_expired: false,
        expiration_derived: false,
        is_expired: false,
        expirada: false,
      },
    ],
    core_mode: true,
    source: 'postgres',
    ...overrides,
  };
}

async function routeTemplates(page) {
  await page.route('**/api/settings**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ operational_mode: false }),
    });
  });

  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        templates: [{ key: 'padrao', name: 'Padrão', is_default: true, hash }],
      }),
    });
  });
}

test('core quotation detail accepts JSON-string section snapshots from PostgreSQL', async ({ page }) => {
  await page.route('**/api/settings**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ operational_mode: false }),
    });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ templates: [{ key: 'padrao', name: 'Padrão', is_default: true, hash }] }),
    });
  });
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail({ secoes: JSON.stringify(detail().secoes) })),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Enviado', { exact: true }).first()).toBeVisible();
  const itemRow = page.locator('tr').filter({ hasText: 'Produto lifecycle' }).first();
  await expect(itemRow.getByText('10', { exact: true })).toBeVisible();
  await expect(itemRow.getByText('10.000', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Título - Pagamento')).toBeDisabled();
});

test('core lifecycle emission forwards the concurrency token', async ({ page }) => {
  let authoritative = detail({ status: 'Rascunho', status_canonical: 'rascunho' });
  let postPayload;
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authoritative),
      });
      return;
    }
    if (request.method() === 'POST') {
      postPayload = request.postDataJSON();
      const validEmission =
        postPayload.action === 'set_status' &&
        postPayload.status === 'enviado' &&
        postPayload.concurrency_token === token;
      if (validEmission) authoritative = detail({ status: 'Enviado', status_canonical: 'enviado' });
      await route.fulfill({
        status: validEmission ? 200 : 400,
        contentType: 'application/json',
        body: JSON.stringify(validEmission ? authoritative : { error: 'Token de concorrência obrigatório.' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await routeTemplates(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Rascunho', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toHaveCount(0);
  expect(postPayload).toMatchObject({
    action: 'set_status',
    status: 'enviado',
    concurrency_token: token,
  });
});

test('core lifecycle marks sent quotations and creates a revision from issued history', async ({
  page,
}) => {
  let authoritative = detail();
  const posts = [];
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authoritative),
      });
      return;
    }
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      posts.push(payload);
      if (payload.action === 'set_status')
        authoritative = detail({
          status: 'Aprovado',
          status_canonical: 'aprovado',
          revision_history: [
            detail().revision_history[0] && {
              ...detail().revision_history[0],
              status: 'Aprovado',
              status_canonical: 'aprovado',
            },
          ],
        });
      if (payload.action === 'create_revision')
        authoritative = detail({
          status: 'Rascunho',
          status_canonical: 'rascunho',
          revision_number: 2,
          revision: 2,
          revision_id: '66666666-6666-4666-8666-666666666666',
          revision_history: [
            { ...detail().revision_history[0] },
            {
              ...detail().revision_history[0],
              id: '66666666-6666-4666-8666-666666666666',
              revision_id: '66666666-6666-4666-8666-666666666666',
              revision: 2,
              revision_number: 2,
              status: 'Rascunho',
              status_canonical: 'rascunho',
            },
          ],
        });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authoritative),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, total_pages: 0 },
        core_mode: true,
        source: 'postgres',
      }),
    });
  });
  await routeTemplates(page);
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Enviado', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Título - Pagamento')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  const modelPreview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Visualizar modelo' }).click();
  const modelPopup = await modelPreview;
  const modelUrl = new globalThis.URL(modelPopup.url());
  expect(modelUrl.pathname).toBe('/api/quotation-preview');
  expect(modelUrl.searchParams.get('id')).toBe(id);
  expect(modelUrl.searchParams.has('template_version_id')).toBe(false);
  expect(modelUrl.searchParams.has('template')).toBe(false);
  await modelPopup.close();
  const pdfPreview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  const pdfPopup = await pdfPreview;
  const pdfUrl = new globalThis.URL(pdfPopup.url());
  expect(pdfUrl.pathname).toBe('/api/quotation-preview');
  expect(pdfUrl.searchParams.get('id')).toBe(id);
  expect(pdfUrl.searchParams.get('format')).toBe('pdf');
  expect(pdfUrl.searchParams.has('template_version_id')).toBe(false);
  expect(pdfUrl.searchParams.has('template')).toBe(false);
  await pdfPopup.close();
  const historyPreview = page.waitForEvent('popup');
  await page.locator('tbody tr').filter({ hasText: 'R1' }).getByRole('button', { name: 'Visualizar', exact: true }).click();
  const historyPopup = await historyPreview;
  const historyUrl = new globalThis.URL(historyPopup.url());
  expect(historyUrl.searchParams.get('id')).toBe('22222222-2222-4222-8222-222222222222');
  await historyPopup.close();
  await page.getByRole('button', { name: 'Marcar como aprovado' }).click();
  await expect(page.getByText('Aprovado', { exact: true }).first()).toBeVisible();
  expect(posts[0]).toMatchObject({
    action: 'set_status',
    status: 'aprovado',
    concurrency_token: token,
  });

  // Re-open the terminal history entry to exercise the revision action.
  authoritative = detail({
    status: 'Aprovado',
    status_canonical: 'aprovado',
    revision_history: [
      detail().revision_history[0] && {
        ...detail().revision_history[0],
        status: 'Aprovado',
        status_canonical: 'aprovado',
      },
    ],
  });
  await page.reload();
  await page.getByRole('button', { name: 'Nova revisão' }).click();
  await expect(page.getByText('Nova revisão criada em rascunho.')).toBeVisible();
  await expect(page.getByText('Rascunho', { exact: true }).first()).toBeVisible();
  expect(posts.at(-1)).toMatchObject({
    action: 'create_revision',
    source_revision_id: '22222222-2222-4222-8222-222222222222',
    concurrency_token: token,
  });
});
