// @ts-check
import { expect, test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const conversionScenarios = [
  { ratio: 0.29, expected: '29%', artifact: '28.999999999999996%' },
  { ratio: 0.57, expected: '57%', artifact: '56.99999999999999%' },
  { ratio: 0.1234, expected: '12.34%', artifact: '12%' },
];

for (const scenario of conversionScenarios) {
  test(`renders ${scenario.ratio} conversion ratio as ${scenario.expected}`, async ({ page }) => {
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
