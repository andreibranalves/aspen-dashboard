import { expect, test } from '@playwright/test';

const BASE_ORIGIN = 'http://localhost:5173';

async function json(route, body, status = 200, contentType = 'application/json') {
  await route.fulfill({ status, contentType, body: JSON.stringify(body) });
  return true;
}

const order = {
  id: 'PED-2026-0210',
  date: '2026-08-10',
  customer_name: 'Cliente Demonstração',
  customer: '11111111-1111-4111-8111-111111111111',
  grand_total: 1500,
  rounded_total: 1500,
  status: 'Completed',
  delivery_date: '2026-08-20',
  per_delivered: 100,
  per_billed: 100,
  source_quotation: 'ORC-20260001',
};

const listResponse = {
  success: true,
  items: [order],
  page: 1,
  limit: 10,
  has_more: false,
};

const dashboardResponse = {
  success: true,
  summary: {
    total_revenue: 1500,
    revenue_delta: 12.5,
    orders_count: 1,
    orders_delta: null,
    avg_ticket: 1500,
    avg_ticket_delta: null,
    open_orders: 0,
    conversion_rate: 0.5,
    conversion_delta: null,
  },
};

async function intercept(page, handler) {
  const blocked = { external: [], api: [] };
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.origin !== BASE_ORIGIN) {
      blocked.external.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (await handler(route, url)) return;
    blocked.api.push(url.href);
    await route.abort('blockedbyclient');
  });
  await page.addInitScript(() => globalThis.localStorage.setItem('aspen_theme', 'light'));
  return blocked;
}

test.describe('issue #210 — fundação e pedidos', () => {
  test('lista usa contrato canônico, shell visual e filtros atuais', async ({ page }) => {
    const requests = [];
    const blocked = await intercept(page, async (route, url) => {
      if (url.pathname === '/api/sales-dashboard') return json(route, dashboardResponse);
      if (url.pathname !== '/api/sales-orders') return false;
      requests.push(url.href);
      return json(route, listResponse);
    });

    await page.goto('/#/sales-orders');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
    await expect(page.getByText(order.customer_name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(order.customer, { exact: true })).toHaveCount(0);
    await expect(page.locator('#aspen-sidebar')).toHaveCSS('width', '216px');
    await expect(page.locator('header')).toHaveCSS('height', '56px');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
    await expect(page.locator('#aspen-sidebar')).toHaveCSS('background-color', 'rgb(15, 20, 32)');

    await page.getByText('Resumo comercial · últimos 30 dias', { exact: true }).click();
    await expect(page.getByText('R$ 1.500,00').first()).toBeVisible();
    await page.getByLabel('Filtrar por status').selectOption('Completed');
    await page.getByLabel('Buscar pedidos').fill(order.customer_name);
    await expect.poll(() => requests.some((request) => {
      const url = new globalThis.URL(request);
      return url.searchParams.get('status') === 'Completed' &&
        url.searchParams.get('search') === order.customer_name;
    })).toBe(true);
    expect(blocked.api).toEqual([]);
    expect(blocked.external.every((url) => url.startsWith('https://fonts.googleapis.com/'))).toBe(true);
  });

  test('detalhe mantém progresso independente e bloqueia estados finais', async ({ page }) => {
    const patches = [];
    let detail = { ...order, status: 'To Deliver', per_billed: 0, per_delivered: 0, items: [] };
    const blocked = await intercept(page, async (route, url) => {
      if (url.pathname !== '/api/sales-orders') return false;
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON();
        patches.push(payload);
        if (payload.per_billed === 100) {
          detail = { ...detail, per_billed: 100 };
          return json(route, detail);
        }
        return json(route, { error: 'Falha ao atualizar pedido.' }, 500);
      }
      return json(route, detail);
    });

    await page.goto(`/#/sales-orders/${order.id}`);
    const billed = page.getByRole('button', { name: 'Marcar faturado' });
    const delivered = page.getByRole('button', { name: 'Marcar entregue' });
    await expect(billed).toBeEnabled();
    await expect(delivered).toBeEnabled();
    await billed.click();
    await expect.poll(() => patches).toEqual([{ per_billed: 100 }]);
    await delivered.click();
    await expect(page.getByRole('alert')).toContainText('Falha ao atualizar pedido.');

    detail = { ...detail, status: 'Draft' };
    await page.reload();
    await expect(page.getByRole('button', { name: 'Marcar faturado' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Marcar entregue' })).toBeDisabled();
    expect(blocked.api).toEqual([]);
    expect(blocked.external.every((url) => url.startsWith('https://fonts.googleapis.com/'))).toBe(true);
  });

  test('retorno preserva contexto, entrada direta funciona e exportação é auditável', async ({ page }) => {
    const exports = [];
    const blocked = await intercept(page, async (route, url) => {
      if (url.pathname === '/api/sales-dashboard') return json(route, dashboardResponse);
      if (url.pathname === '/api/sales-orders') {
        if (url.searchParams.has('id')) return json(route, { ...order, items: [] });
        return json(route, listResponse);
      }
      if (url.pathname === '/api/commercial-exports') {
        exports.push(url.href);
        if (url.searchParams.get('resource') === 'sales-order-items') {
          return json(route, {}, 500);
        }
        await route.fulfill({
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="pedidos.csv"',
          },
          body: 'id;status\nPED-2026-0210;Completed',
        });
        return true;
      }
      return false;
    });

    await page.goto('/#/sales-orders?page=3&limit=25&period=7d&status=Completed&search=Cliente');
    await page.getByText(order.id, { exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`#\\/sales-orders\\/${order.id}$`));
    await page.goBack();
    await expect(page).toHaveURL(/#\/sales-orders\?page=3&limit=25&period=7d&status=Completed&search=Cliente$/);

    await page.goto(`/#/sales-orders/${order.id}`);
    await page.getByRole('button', { name: '← Voltar aos pedidos' }).click();
    await expect(page).toHaveURL(/#\/sales-orders$/);

    await page.getByRole('button', { name: 'Exportar' }).click();
    const trigger = page.getByRole('button', { name: 'Exportar' });
    await expect(page.getByRole('button', { name: 'Exportar pedidos' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('button', { name: 'Exportar pedidos' }).click();
    await expect.poll(() => exports.length).toBe(1);
    const exportUrl = new globalThis.URL(exports[0]);
    expect(exportUrl.searchParams.get('period')).toBe('30d');
    await page.getByRole('button', { name: 'Exportar itens' }).click();
    await expect(page.getByRole('alert')).toContainText('Não foi possível gerar a exportação.');
    expect(blocked.api).toEqual([]);
    expect(blocked.external.every((url) => url.startsWith('https://fonts.googleapis.com/'))).toBe(true);
  });

  test('rotas de criação, clientes, produtos e configurações continuam acessíveis', async ({ page }) => {
    const blocked = await intercept(page, async () => false);
    for (const [hash, heading] of [
      ['manual', 'Novo orçamento'],
      ['leads', 'Clientes'],
      ['products', 'Produtos'],
      ['settings', 'Configurações'],
    ]) {
      await page.goto(`/#/${hash}`);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    }
    expect(blocked.external.every((url) => url.startsWith('https://fonts.googleapis.com/'))).toBe(true);
    expect(blocked.api.every((url) => url.startsWith(`${BASE_ORIGIN}/api/`))).toBe(true);
  });
});
