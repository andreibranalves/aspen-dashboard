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
  };
}

test('overview mostra orçamentos reais e gráfico legível com um dia', async ({ page }) => {
  await page.route('**/api/sales-dashboard**', (route) =>
    route.fulfill({ json: dashboardResponse() })
  );
  await page.route('**/api/quotations**', (route) =>
    route.fulfill({
      json: {
        data: [{
          canonical: {
            id: '11111111-1111-4111-8111-111111111111',
            businessNumber: 'ORC-2026-001',
            name: 'Proposta de camisetas',
            revisionId: '22222222-2222-4222-8222-222222222222',
            revision: 1,
            status: 'emitido',
            clienteId: '33333333-3333-4333-8333-333333333333',
            cliente: 'Cliente exemplo',
            data: '2026-09-22',
            validade: '2026-10-07',
            validadeDias: 15,
            subtotal: '1500.00',
            total: '1500.00',
            frete: '0.00',
            expired: false,
            concurrencyToken: '2026-09-22T12:00:00.000Z',
            updatedAt: '2026-09-22T12:00:00.000Z',
            emailSent: false,
          },
        }],
      },
    })
  );

  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: 'Últimos orçamentos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ORC-2026-001' })).toBeVisible();
  const bar = page.getByRole('img', { name: 'Receita por dia' }).locator('.bg-primary');
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())?.width).toBeLessThanOrEqual(64);
  await page.getByRole('button', { name: 'ORC-2026-001' }).click();
  await expect(page).toHaveURL(/#\/quotations\/11111111-1111-4111-8111-111111111111$/);
});

const conversionScenarios = [
  { ratio: 0.29, expected: '29%', artifact: '28.999999999999996%' },
  { ratio: 0.57, expected: '57%', artifact: '56.99999999999999%' },
  { ratio: 0.1234, expected: '12%', artifact: '12.34%' },
];

for (const scenario of conversionScenarios) {
  test(`renders ${scenario.ratio} conversion ratio as ${scenario.expected} @smoke`, async ({
    page,
  }) => {
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
            orders_count: 1,
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
        }),
      });
    });

    await page.goto(`${BASE_URL}/#/dashboard`);
    await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible();

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

  await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible();
  await expect(page.getByText(/orçamento sem resposta/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver gasto mensal' }).click();
  await expect(page.getByRole('heading', { name: 'Composição financeira' })).toBeVisible();

  const metaInput = page.getByLabel('Valor informado de gasto Meta');
  await expect(metaInput).toHaveValue('200');
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('.aspen-workspace')).toHaveCSS('background-color', 'rgb(13, 13, 13)');
  await expect(metaInput).toBeVisible();

  await metaInput.fill('1.234,56');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Informe um gasto Meta válido.');
  expect(savedPayloads[0]).toEqual({ period: 'month', meta_spend: '1.234,56' });

  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(metaInput).toHaveValue('1234.56');
  await expect(page.getByRole('cell', { name: '− R$\u00a01.234,56' })).toBeVisible();
  expect(savedPayloads[1]).toEqual({ period: 'month', meta_spend: '1.234,56' });

  await page.getByLabel('Período dos resultados').selectOption('30d');
  await expect(page).toHaveURL(/period=30d/);
  await expect(page.getByLabel('Valor informado de gasto Meta')).toHaveCount(0);

  await page.getByLabel('Período dos resultados').selectOption('last_month');
  await expect(page).toHaveURL(/period=last_month/);
  await expect(page.getByLabel('Valor informado de gasto Meta')).toBeVisible();
  expect(requestedPeriods).toContain('month');
  expect(requestedPeriods).toContain('30d');
  expect(requestedPeriods).toContain('last_month');
});

test('mantém as quatro abas de Resultados e os destinos finais da navegação @smoke', async ({
  page,
}) => {
  await page.route('**/api/settings**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/sales-dashboard**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dashboardResponse()),
    })
  );

  await page.goto(`${BASE_URL}/#/dashboard?period=month`);
  await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Visão geral' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Produtos' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Produtos' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#\/dashboard\?tab=products$/);

  for (const [key, label, heading] of [
    ['overview', 'Visão geral', 'Resultados'],
    ['products', 'Produtos', 'Produtos por receita'],
    ['customers', 'Clientes', 'Clientes por receita'],
    ['finance', 'Financeiro', 'Composição financeira'],
  ]) {
    await page.getByRole('tab', { name: label }).click();
    const query = key === 'overview' ? '' : `?tab=${key}`;
    await expect(page).toHaveURL(new RegExp(`#\\/dashboard${query.replace('?', '\\?')}$`));
    const panel = page.getByRole('tabpanel');
    await expect(panel).toBeVisible();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }

  const sidebar = page.getByRole('complementary', { name: 'Navegação principal' });
  await expect(sidebar.getByRole('button', { name: 'Novo orçamento' })).toBeVisible();
  for (const label of [
    'Orçamentos',
    'Comercial',
    'Pedidos',
    'Clientes',
    'Catálogo',
    'Envios',
    'Resultados',
    'Configurações',
  ]) {
    await expect(sidebar.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await sidebar.getByRole('button', { name: 'Orçamentos' }).click();
  await expect(page).toHaveURL(/#\/quotations$/);
});
