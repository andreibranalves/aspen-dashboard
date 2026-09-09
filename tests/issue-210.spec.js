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
    await expect(page.locator('details[open]')).toHaveCount(0);

    await page.getByText('Resumo comercial · últimos 30 dias', { exact: true }).click();
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

  test('detalhe mantém progresso independente e bloqueia estados finais', async ({ page }) => {
    const patches = [];
    let releaseBilled;
    let releaseDelivered;
    const billedPending = new Promise((resolve) => {
      releaseBilled = resolve;
    });
    const deliveredPending = new Promise((resolve) => {
      releaseDelivered = resolve;
    });
    let detail = { ...order, status: 'To Deliver', per_billed: 0, per_delivered: 0, items: [] };
    const blocked = await intercept(page, async (route, url) => {
      if (url.pathname !== '/api/sales-orders') return false;
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON();
        patches.push(payload);
        if (payload.per_billed === 100) {
          await billedPending;
          detail = { ...detail, per_billed: 100 };
          return json(route, detail);
        }
        await deliveredPending;
        return json(route, { error: 'SQL_TEST_ONLY internal detail' }, 500);
      }
      return json(route, detail);
    });

    await page.goto(`/#/sales-orders/${order.id}`);
    const billed = page.getByRole('button', { name: 'Marcar faturado' });
    const delivered = page.getByRole('button', { name: 'Marcar entregue' });
    await expect(billed).toBeEnabled();
    await expect(delivered).toBeEnabled();
    await billed.click();
    await expect(billed).toBeDisabled();
    await expect(delivered).toBeDisabled();
    await expect.poll(() => patches).toEqual([{ per_billed: 100 }]);
    releaseBilled();
    await expect(billed).toBeDisabled();
    await expect(delivered).toBeEnabled();
    await expect(page.getByText('100%', { exact: true })).toHaveCount(1);

    await delivered.click();
    await expect(delivered).toBeDisabled();
    await expect.poll(() => patches).toEqual([{ per_billed: 100 }, { per_delivered: 100 }]);
    releaseDelivered();
    await expect(page.getByRole('alert')).toContainText(
      'Não foi possível atualizar o pedido. Tente novamente.'
    );
    await expect(page.getByText('100%', { exact: true })).toHaveCount(1);
    await expect(delivered).toBeEnabled();

    detail = { ...detail, status: 'Draft' };
    await page.reload();
    await expect(page.getByRole('button', { name: 'Marcar faturado' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Marcar entregue' })).toBeDisabled();
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
    await page.locator('header').getByRole('button', { name: 'Voltar aos pedidos' }).click();
    await expect(page).toHaveURL(/#\/sales-orders$/);

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

    await page.goto('/#/sales-orders');
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

    await page.goto('/#/sales-orders');
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

  test('rotas de criação, clientes, produtos e configurações continuam acessíveis', async ({
    page,
  }) => {
    const blocked = await intercept(page, async (route, url) => {
      if (url.pathname === '/api/quotation-templates') {
        return json(route, { templates: [], default_key: null });
      }
      if (url.pathname === '/api/order-templates') {
        return json(route, { data: [] });
      }
      if (url.pathname === '/api/leads-clients') {
        return json(route, {
          data: [],
          pagination: { page: 1, limit: 10, total: 0, total_pages: 0 },
        });
      }
      if (url.pathname === '/api/products') {
        return json(route, {
          data: [],
          pagination: { page: 1, limit: 10, total: 0, total_pages: 0 },
        });
      }
      if (url.pathname === '/api/settings') {
        return json(route, {
          validade_dias: 15,
          entrega: '20 dias',
          frete_padrao: '0.00',
          aliquota: '4.00',
          settings_version: 1,
          secoes: {
            schema_version: 1,
            rich_text: true,
            prazo_producao: { enabled: true, title: 'Prazo de produção' },
            pagamento: { enabled: true, title: 'Pagamento', body: 'À vista' },
            condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' },
          },
          empresa: {
            identity: { name: 'Aspen Fictícia', cnpj: '', address: '' },
            banking: { bank: '', agency: '', account: '', pix: '' },
            contacts: { phone: '', email: '' },
          },
        });
      }
      return false;
    });
    for (const [hash, heading] of [
      ['manual', 'Novo orçamento'],
      ['leads', 'Clientes'],
      ['products', 'Produtos'],
      ['settings', 'Configurações'],
    ]) {
      await page.goto(`/#/${hash}`);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await expect(page.locator('main input, main select, main button').first()).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const main = globalThis.document.querySelector('main');
            return main ? main.scrollWidth === main.clientWidth : false;
          })
        )
        .toBe(true);
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
      await page.getByRole('button', { name: 'Ativar modo escuro' }).click();
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 20, 32)');
      await page.getByRole('button', { name: 'Ativar modo claro' }).click();
    }
    expect(blocked.api).toEqual([]);
    expect(blocked.methods).toEqual([]);
    expect(blocked.external).toEqual([]);
  });
});
