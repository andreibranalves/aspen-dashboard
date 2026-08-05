import { expect, test } from '@playwright/test';

const id = 'ORC-20260001';
const token = '2026-07-01T12:00:00.000Z';

function coreDetail(overrides = {}) {
  return {
    id,
    quotation_id: id,
    quotation_uuid: '11111111-1111-4111-8111-111111111111',
    revision_id: '22222222-2222-4222-8222-222222222222',
    revision_number: 1,
    status: 'Draft',
    status_canonical: 'rascunho',
    cliente: 'Cliente core',
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
    concurrency_token: token,
    updated_at: token,
    items: [{ id: '44444444-4444-4444-8444-444444444444', sku: 'SKU-1', item_code: 'SKU-1', nome: 'Produto core', item_name: 'Produto core', qty: '10.000', suggested_unit_price: '9.00', applied_unit_price: '9.00', price_difference: '0.00', line_total: '90.00', manual_rate: false }],
    core_mode: true,
    source: 'postgres',
    ...overrides,
  };
}

const manifest = {
  templates: [
    { key: 'padrao', name: 'Padrão Aspen', is_default: true, hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e', current_version_id: '55555555-5555-4555-8555-555555555555', current_version: 1 },
    { key: 'minimalista', name: 'Minimalista', is_default: false, hash: 'c7060a7faa1f54d08d6f2c237f96cef261c57de5259fb7b755a1dd844bce8c8a', current_version_id: '77777777-7777-4777-8777-777777777777', current_version: 2 },
  ],
};

test('core UI selects/previews a repository template and saves template_key', async ({ page }) => {
  let authoritative = coreDetail();
  let lastPayload;
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    if (request.method() === 'PUT') {
      lastPayload = request.postDataJSON();
      authoritative = coreDetail({ template_key: lastPayload.template_key, template_padrao: lastPayload.template_key });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 }, core_mode: true, source: 'postgres' }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...manifest, core_mode: true, source: 'postgres' }) });
  });
  await page.route('**/api/quotation-preview**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html><body>preview</body></html>' });
  });

  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByLabel('Modelo do orçamento')).toBeVisible();
  await page.getByLabel('Modelo do orçamento').selectOption('minimalista');
  await expect(page.getByText(/Hash: c7060a7faa1f/)).toBeVisible();
  const preview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Visualizar modelo' }).click();
  const popup = await preview;
  await expect(popup).toHaveURL(new RegExp(`/api/quotation-preview\\?id=${id}&template_version_id=77777777-7777-4777-8777-777777777777`));
  await popup.close();

  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByLabel('Título - Pagamento')).toBeEditable();
  await expect(page.getByLabel('Condição de pagamento')).toBeEditable();
  await expect(page.getByLabel('Exibir seção - Pagamento')).toBeEditable();
  await page.getByLabel('Título - Pagamento').fill('Pagamento personalizado');
  await expect(page.getByText('Personalizado').first()).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar padrão' }).nth(1).click();
  await expect(page.getByText('Padrão').first()).toBeVisible();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Salvo.')).toBeVisible();
  expect(lastPayload.template_key).toBe('minimalista');
  expect(lastPayload.template_version_id).toBe('77777777-7777-4777-8777-777777777777');
  expect(lastPayload.secoes).toEqual(expect.objectContaining({
    schema_version: 1,
    pagamento: expect.objectContaining({
      current: expect.objectContaining({ title: 'Pagamento', body: 'À vista' }),
    }),
  }));
});

test('legacy detail does not render the core template controls', async ({ page }) => {
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, status: 'Draft', cliente: 'Legacy', data: '2026-07-01', validade: '2026-07-16', customer_name: 'Legacy', items: [], source: 'frappe', core_mode: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 }, core_mode: false, source: 'frappe' }) });
  });
  await page.route('**/api/quotation-templates**', async (_route) => {
    throw new Error('legacy UI must not fetch the core template manifest');
  });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Legacy')).toBeVisible();
  await expect(page.getByLabel('Modelo do orçamento')).toHaveCount(0);
});
