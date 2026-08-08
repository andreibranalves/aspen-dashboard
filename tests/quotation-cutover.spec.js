// @ts-check
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
