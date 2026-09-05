import { expect, test } from '@playwright/test';
import { withCanonicalQuotationDetail } from './fixtures/quotation-detail.js';

const id = 'ORC-20260001';
const token = '2026-07-01T12:00:00.000Z';

function coreDetail(overrides = {}) {
  return withCanonicalQuotationDetail({
    id,
    quotation_id: id,
    quotation_name: id,
    quotation_uuid: '11111111-1111-4111-8111-111111111111',
    revision_id: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    revision_number: 1,
    status: 'Draft',
    status_canonical: 'rascunho',
    cliente: 'Cliente core',
    client_id: '33333333-3333-4333-8333-333333333333',
    cliente_snapshot: { id: '33333333-3333-4333-8333-333333333333', nome: 'Cliente core' },
    validade_dias: 15,
    validade: '2026-07-16',
    data: '2026-07-01',
    pagamento: 'À vista',
    entrega: '10 dias',
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: '',
    prazo_producao: '',
    template_padrao: 'padrao',
    template_key: 'padrao',
    template_hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e',
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
    revision_history: [],
    derived_expired: false,
    expiration_derived: false,
    is_expired: false,
    expirada: false,
    concurrency_token: token,
    updated_at: token,
    items: [{ id: '44444444-4444-4444-8444-444444444444', sku: 'SKU-1', item_code: 'SKU-1', nome: 'Produto core', item_name: 'Produto core', qty: '10.000', suggested_unit_price: '9.00', applied_unit_price: '9.00', price_difference: '0.00', line_total: '90.00', manual_rate: false }],
    ...overrides,
  });
}

const manifest = {
  templates: [
    { key: 'padrao', name: 'Padrão Aspen', is_default: true, hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e', current_version_id: '55555555-5555-4555-8555-555555555555', current_version: 1 },
    { key: 'minimalista', name: 'Minimalista', is_default: false, hash: 'c7060a7faa1f54d08d6f2c237f96cef261c57de5259fb7b755a1dd844bce8c8a', current_version_id: '77777777-7777-4777-8777-777777777777', current_version: 2 },
    { key: 'arquivado', name: 'Arquivado', is_default: false, archived: true, hash: 'archived-hash', current_version_id: '88888888-8888-4888-8888-888888888888', current_version: 3 },
  ],
};

test('core UI selects/previews a repository template and saves template_key @quotations', async ({ page }) => {
  let authoritative = coreDetail();
  let lastPayload;
  const previewPayloads = [];
  const posts = [];
  page.context().on('request', (request) => {
    if (!request.url().includes('/api/quotation-preview') || request.method() !== 'POST') return;
    const encoded = new globalThis.URLSearchParams(request.postData() || '').get('payload');
    if (encoded) previewPayloads.push(JSON.parse(encoded));
  });
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      return;
    }
    if (request.method() === 'PUT') {
      lastPayload = request.postDataJSON();
      const authoritativeSections = JSON.parse(JSON.stringify(lastPayload.secoes));
      authoritativeSections.pagamento.current.title = 'Título confirmado pelo servidor';
      authoritative = coreDetail({
        template_key: lastPayload.template_key,
        template_padrao: lastPayload.template_key,
        template_version_id: '99999999-9999-4999-8999-999999999999',
        secoes: authoritativeSections,
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 } }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.route('**/api/quotation-preview**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html><body>preview</body></html>' });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByLabel('Modelo do orçamento')).toBeVisible();
  await page.getByLabel('Modelo do orçamento').selectOption('minimalista');
  expect(posts.filter((payload) => payload.action === 'create_revision')).toHaveLength(0);
  const preview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Pré-visualizar' }).click();
  const popup = await preview;
  await expect(popup).toHaveURL(/\/api\/quotation-preview\?format=html/);
  await popup.close();
  expect(previewPayloads[0].extracted).toMatchObject({
    template_key: 'minimalista',
    template_version_id: '77777777-7777-4777-8777-777777777777',
  });

  await expect(page.getByText('Prazo de produção', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Prazo de produção do orçamento')).toBeEditable();
  for (const name of [/Prazo de produção/, /Dados para pagamento/, /Condições gerais/]) {
    await expect(page.getByRole('switch', { name })).toBeEditable();
    await expect(page.getByRole('switch', { name })).toBeChecked();
  }
  for (const label of ['Título da seção Prazo de produção', 'Título da seção Dados para pagamento', 'Título da seção Condições gerais'])
    await expect(page.getByLabel(label)).toBeEditable();
  await expect(page.getByLabel('Título da seção Dados para pagamento')).toBeEditable();
  await expect(page.getByLabel('Condição de pagamento')).toBeEditable();
  await expect(page.getByRole('textbox', { name: 'Condições gerais', exact: true })).toBeEditable();
  await page.getByLabel('Título da seção Dados para pagamento').fill('Pagamento personalizado');
  await page.getByRole('switch', { name: /Prazo de produção/ }).uncheck();
  await expect(page.getByLabel('Título da seção Dados para pagamento')).toHaveValue('Pagamento personalizado');
  await page.getByLabel('Título da seção Dados para pagamento').fill('Pagamento');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Orçamento salvo.')).toBeVisible();
  expect(lastPayload.template_key).toBe('minimalista');
  expect(lastPayload.template_version_id).toBe('77777777-7777-4777-8777-777777777777');
  expect(lastPayload.pagamento).toBeUndefined();
  expect(lastPayload.observacoes).toBeUndefined();
  expect(lastPayload.secoes).toEqual(expect.objectContaining({
    schema_version: 1,
    pagamento: expect.objectContaining({
      current: expect.objectContaining({ title: 'Pagamento', body: 'À vista' }),
    }),
  }));
  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByLabel('Título da seção Dados para pagamento')).toHaveValue('Título confirmado pelo servidor');
  await expect(page.getByRole('switch', { name: /Prazo de produção/ })).not.toBeChecked();
  const refreshedPreview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Pré-visualizar' }).click();
  const refreshedPopup = await refreshedPreview;
  await expect(refreshedPopup).toHaveURL(new RegExp('template_version_id=99999999-9999-4999-8999-999999999999'));
  await refreshedPopup.close();
});

test('draft preview uses the unsaved canonical section patch without saving @quotations', async ({ page }) => {
  let previewPayload;
  let saveCalls = 0;
  page.context().on('request', (request) => {
    if (request.url().includes('/api/quotation-preview') && request.method() === 'POST') {
      const encoded = new globalThis.URLSearchParams(request.postData() || '').get('payload');
      previewPayload = encoded ? JSON.parse(encoded) : undefined;
    }
  });
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(coreDetail()) });
      return;
    }
    if (request.method() === 'PUT') {
      saveCalls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(coreDetail()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.route('**/api/quotation-preview**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html><body>preview</body></html>' });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Condição de pagamento').fill('Pagamento sem salvar');
  await page.getByLabel('Título da seção Dados para pagamento').fill('Título transitório');
  await page.getByRole('switch', { name: /Condições gerais/ }).uncheck();
  const preview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Pré-visualizar' }).click();
  const popup = await preview;
  await expect(popup).toHaveURL(/\/api\/quotation-preview\?format=html/);
  await popup.close();

  expect(saveCalls).toBe(0);
  expect(previewPayload).toMatchObject({
    extracted: {
      template_key: 'padrao',
      template_version_id: '55555555-5555-4555-8555-555555555555',
      secoes: {
        pagamento: { current: { title: 'Título transitório' } },
        condicoes_gerais: { current: { enabled: false } },
      },
    },
  });
  expect(previewPayload.extracted.secoes.pagamento.current.body).toContain('Pagamento sem salvar');
  expect(previewPayload.extracted.pagamento).toBeUndefined();
  expect(previewPayload.extracted.observacoes).toBeUndefined();
});

test('production deadline survives hide/re-enable saves and keeps the captured base @quotations', async ({ page }) => {
  const initial = coreDetail({
    prazo_producao: '5 dias',
    secoes: {
      ...coreDetail().secoes,
      prazo_producao: {
        base: { enabled: true, title: 'Prazo de produção', value: '5 dias' },
        current: { enabled: true, title: 'Prazo de produção', value: '5 dias' },
      },
    },
  });
  let authoritative = initial;
  const payloads = [];
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    if (request.method() === 'PUT') {
      const payload = request.postDataJSON();
      payloads.push(payload);
      const sections = globalThis.structuredClone(payload.secoes);
      authoritative = coreDetail({
        prazo_producao: sections.prazo_producao.current.enabled
          ? sections.prazo_producao.current.value
          : '',
        secoes: sections,
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Editar' }).click();
  const deadline = page.getByLabel('Prazo de produção do orçamento');
  await expect(deadline).toHaveText('5 dias');
  await page.getByRole('switch', { name: /Prazo de produção/ }).uncheck();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Orçamento salvo.', { exact: true }).first()).toBeVisible();
  expect(payloads[0].secoes.prazo_producao.current).toMatchObject({ enabled: false, value: '5 dias' });
  expect(payloads[0].prazo_producao).toBe('');

  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByRole('switch', { name: /Prazo de produção/ })).not.toBeChecked();
  await expect(page.getByLabel('Prazo de produção do orçamento')).toHaveText('5 dias');
  await page.getByRole('switch', { name: /Prazo de produção/ }).check();
  await page.getByLabel('Prazo de produção do orçamento').fill('7 dias');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Orçamento salvo.', { exact: true }).last()).toBeVisible();
  expect(payloads[1].secoes.prazo_producao).toMatchObject({
    base: { enabled: true, value: '5 dias' },
    current: { enabled: true },
  });
  expect(payloads[1].secoes.prazo_producao.current.value).toContain('7 dias');
  expect(payloads[1].prazo_producao).toContain('7 dias');
});

test('draft preview uses the selected unsaved client snapshot @quotations', async ({ page }) => {
  let previewPayload;
  page.context().on('request', (request) => {
    if (request.url().includes('/api/quotation-preview') && request.method() === 'POST') {
      const encoded = new globalThis.URLSearchParams(request.postData() || '').get('payload');
      previewPayload = encoded ? JSON.parse(encoded) : undefined;
    }
  });
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(coreDetail({
          cliente: 'Cliente persistido',
          cliente_snapshot: {
            id: '33333333-3333-4333-8333-333333333333',
            nome: 'Cliente persistido',
            email: 'persistido@example.com',
            telefone: '5511999999999',
          },
        })),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/leads-clients*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{
          id: '99999999-9999-4999-8999-999999999999',
          nome: 'Cliente selecionado',
          email: 'selecionado@example.com',
          telefone: '5521988888888',
        }],
      }),
    });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.route('**/api/quotation-preview**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html><body>preview</body></html>' });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Cliente do orçamento').fill('Cliente selecionado');
  await expect(page.getByRole('button', { name: /Cliente selecionado/ })).toBeVisible();
  await page.getByRole('button', { name: /Cliente selecionado/ }).click();
  const preview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Pré-visualizar' }).click();
  const popup = await preview;
  await expect(popup).toHaveURL(/\/api\/quotation-preview\?format=html/);
  await popup.close();

  expect(previewPayload).toMatchObject({
    extracted: {
      nome: 'Cliente selecionado',
      email: 'selecionado@example.com',
      telefone: '5521988888888',
      cliente_snapshot: {
        id: '99999999-9999-4999-8999-999999999999',
        nome: 'Cliente selecionado',
        email: 'selecionado@example.com',
        telefone: '5521988888888',
      },
    },
  });
});

test('draft retains an archived current template when saving unchanged @quotations', async ({ page }) => {
  const archivedVersionId = '88888888-8888-4888-8888-888888888888';
  let payload;
  const archivedDetail = coreDetail({
    template_key: 'arquivado',
    template_padrao: 'arquivado',
    template_version_id: archivedVersionId,
  });
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(archivedDetail) });
      return;
    }
    if (request.method() === 'PUT') {
      payload = request.postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(archivedDetail) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByLabel('Modelo do orçamento')).toHaveValue('arquivado');
  await expect(page.getByLabel('Modelo do orçamento').locator('option:checked')).toContainText('(arquivado)');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Orçamento salvo.')).toBeVisible();
  expect(payload.template_key).toBe('arquivado');
  expect(payload.template_version_id).toBe(archivedVersionId);
});

test('mismatched status label cannot enable draft editing @quotations', async ({ page }) => {
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(coreDetail({ status: 'Draft', status_canonical: 'emitido' })) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await expect(page.getByLabel('Título da seção Dados para pagamento')).toHaveCount(0);
});

test('metadata-free quotation response renders core revision UI @quotations', async ({ page }) => {
  const metadataFreeDetail = coreDetail({ revision: 2, revision_number: 2 });

  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadataFreeDetail) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Revisão 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByRole('region', { name: 'Prazo de produção' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Dados para pagamento' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Condições gerais' })).toBeVisible();
  await expect(page.getByLabel('Modelo do orçamento')).toBeVisible();
});
