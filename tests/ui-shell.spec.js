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
  await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible();
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

async function expectSidebarNavigationContrast(page) {
  for (const category of ['Orçamentos', 'Pedidos', 'Clientes']) {
    const label = page.getByRole('complementary', { name: 'Navegação principal' })
      .getByRole('button', { name: category, exact: true });
    const colors = await label.evaluate((element) => ({
      foreground: globalThis.getComputedStyle(element).color,
      background: globalThis.getComputedStyle(element.closest('aside')).backgroundColor,
    }));
    expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
  }
}

test('Mais abre a sidebar no celular, fecha com Escape e restaura o foco', async ({ page }) => {
  await openDashboard(page, { width: 390, height: 844 });

  const menu = page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Mais' });
  await expect(menu).toHaveAttribute('aria-current', 'page');
  await menu.focus();
  await menu.click();
  await expect(page.locator('#aspen-sidebar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fechar menu' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Resultados' })).toHaveAttribute(
    'aria-current',
    'page'
  );

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-sidebar-backdrop="true"]')).toHaveCount(0);
  await expect(menu).toBeFocused();

  await menu.click();
  await page.locator('[data-sidebar-backdrop="true"]').click({ position: { x: 10, y: 100 } });
  await expect(page.locator('#aspen-sidebar')).not.toBeVisible();
  await expect(menu).toBeFocused();
});

test('shell do sketch mantém contraste na navegação da sidebar', async ({ page }) => {
  await openDashboard(page, { width: 1440, height: 900 });

  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).not.toHaveClass(/dark/);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(229, 230, 236)');
  await expect(page.locator('.aspen-workspace').locator('..')).toHaveCSS('background-color', 'rgb(243, 244, 247)');
  await expect(page.locator('#aspen-sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expectSidebarNavigationContrast(page);
});

test('TopBar e breadcrumb permanecem visíveis ao rolar o conteúdo da página', async ({ page }) => {
  await openDashboard(page, { width: 1440, height: 900 });

  const main = page.locator('main');
  await main.evaluate((element) => {
    const content = globalThis.document.createElement('div');
    content.setAttribute('aria-hidden', 'true');
    content.style.height = '2000px';
    element.append(content);
    element.scrollTop = element.scrollHeight;
  });

  const breadcrumb = page.getByRole('navigation', { name: 'Trilha de navegação' });
  await expect(page.getByRole('banner').filter({ has: breadcrumb })).toBeInViewport();
  await expect(breadcrumb).toBeInViewport();
});
