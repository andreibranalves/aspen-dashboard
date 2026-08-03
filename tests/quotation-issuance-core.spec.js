import { expect, test } from '@playwright/test';

const id = 'ORC-20260001';
const documentId = '55555555-5555-4555-8555-555555555555';
const hash = 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e';

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
    frete: '0.00',
    observacoes: '',
    prazo_producao: '',
    template_padrao: 'padrao',
    template_key: 'padrao',
    template_hash: hash,
    subtotal: '90.00',
    total: '90.00',
    valor: '90.00',
    concurrency_token: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-01T12:00:00.000Z',
    issued_document: null,
    items: [{ id: '44444444-4444-4444-8444-444444444444', sku: 'SKU-1', item_code: 'SKU-1', nome: 'Produto core', item_name: 'Produto core', qty: '10.000', suggested_unit_price: '9.00', applied_unit_price: '9.00', price_difference: '0.00', line_total: '90.00', manual_rate: false }],
    core_mode: true,
    source: 'postgres',
    ...overrides,
  };
}

const document = {
  id: documentId,
  file_name: `${id}-R1.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 2048,
  checksum_sha256: 'a'.repeat(64),
  issued_at: '2026-07-01T12:05:00.000Z',
  download_url: `/api/quotation-document?id=${documentId}`,
};

test('core UI emits with progress, becomes read-only and opens the archived PDF', async ({ page }) => {
  let authoritative = detail();
  let issuedPayload;
  await page.route('**/api/quotations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [{ key: 'padrao', name: 'Padrão Aspen', is_default: true, hash }] }) });
  });
  await page.route('**/api/quotation-issue**', async (route) => {
    issuedPayload = route.request().postDataJSON();
    await page.waitForTimeout(150);
    authoritative = detail({ status: 'Issued', status_canonical: 'emitido', issued_document: document });
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'emitido', already_issued: false, document }) });
  });
  await page.route('**/api/quotation-document**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF' });
  });

  await page.goto(`/#/quotations/${id}`);
  const emit = page.getByRole('button', { name: 'Emitir PDF definitivo' });
  await expect(emit).toBeVisible();
  await emit.click();
  await expect(page.getByRole('button', { name: 'Emitindo PDF…' })).toBeDisabled();
  expect(issuedPayload).toEqual({ id });
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
  await expect(page.getByText(/PDF definitivo arquivado/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Abrir PDF emitido' }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(new RegExp(`/api/quotation-document\\?id=${documentId}`));
  await popup.close();
});

test('legacy quotation never exposes core issuance controls', async ({ page }) => {
  await page.route('**/api/quotations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, status: 'Draft', cliente: 'Legacy', data: '2026-07-01', validade: '2026-07-16', items: [], source: 'frappe', core_mode: false }) });
  });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Legacy')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emitir PDF definitivo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir PDF emitido' })).toHaveCount(0);
});
