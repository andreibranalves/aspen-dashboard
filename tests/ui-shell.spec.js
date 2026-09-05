// @ts-check
import { expect, test } from '@playwright/test';

const dashboardPayload = {
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
    conversion_rate: 0,
    conversion_delta: 0,
  },
  top_products: [],
  top_customers: [],
  sales_by_day: [],
  stale_quotations: [],
};

async function openDashboard(page, viewport) {
  await page.setViewportSize(viewport);
  await page.route('**/api/sales-dashboard**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dashboardPayload),
    });
  });
  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

function contrastRatio(foreground, background) {
  const parseRgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = (value) => {
    const [red, green, blue] = parseRgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function waitForThemeToSettle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))
      )
  );
}

async function expectSidebarCategoryContrast(page) {
  for (const category of ['Operacional', 'Cadastros', 'Outros']) {
    const label = page.getByText(category, { exact: true });
    const colors = await label.evaluate((element) => ({
      foreground: globalThis.getComputedStyle(element).color,
      background: globalThis.getComputedStyle(element.closest('aside')).backgroundColor,
    }));
    expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
  }
}

test('sidebar mobile fecha com Escape e restaura o foco do menu', async ({ page }) => {
  await openDashboard(page, { width: 390, height: 844 });

  const menu = page.getByRole('button', { name: 'Abrir menu' });
  await menu.focus();
  await menu.click();
  await expect(page.locator('#aspen-sidebar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fechar menu' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveAttribute(
    'aria-current',
    'page'
  );

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-sidebar-backdrop="true"]')).toHaveCount(0);
  await expect(menu).toBeFocused();

  await menu.click();
  await page.locator('[data-sidebar-backdrop="true"]').click({ position: { x: 380, y: 100 } });
  await expect(page.locator('#aspen-sidebar')).not.toBeVisible();
  await expect(menu).toBeFocused();
});

test('categorias da sidebar mantêm contraste após a troca de tema', async ({ page }) => {
  await page.addInitScript(() => globalThis.localStorage.setItem('aspen_theme', 'light'));
  await openDashboard(page, { width: 1440, height: 900 });

  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await waitForThemeToSettle(page);
  await expectSidebarCategoryContrast(page);

  const themeToggle = page.getByRole('button', { name: 'Ativar modo escuro' });
  await themeToggle.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: 'Ativar modo claro' })).toBeVisible();
  await waitForThemeToSettle(page);
  await expectSidebarCategoryContrast(page);
});
