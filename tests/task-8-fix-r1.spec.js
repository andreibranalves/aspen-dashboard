import { expect, test } from '@playwright/test';
import {
  withCanonicalQuotationDetail,
  withCanonicalQuotationListRow,
} from './fixtures/quotation-detail.js';

const revisionId = '22222222-2222-4222-8222-222222222222';
const quotationId = 'ORC-20260001';
const quotationUuid = '11111111-1111-4111-8111-111111111111';
const TEST_ORIGIN = process.env.BASE_URL || 'http://localhost:5173';
const controlledOrderPages = new WeakMap();

test.beforeEach(async ({ page }, testInfo) => {
  if (!/pedidos?|pedido|exportação|paginação|stale|métricas ausentes/i.test(testInfo.title)) {
    return;
  }
  const state = { unexpectedApi: [], unexpectedMethods: [], external: [] };
  page.on('request', (request) => {
    const url = new globalThis.URL(request.url());
    if (url.origin === TEST_ORIGIN && url.pathname.startsWith('/api/')) {
      if (!['GET', 'PATCH'].includes(request.method())) {
        state.unexpectedMethods.push(`${request.method()} ${url.href}`);
      }
    }
  });
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.origin !== TEST_ORIGIN) {
      state.external.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    state.unexpectedApi.push(url.href);
    await route.abort('blockedbyclient');
  });
  controlledOrderPages.set(page, state);
});

test.afterEach(({ page }) => {
  const state = controlledOrderPages.get(page);
  if (!state) return;
  expect(state.unexpectedApi).toEqual([]);
  expect(state.unexpectedMethods).toEqual([]);
});

function json(route, body, status = 200, contentType = 'application/json') {
  return route.fulfill({ status, contentType, body: JSON.stringify(body) });
}

function issuedQuotationDetail() {
  return withCanonicalQuotationDetail({
    id: quotationId,
    quotation_id: quotationId,
    quotation_name: quotationId,
    quotation_uuid: quotationUuid,
    revision_id: revisionId,
    revision: 1,
    revision_number: 1,
    status: 'Emitido',
    status_canonical: 'emitido',
    cliente: 'Cliente envio',
    client_id: '33333333-3333-4333-8333-333333333333',
    cliente_snapshot: {
      id: '33333333-3333-4333-8333-333333333333',
      nome: 'Cliente envio',
      email: 'cliente@example.test',
      telefone: '5511999990000',
    },
    validade_dias: 15,
    validade: '2026-08-28',
    data: '2026-08-13',
    pagamento: '',
    entrega: '',
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: '',
    prazo_producao: '',
    template_key: 'padrao',
    template_hash: 'a'.repeat(64),
    template_version_id: null,
    template_version: null,
    secoes: {
      schema_version: 1,
      prazo_producao: {
        base: { enabled: true, title: 'Prazo de produção', value: '' },
        current: { enabled: true, title: 'Prazo de produção', value: '' },
      },
      pagamento: {
        base: { enabled: true, title: 'Pagamento', body: '' },
        current: { enabled: true, title: 'Pagamento', body: '' },
      },
      condicoes_gerais: {
        base: { enabled: true, title: 'Condições gerais', body: '' },
        current: { enabled: true, title: 'Condições gerais', body: '' },
      },
    },
    items: [{
      item_code: 'SKU-1',
      sku: 'SKU-1',
      item_name: 'Produto',
      nome: 'Produto',
      qty: '10.000',
      suggested_unit_price: '9.00',
      applied_unit_price: '9.00',
      price_difference: '0.00',
      line_total: '90.00',
      manual_rate: false,
    }],
    subtotal: '90.00',
    total: '90.00',
    valor: '90.00',
    revision_history: [],
    derived_expired: false,
    concurrency_token: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:00.000Z',
    email_sent: false,
    email_sent_at: null,
  });
}

test('lista de orçamentos abre o snapshot PostgreSQL da revisão clicada @quotations @critical', async ({
  page,
}) => {
  const requests = [];
  await page.route('**/api/quotations**', (route) =>
    json(route, {
      data: [
        withCanonicalQuotationListRow({
          id: quotationId,
          quotation_id: quotationId,
          quotation_uuid: quotationUuid,
          revision_id: revisionId,
          revision_number: 1,
          cliente: 'Cliente local',
          client_id: '33333333-3333-4333-8333-333333333333',
          data: '2026-08-10',
          validade: '2026-08-25',
          validade_dias: 15,
          valor: '90.00',
          subtotal: '90.00',
          total: '90.00',
          frete: '0.00',
          derived_expired: false,
          concurrency_token: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-10T00:00:00.000Z',
          email_sent: false,
          status: 'Enviado',
          status_canonical: 'emitido',
        }),
      ],
      pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
      status_summary: { Rascunho: 1, Enviado: 2, Aprovado: 3, Perdido: 4 },
    })
  );
  await page.route('**/api/quotation-preview**', (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>snapshot</p>' });
  });

  await page.goto('/#/quotations');
  await expect(page.getByText(quotationId, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Emitido', { exact: true }).first()).toContainText('Emitido');
  await expect(page.getByRole('button', { name: 'Emitido · 2', exact: true })).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: `Ações do orçamento ${quotationId}` }).click();
  await page.locator(`[popover][aria-label="Ações do orçamento ${quotationId}"]`)
    .getByRole('link', { name: 'Visualizar PDF' }).click();
  const opened = await popup;
  await opened.waitForURL('**/api/quotation-preview**');
  const url = new globalThis.URL(opened.url());
  expect(url.pathname).toBe('/api/quotation-preview');
  expect(url.searchParams.get('id')).toBe(revisionId);
  expect(url.searchParams.get('format')).toBe('pdf');
  expect(url.pathname).not.toBe('/api/view');
  await opened.close();
});
test('pedidos usa métricas canônicas, nomes neutros e somente status suportados @quotations @critical', async ({
  page,
}) => {
  const sentStatuses = [];
  await page.route('**/api/sales-dashboard**', (route) =>
    json(route, {
      success: true,
      period: { label: '30 dias', from: '2026-07-11', to: '2026-08-10' },
      summary: {
        total_revenue: 1234.5,
        revenue_delta: 12.5,
        orders_count: 2,
        orders_delta: 10,
        avg_ticket: 617.25,
        avg_ticket_delta: -3.5,
        open_orders: 1,
        conversion_rate: 0.5,
        conversion_delta: -2.5,
      },
    })
  );
  await page.route('**/api/sales-orders**', (route) => {
    const url = new globalThis.URL(route.request().url());
    const status = url.searchParams.get('status');
    if (status) sentStatuses.push(status);
    return json(route, {
      success: true,
      items: [
        {
          id: 'PED-2026-0001',
          date: '2026-08-10',
          customer_name: 'Cliente pedido',
          customer: '11111111-1111-4111-8111-111111111111',
          grand_total: 1234.5,
          rounded_total: 1234.5,
          status: 'Completed',
          delivery_date: '',
          per_delivered: 0,
          per_billed: 0,
          source_quotation: null,
        },
      ],
      page: 1,
      limit: 10,
      total: 1,
      has_more: false,
    });
  });

  await page.goto('/#/sales-orders');
  await page.getByText('Resumo comercial · últimos 30 dias', { exact: true }).click();
  await expect(page.getByText('R$ 1.234,50').first()).toBeVisible();
  await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('R$ 617,25').first()).toBeVisible();
  await expect(page.getByText('+12.5% vs período anterior', { exact: true })).toBeVisible();
  await expect(page.getByText('-3.5% vs período anterior', { exact: true })).toBeVisible();
  const statusSelect = page.getByLabel('Filtrar por status');
  const optionValues = await statusSelect
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value));
  expect(optionValues).not.toContain('On Hold');
  expect(optionValues).not.toContain('To Pay');
  for (const value of optionValues.filter(Boolean)) {
    await statusSelect.selectOption(value);
  }
  await expect.poll(() => sentStatuses.length).toBe(optionValues.filter(Boolean).length);
  expect(new Set(sentStatuses)).toEqual(new Set(optionValues.filter(Boolean)));
  await expect(page.getByText('Cliente pedido', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('11111111-1111-4111-8111-111111111111', { exact: true })).toHaveCount(
    0
  );
});

test('detalhe de pedido não expõe UUID quando customer_name falta @quotations @critical', async ({
  page,
}) => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  await page.route('**/api/sales-orders**', (route) =>
    json(route, {
      id: 'PED-2026-0001',
      status: 'Completed',
      customer: uuid,
      customer_name: null,
      date: '2026-08-10',
      items: [],
    })
  );
  await page.goto('/#/sales-orders/PED-2026-0001');
  await expect(page.getByText('Cliente não identificado', { exact: true })).toBeVisible();
  await expect(page.getByText(uuid, { exact: true })).toHaveCount(0);
});

test('detalhe de pedido bloqueia estados finais e reporta PATCH com sucesso ou falha', async ({
  page,
}) => {
  const patchPayloads = [];
  let detail = {
    id: 'PED-2026-0006',
    status: 'To Deliver',
    customer_name: 'Cliente atualização',
    date: '2026-08-10',
    delivery_date: '2026-08-20',
    per_billed: 0,
    per_delivered: 0,
    items: [],
  };
  await page.route('**/api/sales-orders**', async (route) => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON();
      patchPayloads.push(payload);
      if (payload.per_billed === 100) {
        detail = { ...detail, per_billed: 100 };
        return json(route, detail);
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Falha ao atualizar pedido.' }),
      });
      return;
    }
    return json(route, detail);
  });

  await page.goto('/#/sales-orders/PED-2026-0006');
  const billed = page.getByRole('button', { name: 'Marcar faturado' });
  const delivered = page.getByRole('button', { name: 'Marcar entregue' });
  await expect(billed).toBeEnabled();
  await expect(delivered).toBeEnabled();

  await billed.click();
  await expect(billed).toBeDisabled();
  await expect.poll(() => patchPayloads).toEqual([{ per_billed: 100 }]);

  await delivered.click();
  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível atualizar o pedido. Tente novamente.'
  );
  await expect.poll(() => patchPayloads).toHaveLength(2);

  detail = { ...detail, status: 'Draft' };
  await page.reload();
  await expect(page.getByRole('button', { name: 'Marcar faturado' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Marcar entregue' })).toBeDisabled();
});

test('pedidos agrupa exportações e envia os filtros atuais', async ({ page }) => {
  const exportUrls = [];
  await page.route('**/api/sales-dashboard**', (route) =>
    json(route, {
      success: true,
      summary: {
        total_revenue: 100,
        revenue_delta: null,
        orders_count: 1,
        orders_delta: null,
        avg_ticket: 100,
        avg_ticket_delta: null,
        open_orders: 1,
        conversion_rate: 0,
        conversion_delta: null,
      },
    })
  );
  await page.route('**/api/sales-orders**', (route) =>
    json(route, {
      success: true,
      items: [
        {
          id: 'PED-2026-0007',
          date: '2026-08-10',
          customer_name: 'Cliente exportação',
          grand_total: 100,
          status: 'Completed',
          delivery_date: '2026-08-20',
          per_delivered: 0,
          per_billed: 0,
          source_quotation: null,
        },
      ],
      page: 1,
      limit: 10,
      has_more: false,
    })
  );
  await page.route('**/api/commercial-exports**', (route) => {
    exportUrls.push(route.request().url());
    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="pedidos.csv"',
      },
      body: 'id;status\nPED-2026-0007;Completed',
    });
  });

  await page.goto('/#/sales-orders?period=7d&status=Completed&search=Cliente');
  await expect(page.getByText('PED-2026-0007', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exportar pedidos' })).toBeVisible();
  await page.getByRole('button', { name: 'Exportar pedidos' }).click();
  await expect.poll(() => exportUrls.length).toBe(1);

  const url = new globalThis.URL(exportUrls[0]);
  expect(url.searchParams.get('resource')).toBe('sales-orders');
  expect(url.searchParams.get('period')).toBe('7d');
  expect(url.searchParams.get('status')).toBe('Completed');
  expect(url.searchParams.get('search')).toBe('Cliente');
});

test('volta do pedido para a lista preservando o contexto e aceita entrada direta', async ({
  page,
}) => {
  const detail = {
    id: 'PED-2026-0008',
    status: 'Completed',
    customer_name: 'Cliente com filtros',
    date: '2026-08-10',
    items: [],
  };
  await page.route('**/api/sales-dashboard**', (route) =>
    json(route, {
      success: true,
      summary: {
        total_revenue: 0,
        revenue_delta: null,
        orders_count: 0,
        orders_delta: null,
        avg_ticket: 0,
        avg_ticket_delta: null,
        open_orders: 0,
        conversion_rate: 0,
        conversion_delta: null,
      },
    })
  );
  await page.route('**/api/sales-orders**', (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.has('id')) return json(route, detail);
    return json(route, {
      success: true,
      items: [
        {
          id: detail.id,
          date: detail.date,
          customer_name: detail.customer_name,
          grand_total: 100,
          status: detail.status,
          delivery_date: '2026-08-20',
          per_delivered: 0,
          per_billed: 0,
          source_quotation: null,
        },
      ],
      has_more: false,
    });
  });

  await page.goto('/#/sales-orders?page=3&limit=25&period=7d&status=Completed&search=Cliente');
  await page.getByText(detail.id, { exact: true }).first().click();
  await expect(page.getByText('Cliente com filtros', { exact: true }).first()).toBeVisible();
  await page.locator('header').getByRole('button', { name: 'Voltar aos pedidos' }).click();
  await expect(page).toHaveURL(
    /#\/sales-orders\?page=3&limit=25&period=7d&status=Completed&search=Cliente$/
  );

  await page.goto('/#/dashboard');
  await page.goto('/#/sales-orders/PED-2026-0008');
  await expect(page.getByText('Cliente com filtros', { exact: true }).first()).toBeVisible();
  await page.locator('header').getByRole('button', { name: 'Voltar aos pedidos' }).click();
  await expect(page).toHaveURL(/#\/sales-orders$/);
});

test('paginação usa apenas has_more e exportação fecha com Escape restaurando foco', async ({
  page,
}) => {
  const requests = [];
  await page.route('**/api/sales-dashboard**', (route) =>
    json(route, {
      success: true,
      summary: {
        total_revenue: 100,
        revenue_delta: null,
        orders_count: 1,
        orders_delta: null,
        avg_ticket: 100,
        avg_ticket_delta: null,
        open_orders: 1,
        conversion_rate: 0,
        conversion_delta: null,
      },
    })
  );
  await page.route('**/api/sales-orders**', (route) => {
    const url = new globalThis.URL(route.request().url());
    const pageNumber = Number(url.searchParams.get('page') || 1);
    requests.push(pageNumber);
    return json(route, {
      success: true,
      items: [
        {
          id: `PED-2026-000${pageNumber}`,
          date: '2026-08-10',
          customer_name: 'Cliente paginação',
          grand_total: 100,
          status: 'Completed',
          delivery_date: '2026-08-20',
          per_delivered: 0,
          per_billed: 0,
          source_quotation: null,
        },
      ],
      page: pageNumber,
      limit: 10,
      has_more: pageNumber < 3,
    });
  });
  await page.route('**/api/commercial-exports**', async (route) => {
    if (route.request().url().includes('sales-order-items')) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="pedidos.csv"',
      },
      body: 'id;status\nPED-2026-0001;Completed',
    });
  });

  await page.goto('/#/sales-orders?page=2');
  await expect(page.getByText('PED-2026-0002', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Página 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Página 2 de 3', { exact: true })).toHaveCount(0);

  const next = page.getByRole('button', { name: 'Próximo ›' });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByText('PED-2026-0003', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Página 3', { exact: true })).toBeVisible();
  await expect(next).toBeDisabled();

  const exportTrigger = page.getByRole('button', { name: 'Exportar', exact: true });
  await exportTrigger.click();
  await expect(page.getByRole('button', { name: 'Exportar pedidos' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sales-order-export-menu')).toBeHidden();
  await expect(exportTrigger).toBeFocused();

  await exportTrigger.click();
  const ordersExport = page.getByRole('button', { name: 'Exportar pedidos' });
  await ordersExport.click();
  await expect.poll(() => requests.at(-1)).toBe(3);

  await page.getByRole('button', { name: 'Exportar itens' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível gerar a exportação. Tente novamente.'
  );
});

test('exportação pendente mantém a ação desabilitada', async ({ page }) => {
  await page.route('**/api/sales-dashboard**', (route) =>
    json(route, {
      success: true,
      summary: {
        total_revenue: 100,
        revenue_delta: null,
        orders_count: 1,
        orders_delta: null,
        avg_ticket: 100,
        avg_ticket_delta: null,
        open_orders: 1,
        conversion_rate: 0,
        conversion_delta: null,
      },
    })
  );
  await page.route('**/api/sales-orders**', (route) =>
    json(route, {
      success: true,
      items: [
        {
          id: 'PED-2026-0009',
          date: '2026-08-10',
          customer_name: 'Cliente exportação pendente',
          grand_total: 100,
          status: 'Completed',
          delivery_date: '2026-08-20',
          per_delivered: 0,
          per_billed: 0,
          source_quotation: null,
        },
      ],
      has_more: false,
    })
  );
  await page.route('**/api/commercial-exports**', () => new Promise(() => {}));

  await page.goto('/#/sales-orders');
  await expect(page.getByText('PED-2026-0009', { exact: true }).first()).toBeVisible();
  const exportTrigger = page.getByRole('button', { name: 'Exportar', exact: true });
  await exportTrigger.click();
  const ordersExport = page.locator('#sales-order-export-menu button').first();
  await ordersExport.click();
  await expect(ordersExport).toContainText('Exportando…');
  await expect(ordersExport).toBeDisabled();
});

test('lista ignora resposta stale quando uma busca mais nova termina primeiro', async ({
  page,
}) => {
  await page.route('**/api/sales-dashboard**', (route) =>
    json(route, {
      success: true,
      summary: {
        total_revenue: 0,
        revenue_delta: null,
        orders_count: 0,
        orders_delta: null,
        avg_ticket: 0,
        avg_ticket_delta: null,
        open_orders: 0,
        conversion_rate: 0,
        conversion_delta: null,
      },
    })
  );
  await page.route('**/api/sales-orders**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.get('search') !== 'novo') {
      await new Promise(() => {});
      return;
    }
    return json(route, {
      success: true,
      items: [
        {
          id: 'PED-2026-0010',
          date: '2026-08-10',
          customer_name: 'Cliente novo',
          grand_total: 100,
          status: 'Completed',
          delivery_date: '2026-08-20',
          per_delivered: 0,
          per_billed: 0,
          source_quotation: null,
        },
      ],
      has_more: false,
    });
  });

  await page.goto('/#/sales-orders');
  await page.getByLabel('Buscar pedidos').fill('novo');
  await expect(page.getByText('PED-2026-0010', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Cliente novo', { exact: true }).first()).toBeVisible();
});

test('envio parcialmente aceito fica em reconciliação sem reenvio @quotations @critical', async ({
  page,
}) => {
  let sendCount = 0;
  await page.route('**/api/quotation-templates**', (route) =>
    json(route, {
      templates: [
        { key: 'padrao', name: 'Padrão', is_default: true, current_version_id: revisionId },
      ],
      default_key: 'padrao',
    })
  );
  await page.route('**/api/quotations**', (route) => {
    const url = new globalThis.URL(route.request().url());
    return json(
      route,
      route.request().method() === 'GET' && url.searchParams.has('id')
        ? issuedQuotationDetail()
        : { data: [] }
    );
  });
  await page.route('**/api/communication-flows**', (route) =>
    json(route, {
      success: true,
      flows: [
        {
          id: 'flow-test',
          name: 'Fluxo de teste',
          context: 'manual',
          channel: 'whatsapp',
          vendor_name: 'Juliana',
          enabled: true,
          delay_min_seconds: 0,
          delay_max_seconds: 0,
          max_media_per_product_group: 1,
          steps: [{ id: 'step-1', type: 'text', template: 'Olá' }],
        },
      ],
      selectedFlowId: 'flow-test',
    })
  );
  await page.route('**/api/extract**', (route) =>
    json(route, {
      orders: [
        {
          nome: 'Cliente envio',
          email: 'cliente@example.test',
          telefone: '11999990000',
          origem: 'Google Ads',
          items: [{ item_code: 'SKU-1', qty: 10 }],
        },
      ],
    })
  );
  await page.route('**/api/pricing-lookup**', (route) =>
    json(route, { success: true, items: [{ rate: 9, item_name: 'Produto' }] })
  );
  await page.route('**/api/orcamento**', (route) =>
    json(route, {
      success: true,
      quotation_id: 'ORC-20260001',
      quotation_name: 'ORC-20260001',
      quotation_uuid: quotationUuid,
      revision_id: revisionId,
      quote_revision_id: revisionId,
      revision_number: 1,
      concurrency_token: '2026-08-13T00:00:00.000Z',
    })
  );
  await page.route('**/api/quotation-issues**', (route) =>
    json(route, {
      quotationId: quotationUuid,
      businessNumber: quotationId,
      revisionId,
      revisionNumber: 1,
      status: 'emitido',
      issuedAt: '2026-08-13T00:00:00.000Z',
      validUntil: '2026-08-28',
      pdfUrl: `/api/quotation-preview?id=${quotationUuid}&format=pdf`,
    })
  );
  await page.route('**/api/send-whatsapp-flow**', (route) => {
    sendCount += 1;
    return json(
      route,
      {
        success: true,
        delivery_id: 'delivery-task-8',
        send_status: 'provider_accepted',
        revision_id: revisionId,
        flow_id: 'flow-test',
        delivery: {
          id: 'delivery-task-8',
          revision_id: revisionId,
          business_number: quotationId,
          client_name: 'Cliente envio',
          flow_id: 'flow-test',
          flow_name: 'Fluxo de teste',
          state: 'provider_accepted',
          completion_source: null,
          public_error: 'O transporte foi aceito e aguarda reconciliação.',
          progress: { delivered: 0, total: 1 },
          steps: [
            {
              id: 'step-task-8',
              position: 0,
              type: 'text',
              state: 'server_ack',
              attempt_count: 1,
              public_error: null,
              updated_at: '2026-08-13T12:00:00.000Z',
            },
          ],
          next_attempt_at: null,
          action_deadline: null,
          reconciliation_deadline: null,
          delivered_at: null,
          updated_at: '2026-08-13T12:00:00.000Z',
        },
      },
      202
    );
  });
  await page.route('**/api/quotation-deliveries**', (route) =>
    json(route, { error: 'not found' }, 404)
  );

  await page.goto('/#/auto');
  await page.locator('textarea').first().fill('10 produtos');
  await page.getByRole('button', { name: 'Extrair' }).click();
  await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
  const send = page.getByRole('button', { name: 'Enviar WhatsApp' });
  await expect(send).toBeVisible({ timeout: 10000 });
  await send.click();
  await expect(page.getByText('Aceito', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  const acceptedButton = page.getByRole('button', { name: 'Enviar WhatsApp' });
  await expect(acceptedButton).toBeVisible();
  await expect(acceptedButton).toBeDisabled();
  expect(sendCount).toBe(1);
  await acceptedButton.click({ force: true });
  expect(sendCount).toBe(1);
});

test('projeções locais descartam marcadores proibidos de cliente e cotação @quotations @critical', async ({
  page,
}) => {
  const marker = 'FORBIDDEN_MARKER';
  await page.route('**/api/leads-clients**', (route) =>
    json(route, {
      data: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          nome: 'Cliente legítimo',
          provider_marker: marker,
        },
      ],
      pagination: { page: 1, limit: 10, total_pages: 1, total: 1 },
    })
  );
  await page.route('**/api/client-detail**', (route) =>
    json(route, {
      id: '33333333-3333-4333-8333-333333333333',
      nome: 'Cliente legítimo',
      display_name: 'Cliente legítimo',
      latest_quotation: { name: quotationId, provider_marker: marker },
      deal: { name: 'Negócio local', raw_payload: marker },
      provider_marker: marker,
    })
  );
  await page.route('**/api/quotations**', (route) =>
    json(
      route,
      withCanonicalQuotationDetail({
        id: quotationId,
        quotation_id: quotationId,
        quotation_name: quotationId,
        quotation_uuid: '11111111-1111-4111-8111-111111111111',
        revision_id: revisionId,
        revision: 1,
        revision_number: 1,
        status: 'Enviado',
        status_canonical: 'emitido',
        cliente: 'Cliente legítimo',
        client_id: '33333333-3333-4333-8333-333333333333',
        cliente_snapshot: { id: '33333333-3333-4333-8333-333333333333', nome: 'Cliente legítimo' },
        data: '2026-08-10',
        validade: '2026-08-25',
        validade_dias: 15,
        pagamento: '',
        entrega: '',
        frete_padrao: '0.00',
        frete: '0.00',
        observacoes: '',
        prazo_producao: '',
        template_key: 'padrao',
        template_padrao: 'padrao',
        template_hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e',
        template_version_id: null,
        template_version: null,
        secoes: {
          schema_version: 1,
          prazo_producao: {
            base: { enabled: true, title: 'Prazo' },
            current: { enabled: true, title: 'Prazo' },
          },
          pagamento: {
            base: { enabled: true, title: 'Pagamento', body: '' },
            current: { enabled: true, title: 'Pagamento', body: '' },
          },
          condicoes_gerais: {
            base: { enabled: true, title: 'Condições', body: '' },
            current: { enabled: true, title: 'Condições', body: '' },
          },
        },
        items: [
          {
            item_code: 'SKU-1',
            item_name: 'Produto legítimo',
            sku: 'SKU-1',
            nome: 'Produto legítimo',
            qty: '1.000',
            quantidade: '1.000',
            suggested_unit_price: '9.00',
            preco_sugerido: '9.00',
            applied_unit_price: '9.00',
            preco_aplicado: '9.00',
            rate: '9.00',
            price_difference: '0.00',
            diferenca_preco: '0.00',
            line_total: '9.00',
            total_linha: '9.00',
            manual_rate: false,
            provider_marker: marker,
          },
        ],
        subtotal: '9.00',
        total: '9.00',
        valor: '9.00',
        revision_history: [],
        derived_expired: false,
        expiration_derived: false,
        is_expired: false,
        expirada: false,
        concurrency_token: '2026-08-10T00:00:00.000Z',
        updated_at: '2026-08-10T00:00:00.000Z',
        email_sent: false,
        email_sent_at: null,
        provider_marker: marker,
        raw_payload: marker,
      })
    )
  );
  await page.route('**/api/quotation-templates**', (route) => json(route, { templates: [] }));

  await page.goto('/#/leads');
  await expect(page.getByText('Cliente legítimo', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByRole('row').filter({ hasText: 'Produto legítimo' })).toBeVisible();
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  await expect(page.locator('a[href="https://evil.test"]')).toHaveCount(0);
});

test('métricas ausentes ou contagens inválidas exibem erro e não inventam zeros @quotations @critical', async ({
  page,
}) => {
  let summary = {
    total_revenue: 0,
    revenue_delta: 0,
    orders_count: 0,
    orders_delta: 0,
    avg_ticket: 0,
    avg_ticket_delta: 0,
    open_orders: 0,
    conversion_rate: 0,
    conversion_delta: 0,
  };
  await page.route('**/api/sales-dashboard**', (route) => json(route, { success: true, summary }));
  await page.route('**/api/sales-orders**', (route) =>
    json(route, { success: true, items: [], has_more: false })
  );
  await page.goto('/#/sales-orders');
  await page.getByText('Resumo comercial · últimos 30 dias', { exact: true }).click();
  // sem pedidos, valores monetários desconhecidos usam traço em vez de inventar zero
  await expect(page.getByText('Receita').locator('..')).toContainText('—');
  await expect(page.getByText('Ticket Médio').locator('..')).toContainText('—');
  for (const invalid of [
    { ...summary, open_orders: undefined },
    { ...summary, orders_count: '0' },
    { ...summary, orders_count: -1 },
    { ...summary, orders_count: 1.5 },
  ]) {
    summary = invalid;
    await page.reload();
    await page.getByText('Resumo comercial · últimos 30 dias', { exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Tentar novamente');
    await expect(page.getByText('R$ 0,00')).toHaveCount(0);
  }
});
