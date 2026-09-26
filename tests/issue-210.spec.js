import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const BASE_ORIGIN = process.env.BASE_URL || 'http://localhost:5173';
const INTER_REGULAR = readFileSync(new URL('./fixtures/fonts/Inter-Regular.woff', import.meta.url));
const INTER_SEMIBOLD = readFileSync(
  new URL('./fixtures/fonts/Inter-SemiBold.woff', import.meta.url)
);
const INTER_CSS = `
  @font-face { font-family: Inter; src: url("https://fonts.gstatic.com/inter-regular.woff") format("woff"); font-weight: 400; font-style: normal; }
  @font-face { font-family: Inter; src: url("https://fonts.gstatic.com/inter-semibold.woff") format("woff"); font-weight: 600; font-style: normal; }
`;

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
  const blocked = { external: [], api: [], methods: [] };
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.origin !== BASE_ORIGIN) {
      if (url.hostname === 'fonts.googleapis.com') {
        await route.fulfill({ contentType: 'text/css', body: INTER_CSS });
        return;
      }
      if (url.hostname === 'fonts.gstatic.com') {
        await route.fulfill({
          contentType: 'font/woff',
          body: url.pathname.endsWith('inter-semibold.woff') ? INTER_SEMIBOLD : INTER_REGULAR,
        });
        return;
      }
      blocked.external.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (!['GET', 'PATCH'].includes(route.request().method())) {
      blocked.methods.push(`${route.request().method()} ${url.href}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (await handler(route, url)) return;
    blocked.api.push(url.href);
    await route.abort('blockedbyclient');
  });
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

    await page.goto('/#/sales-orders?tab=todos');
    await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
    await expect(page.getByText(order.customer_name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(order.customer, { exact: true })).toHaveCount(0);
    await expect(page.locator('#aspen-sidebar')).toHaveCSS('width', '248px');
    await expect(page.locator('header')).toHaveCSS('height', '32px');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(221, 221, 221)');
    await expect(page.locator('#aspen-sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('thead th')).toHaveText([
      'Pedido',
      'Cliente',
      'Status',
      'Entrega',
      'Valor',
    ]);
    await expect(page.getByRole('table').getByText('10/08/2026', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: order.source_quotation, exact: true })
    ).toBeVisible();
    await expect(page.getByText('Últimos 30 dias', { exact: true })).toBeVisible();
    await expect(page.getByText('R$ 1.500,00').first()).toBeVisible();
    await page.getByLabel('Filtrar por status').selectOption('Completed');
    await page.getByLabel('Filtrar por período').selectOption('7d');
    await page.getByLabel('Buscar pedidos').fill(order.customer_name);
    await expect
      .poll(() =>
        requests.some((request) => {
          const url = new globalThis.URL(request);
          return (
            url.searchParams.get('status') === 'Completed' &&
            url.searchParams.get('period') === '7d' &&
            url.searchParams.get('search') === order.customer_name
          );
        })
      )
      .toBe(true);
    expect(blocked.api).toEqual([]);
    expect(blocked.methods).toEqual([]);
    expect(blocked.external).toEqual([]);
  });

  test('detalhe avisa saldo em aberto ao entregar e desfaz a mudança de etapa', async ({ page }) => {
    const patches = [];
    const ready = {
      ...order,
      status: 'To Deliver and Bill',
      grand_total: 100,
      per_billed: 50,
      per_delivered: 0,
      production_stage: 'pronto',
      production: { state: 'concluido', deadline: '2026-09-08', total_days: 20, elapsed_days: 12, stalled_days: null },
      production_days: 20,
      deposit_received_on: '2026-08-05',
      deposit_amount: 50,
      art_approved_on: '2026-08-10',
      ready_on: '2026-08-25',
      received_amount: 50,
      items: [],
      notes: [],
    };
    let detail = ready;
    const blocked = await intercept(page, async (route, url) => {
      if (url.pathname !== '/api/sales-orders') return false;
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON();
        patches.push(payload);
        detail =
          payload.action === 'undo'
            ? ready
            : {
                ...ready,
                status: 'To Bill',
                per_delivered: 100,
                production_stage: 'entregue',
                delivered_on: payload.date,
                notes: [{ id: 'note-1', kind: 'stage', body: 'Entregue', created_at: '2026-08-26T12:00:00.000Z', undoable: true }],
              };
        return json(route, detail);
      }
      return json(route, detail);
    });

    await page.goto(`/#/sales-orders/${order.id}`);
    const production = page.getByRole('region', { name: 'Produção' });
    await production.getByRole('button', { name: 'Entregue' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('status')).toContainText('Saldo em aberto: recebido R$ 50,00 de R$ 100,00.');
    await dialog.getByRole('button', { name: 'Mover para Entregue' }).click();
    await expect(production.getByLabel('Entregue')).toBeVisible();
    await page.getByRole('button', { name: 'Desfazer' }).click();
    await expect(production.getByRole('button', { name: 'Entregue' })).toBeVisible();
    expect(patches.map((payload) => payload.action)).toEqual(['advance', 'undo']);
    expect(patches[1]).toEqual({ action: 'undo', note_id: 'note-1' });
    expect(blocked.api).toEqual([]);
    expect(blocked.methods).toEqual([]);
    expect(blocked.external).toEqual([]);
  });

  test('retorno preserva contexto, entrada direta funciona e exportação é auditável', async ({
    page,
  }) => {
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
    await expect(page).toHaveURL(
      /#\/sales-orders\?page=3&limit=25&period=7d&status=Completed&search=Cliente$/
    );

    await page.goto(`/#/sales-orders/${order.id}`);
    await page.getByRole('navigation', { name: 'Trilha de navegação' })
      .getByRole('button', { name: 'Pedidos' }).click();
    await expect(page).toHaveURL(/#\/sales-orders(?:\?|$)/);
    await page.getByRole('tab', { name: 'Todos' }).click();

    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Exportar', exact: true });
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
    expect(blocked.methods).toEqual([]);
    expect(blocked.external).toEqual([]);
  });

  test('exportação pendente mantém o bloqueio depois de fechar e reabrir', async ({ page }) => {
    let releaseExport;
    const pendingExport = new Promise((resolve) => {
      releaseExport = resolve;
    });
    const exports = [];
    const blocked = await intercept(page, async (route, url) => {
      if (url.pathname === '/api/sales-dashboard') return json(route, dashboardResponse);
      if (url.pathname === '/api/sales-orders') return json(route, listResponse);
      if (url.pathname !== '/api/commercial-exports') return false;
      exports.push(url.href);
      await pendingExport;
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="pedidos.csv"',
        },
        body: 'id;status\nPED-2026-0210;Completed',
      });
      return true;
    });

    await page.goto('/#/sales-orders?tab=todos');
    await expect(page.getByText(order.id, { exact: true }).first()).toBeVisible();
    const trigger = page.getByRole('button', { name: 'Exportar', exact: true });
    await trigger.click();
    const ordersExport = page.locator('#sales-order-export-menu button').first();
    await ordersExport.click();
    await expect(ordersExport).toContainText('Exportando…');
    await expect(ordersExport).toBeDisabled();

    await page.keyboard.press('Escape');
    await trigger.click();
    const reopened = page.locator('#sales-order-export-menu button').first();
    await expect(reopened).toContainText('Exportando…');
    await expect(reopened).toBeDisabled();
    await expect.poll(() => exports).toHaveLength(1);
    releaseExport();
    await expect(reopened).toBeEnabled();
    expect(blocked.api).toEqual([]);
    expect(blocked.methods).toEqual([]);
    expect(blocked.external).toEqual([]);
  });

  test('lista ignora resposta antiga liberada depois da busca nova', async ({ page }) => {
    let releaseOld;
    const oldResponse = new Promise((resolve) => {
      releaseOld = resolve;
    });
    const requests = [];
    const blocked = await intercept(page, async (route, url) => {
      if (url.pathname === '/api/sales-dashboard') return json(route, dashboardResponse);
      if (url.pathname !== '/api/sales-orders') return false;
      if (url.searchParams.get('search') !== 'novo') {
        requests.push('old');
        await oldResponse;
        return json(route, {
          success: true,
          items: [{ ...order, id: 'PED-2026-0000', customer_name: 'Cliente antigo' }],
          has_more: false,
        });
      }
      requests.push('new');
      return json(route, {
        success: true,
        items: [{ ...order, id: 'PED-2026-0010', customer_name: 'Cliente novo' }],
        has_more: false,
      });
    });

    await page.goto('/#/sales-orders?tab=todos');
    await expect.poll(() => requests).toContain('old');
    await page.getByLabel('Buscar pedidos').fill('novo');
    await expect(page.getByText('Cliente novo', { exact: true }).first()).toBeVisible();
    releaseOld();
    await page.waitForTimeout(100);
    await expect(page.getByText('Cliente novo', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Cliente antigo', { exact: true })).toHaveCount(0);
    expect(requests.filter((request) => request === 'old').length).toBeGreaterThan(0);
    expect(requests.filter((request) => request === 'new')).toEqual(['new']);
    expect(blocked.api).toEqual([]);
    expect(blocked.methods).toEqual([]);
    expect(blocked.external).toEqual([]);
  });

});
