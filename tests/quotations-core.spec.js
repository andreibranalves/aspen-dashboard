import { expect, test } from '@playwright/test';

const id = 'ORC-20260001';
const token = '2026-07-01T12:00:00.000Z';

function detail(overrides = {}) {
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
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: 'Original',
    prazo_producao: '3 dias',
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

test('core quotations list/search/open/edit and surface optimistic conflicts', async ({ page }) => {
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
          items: [{ id: '44444444-4444-4444-8444-444444444444', sku: 'SKU-1', item_code: 'SKU-1', nome: 'Produto core', item_name: 'Produto core', qty: '10.000', suggested_unit_price: '9.00', applied_unit_price: '10.00', price_difference: '1.00', line_total: '100.00', manual_rate: true }],
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      }
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id, cliente: 'Cliente core', data: '2026-07-01', valor: '90.00', status: 'Draft' }], pagination: { page: 1, limit: 10, total: 1, total_pages: 1 }, status_summary: { Draft: 1 }, core_mode: true, source: 'postgres' }),
    });
  });
  await page.route('**/api/leads-clients**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: '33333333-3333-4333-8333-333333333333', nome: 'Cliente core' }], core_mode: true, source: 'postgres' }) });
  });

  await page.goto('/#/quotations');
  await expect(page.getByText(id).first()).toBeVisible();
  await page.getByLabel('Buscar orçamentos').fill('Cliente');
  await expect(page.getByText(id).first()).toBeVisible();
  await page.getByRole('cell', { name: id, exact: true }).click();
  await expect(page.getByText('Produto core')).toBeVisible();
  await page.getByRole('button', { name: /Editar/ }).click();
  await page.getByLabel('Pagamento do orçamento').fill('Não persistir');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: /Editar/ }).click();
  await expect(page.getByLabel('Pagamento do orçamento')).toHaveValue('À vista');
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
  await expect(page.getByText('R$ 101,25')).toBeVisible();
  await expect(page.getByText('R$ 1,00')).toBeVisible();
  await expect(page.getByText('30 dias').first()).toBeVisible();
  await page.getByRole('button', { name: /Editar/ }).click();
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText(/alterado por outro usuário/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recarregar' })).toBeVisible();
});
