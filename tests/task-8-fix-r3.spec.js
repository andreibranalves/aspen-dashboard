import { expect, test } from '@playwright/test';

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const pagination = { page: 1, limit: 10, total: 2, total_pages: 1 };

test('listas locais falham fechadas quando a segunda linha é inválida @smoke', async ({ page }) => {
  await page.route('**/api/leads-clients**', (route) => json(route, {
    data: [
      { id: 'client-1', nome: 'Cliente válido' },
      { id: 'client-2', nome: 42 },
    ],
    pagination,
  }));
  await page.goto('/#/leads');
  await expect(page.getByText('Não foi possível carregar os clientes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  await expect(page.getByText('Cliente válido', { exact: true })).toHaveCount(0);

  await page.route('**/api/products**', (route) => json(route, {
    data: [
      { sku: 'SKU-1', nome: 'Produto válido', ativo: true },
      { sku: 'SKU-2', nome: 'Produto inválido', pricing_available: 'yes' },
    ],
    pagination,
  }));
  await page.goto('/#/products');
  await expect(page.getByText('Não foi possível carregar os produtos', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  await expect(page.getByText('Produto válido', { exact: true })).toHaveCount(0);
});

test('dashboard inválido exibe retry e nunca mascara métrica como zero @smoke', async ({ page }) => {
  await page.route('**/api/sales-dashboard**', (route) => json(route, {
    success: true,
    period: { label: '30 dias', from: '2026-08-01', to: '2026-08-30' },
    summary: {
      total_revenue: 'NaN', revenue_delta: 0, orders_count: 1.5, orders_delta: 0,
      avg_ticket: 0, avg_ticket_delta: 0, open_orders: 0, conversion_rate: 0, conversion_delta: 0,
    },
    top_products: [], top_customers: [], sales_by_day: [], stale_quotations: [],
  }));
  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: 'Não foi possível carregar os resultados' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  await expect(page.getByText('R$ 0,00', { exact: true })).toHaveCount(0);
});
