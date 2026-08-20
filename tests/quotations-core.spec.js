import { expect, test } from '@playwright/test';

const id = 'ORC-20260001';
const token = '2026-07-01T12:00:00.000Z';

function detail(overrides = {}) {
  return {
    id,
    quotation_id: id,
    quotation_uuid: '11111111-1111-4111-8111-111111111111',
    revision_id: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    revision_number: 1,
    status: 'Draft',
    status_canonical: 'rascunho',
    cliente: 'Cliente local',
    client_id: '33333333-3333-4333-8333-333333333333',
    cliente_snapshot: {
      id: '33333333-3333-4333-8333-333333333333',
      nome: 'Cliente local',
      email: 'cliente@example.com',
    },
    email_sent: false,
    email_sent_at: null,
    validade_dias: 15,
    validade: '2026-07-16',
    data: '2026-07-01',
    pagamento: 'À vista',
    entrega: '10 dias',
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: 'Original',
    prazo_producao: '3 dias',
    template_padrao: 'padrao',
    template_key: 'padrao',
    template_hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e',
    template_version_id: null,
    template_version: null,
    secoes: { schema_version: 1, prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo' } }, pagamento: { base: { enabled: true, title: 'Pagamento', body: 'À vista' }, current: { enabled: true, title: 'Pagamento', body: 'À vista' } }, condicoes_gerais: { base: { enabled: true, title: 'Condições', body: '' }, current: { enabled: true, title: 'Condições', body: '' } } },
    subtotal: '90.00',
    total: '90.00',
    valor: '90.00',
    concurrency_token: token,
    updated_at: token,
    items: [{ id: '44444444-4444-4444-8444-444444444444', sku: 'SKU-1', item_code: 'SKU-1', nome: 'Produto local', item_name: 'Produto local', qty: '10.000', suggested_unit_price: '9.00', applied_unit_price: '9.00', price_difference: '0.00', line_total: '90.00', manual_rate: false }],
    revision_history: [], derived_expired: false, expiration_derived: false, is_expired: false, expirada: false,
    ...overrides,
  };
}

test('email markers render on desktop and mobile', async ({ page }) => {
  const rows = [
    {
      id: 'ORC-EMAIL-1',
      data: '2026-08-17',
      cliente: 'Cliente Enviado',
      valor: '100.00',
      status: 'Enviado',
      status_canonical: 'emitido',
      revision_id: '11111111-1111-4111-8111-111111111111',
      email_sent: true,
      email_sent_at: '2026-08-17T12:00:00.000Z',
    },
    {
      id: 'ORC-EMAIL-2',
      data: '2026-08-17',
      cliente: 'Cliente Pendente',
      valor: '200.00',
      status: 'Enviado',
      status_canonical: 'emitido',
      revision_id: '22222222-2222-4222-8222-222222222222',
      email_sent: false,
      email_sent_at: null,
    },
  ];
  await page.route('**/api/quotations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: rows,
        pagination: { page: 1, limit: 10, total: rows.length, total_pages: 1 },
        status_summary: { Enviado: rows.length },
      }),
    });
  });

  await page.goto('/#/quotations');
  const desktopRows = page.getByRole('row');
  await expect(desktopRows.filter({ hasText: 'ORC-EMAIL-1' })).toContainText('E-mail enviado');
  await expect(desktopRows.filter({ hasText: 'ORC-EMAIL-1' })).toContainText('17/08/2026');
  const pendingDesktopRow = desktopRows.filter({ hasText: 'ORC-EMAIL-2' });
  await expect(pendingDesktopRow).toContainText('E-mail não enviado');
  await expect(pendingDesktopRow.getByText('E-mail não enviado').locator('..')).not.toContainText('17/08/2026');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mobileCards = page.locator('[class~="md:hidden"] > div');
  await expect(mobileCards.filter({ hasText: 'ORC-EMAIL-1' })).toContainText('E-mail enviado');
  await expect(mobileCards.filter({ hasText: 'ORC-EMAIL-1' })).toContainText('17/08/2026');
  const pendingMobileCard = mobileCards.filter({ hasText: 'ORC-EMAIL-2' });
  await expect(pendingMobileCard).toContainText('E-mail não enviado');
  await expect(pendingMobileCard.getByText('E-mail não enviado').locator('..')).not.toContainText('17/08/2026');
});

test('local quotations list/search/open/edit and surface optimistic conflicts @quotations @smoke', async ({ page }) => {
  const customItemName = 'Lenço 100 x 100 cm';
  let putCount = 0;
  let lastPutPayload;
  let authoritative = detail();
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    if (request.method() === 'PUT') {
      putCount += 1;
      lastPutPayload = request.postDataJSON();
      if (putCount === 2) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'O orçamento foi alterado por outro usuário. Recarregue antes de salvar.' }) });
      } else {
        authoritative = detail({
          pagamento: lastPutPayload.pagamento,
          frete: '1.25',
          observacoes: 'Salvo pelo servidor',
          subtotal: '100.00',
          total: '101.25',
          valor: '101.25',
          concurrency_token: '2026-07-01T12:01:00.000Z',
          updated_at: '2026-07-01T12:01:00.000Z',
          items: [{ id: '44444444-4444-4444-8444-444444444444', sku: 'SKU-1', item_code: 'SKU-1', nome: lastPutPayload.items[0].item_name, item_name: lastPutPayload.items[0].item_name, qty: '10.000', suggested_unit_price: '9.00', applied_unit_price: '10.00', price_difference: '1.00', line_total: '100.00', manual_rate: true }],
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      }
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id, revision_id: '22222222-2222-4222-8222-222222222222', cliente: 'Cliente local', data: '2026-07-01', valor: '90.00', status: 'Rascunho', status_canonical: 'rascunho' }], pagination: { page: 1, limit: 10, total: 1, total_pages: 1 }, status_summary: { Rascunho: 1 } }),
    });
  });
  await page.route('**/api/leads-clients**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: '33333333-3333-4333-8333-333333333333', nome: 'Cliente local' }] }) });
  });

  await page.goto('/#/quotations');
  await expect(page.getByText(id).first()).toBeVisible();
  await page.getByLabel('Buscar orçamentos').fill('Cliente');
  await expect(page.getByText(id).first()).toBeVisible();
  await page.getByRole('cell', { name: id, exact: true }).click();
  await expect(page.getByText('Produto local')).toBeVisible();
  await page.getByRole('button', { name: /Editar/ }).click();
  await page.getByLabel('Pagamento do orçamento').fill('Não persistir');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: /Editar/ }).click();
  await expect(page.getByLabel('Pagamento do orçamento')).toHaveValue('À vista');
  await page.getByLabel('Nome exibido no orçamento SKU-1').fill(customItemName);
  await page.getByLabel('Pagamento do orçamento').fill('30 dias');
  await page.getByLabel('Frete do orçamento').fill('1.25');
  await page.getByLabel('Observações do orçamento').fill('Alteração local');
  await page.getByLabel('Preço aplicado SKU-1').fill('10.00');
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText('Salvo.')).toBeVisible();
  expect(putCount).toBe(1);
  expect(lastPutPayload.concurrency_token).toBe(token);
  expect(lastPutPayload.pagamento).toBe('30 dias');
  expect(lastPutPayload.frete).toBe('1.25');
  expect(lastPutPayload.observacoes).toBe('Alteração local');
  expect(lastPutPayload.items[0].manual_rate).toBe(true);
  expect(lastPutPayload.items[0].rate).toBe('10.00');
  expect(lastPutPayload.items[0].item_name).toBe(customItemName);
  await expect(page.getByText('R$ 101,25')).toBeVisible();
  await expect(page.getByText('R$ 1,00')).toBeVisible();
  await expect(page.getByText('30 dias').first()).toBeVisible();
  await expect(page.getByText(customItemName)).toBeVisible();
  await page.getByRole('button', { name: /Editar/ }).click();
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText(/alterado por outro usuário/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recarregar' })).toBeVisible();
});

test('pré-seleciona o modelo padrão em rascunho já existente @quotations @smoke', async ({ page }) => {
  await page.route('**/api/leads-clients**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        default_key: 'simples',
        templates: [
          { key: 'branded', name: 'Aspen Original', is_default: false, current_version_id: '55555555-5555-4555-8555-555555555555', current_version: 1 },
          { key: 'simples', name: 'Simples', is_default: true, current_version_id: '66666666-6666-4666-8666-666666666666', current_version: 1 },
        ],
      }),
    });
  });
  await page.route('**/api/quotations?id=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail({
        template_key: 'branded',
        template_padrao: 'branded',
        template_version_id: '55555555-5555-4555-8555-555555555555',
      })),
    });
  });

  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByLabel('Modelo do orçamento')).toHaveValue('simples');
});
