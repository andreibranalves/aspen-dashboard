// @ts-check
import { expect, test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

function dashboardResponse({
  period = 'month',
  metaEditable = period === 'month' || period === 'last_month',
  adsMeta = 200,
  ads = 350,
} = {}) {
  const labels = {
    month: 'Este mês',
    last_month: 'Mês passado',
    '30d': 'Últimos 30 dias',
  };

  return {
    success: true,
    period: { label: labels[period] || 'Período', from: '2098-08-01', to: '2098-08-10' },
    summary: {
      total_revenue: 25000,
      faturamento: 25000,
      custo: 9000,
      ads,
      ads_google: 150,
      ads_meta: adsMeta,
      imposto: 1000,
      lucro: 14650,
      ads_google_unavailable: false,
      meta_editable: metaEditable,
      orders_count: 12,
      avg_ticket: 2083.33,
      open_orders: 3,
      conversion_rate: 0.4,
      revenue_delta: 8.5,
      orders_delta: 2,
      avg_ticket_delta: 4.1,
      conversion_delta: -1.2,
    },
    top_products: [{ sku: 'SKU-1', product: 'Camiseta', quantity: 20, revenue: 25000, orders: 12 }],
    top_customers: [{ name: 'Cliente exemplo', revenue: 25000, orders: 12 }],
    sales_by_day: [{ date: '2098-08-10', revenue: 25000, orders: 12 }],
    stale_quotations: [
      { id: 'ORC-198', customer: 'Cliente pendente', age: 2, value: 3500, status: 'emitido' },
    ],
  };
}

const conversionScenarios = [
  { ratio: 0.29, expected: '29%', artifact: '28.999999999999996%' },
  { ratio: 0.57, expected: '57%', artifact: '56.99999999999999%' },
  { ratio: 0.1234, expected: '12.34%', artifact: '12%' },
];

for (const scenario of conversionScenarios) {
  test(`renders ${scenario.ratio} conversion ratio as ${scenario.expected} @smoke`, async ({ page }) => {
    await page.route('**/api/settings**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });
    await page.route('**/api/sales-dashboard**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          period: { label: 'Últimos 30 dias', from: '2098-07-11', to: '2098-08-10' },
          summary: {
            total_revenue: 0,
            revenue_delta: 0,
            orders_count: 0,
            orders_delta: 0,
            avg_ticket: 0,
            avg_ticket_delta: 0,
            open_orders: 0,
            conversion_rate: scenario.ratio,
            conversion_delta: 0,
          },
          top_products: [],
          top_customers: [],
          sales_by_day: [],
          stale_quotations: [],
        }),
      });
    });

    await page.goto(`${BASE_URL}/#/dashboard`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const conversionCard = page.getByText('Conversão', { exact: true }).locator('..').locator('..');
    await expect(conversionCard).toContainText(scenario.expected);
    await expect(conversionCard).not.toContainText(scenario.artifact);
  });
}

test('edita o gasto Meta nos meses calendário e preserva retorno e períodos @smoke', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  /** @type {string[]} */
  const requestedPeriods = [];
  /** @type {unknown[]} */
  const savedPayloads = [];

  await page.route('**/api/settings**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/sales-dashboard**', async (route) => {
    const request = route.request();
    const requestedPeriod = new globalThis.URL(request.url()).searchParams.get('period') || 'month';

    if (request.method() === 'PUT') {
      savedPayloads.push(request.postDataJSON());
      if (savedPayloads.length === 1) {
        return route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Informe um gasto Meta válido.' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          dashboardResponse({ period: requestedPeriod, adsMeta: 1234.56, ads: 1384.56 })
        ),
      });
    }

    requestedPeriods.push(requestedPeriod);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dashboardResponse({ period: requestedPeriod })),
    });
  });

  await page.goto(`${BASE_URL}/#/dashboard`);

  await expect(page.getByRole('heading', { name: 'Orçamentos para follow-up' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Desempenho comercial' })).toBeInViewport();

  const metaInput = page.getByLabel('Gasto Meta (R$)');
  await expect(metaInput).toHaveValue('200');
  await expect(page.getByRole('button', { name: 'Salvar gasto' })).toBeVisible();
  await page.getByRole('button', { name: 'Ativar modo escuro' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(metaInput).toBeVisible();
  await page.getByRole('button', { name: 'Ativar modo claro' }).click();

  await metaInput.fill('1.234,56');
  await page.getByRole('button', { name: 'Salvar gasto' }).click();
  await expect(page.getByRole('alert')).toHaveText('Informe um gasto Meta válido.');
  expect(savedPayloads[0]).toEqual({ period: 'month', meta_spend: '1.234,56' });

  await page.getByRole('button', { name: 'Salvar gasto' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(metaInput).toHaveValue('1234.56');
  const adsCard = page.getByText('Ads', { exact: true }).locator('..').locator('..');
  await expect(adsCard).toContainText('R$\u00a01.384,56');
  expect(savedPayloads[1]).toEqual({ period: 'month', meta_spend: '1.234,56' });

  await page.getByRole('button', { name: '30 dias' }).click();
  await expect(page).toHaveURL(/period=30d/);
  await expect(page.getByLabel('Gasto Meta (R$)')).toHaveCount(0);

  await page.getByRole('button', { name: 'Mês passado' }).click();
  await expect(page).toHaveURL(/period=last_month/);
  await expect(page.getByLabel('Gasto Meta (R$)')).toBeVisible();
  expect(requestedPeriods).toContain('month');
  expect(requestedPeriods).toContain('30d');
  expect(requestedPeriods).toContain('last_month');
});
