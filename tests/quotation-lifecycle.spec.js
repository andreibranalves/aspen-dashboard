import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const id = 'ORC-20260012';
const token = '2026-07-01T12:00:00.000Z';
const hash = 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e';

function detail(overrides = {}) {
  return {
    id,
    quotation_id: id,
    quotation_uuid: '11111111-1111-4111-8111-111111111111',
    revision_id: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    revision_number: 1,
    status: 'Emitido',
    status_canonical: 'emitido',
    cliente: 'Cliente lifecycle',
    client_id: '33333333-3333-4333-8333-333333333333',
    validade_dias: 15,
    validade: '2026-07-16',
    data: '2026-07-01',
    pagamento: 'À vista',
    entrega: '10 dias',
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: '',
    prazo_producao: '',
    template_padrao: 'padrao',
    template_key: 'padrao',
    template_hash: hash,
    template_version_id: '55555555-5555-4555-8555-555555555555',
    template_version: 1,
    secoes: {
      schema_version: 1,
      prazo_producao: { base: { enabled: true, title: 'Prazo de produção' }, current: { enabled: true, title: 'Prazo de produção' } },
      pagamento: { base: { enabled: true, title: 'Pagamento', body: 'À vista' }, current: { enabled: true, title: 'Pagamento', body: 'À vista' } },
      condicoes_gerais: { base: { enabled: true, title: 'Condições Gerais', body: '' }, current: { enabled: true, title: 'Condições Gerais', body: '' } },
    },
    subtotal: '90.00',
    total: '90.00',
    valor: '90.00',
    concurrency_token: token,
    updated_at: token,
    items: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        sku: 'SKU-1',
        item_code: 'SKU-1',
        nome: 'Produto lifecycle',
        item_name: 'Produto lifecycle',
        qty: '10.000',
        suggested_unit_price: '9.00',
        applied_unit_price: '9.00',
        price_difference: '0.00',
        line_total: '90.00',
        manual_rate: false,
      },
    ],
    derived_expired: false,
    expiration_derived: false,
    is_expired: false,
    expirada: false,
    revision_history: [
      {
        id: 'stored-document-id-must-not-be-used',
        revision_id: '22222222-2222-4222-8222-222222222222',
        revision: 1,
        revision_number: 1,
        created_at: token,
        createdAt: token,
        validade_dias: 15,
        validity_date: '2026-07-16',
        validade: '2026-07-16',
        subtotal: '90.00',
        total: '90.00',
        valor: '90.00',
        status: 'Emitido',
        status_canonical: 'emitido',
        template_key: 'padrao',
        template_version: 1,
        template_hash: hash,
        derived_expired: false,
        expiration_derived: false,
        is_expired: false,
        expirada: false,
      },
    ],
    ...overrides,
  };
}

function deliveryView(state, publicError = null) {
  const stepState = {
    provider_accepted: 'server_ack',
    reconciling: 'reconciling',
    delivered: 'delivered',
    failed: 'failed',
  }[state] || 'queued';
  const delivered = state === 'delivered' ? 1 : 0;
  return {
    id: 'delivery-lifecycle',
    revision_id: detail().revision_id,
    business_number: id,
    client_name: 'Cliente lifecycle',
    phone: '5511999990000',
    flow_id: 'already-talking',
    flow_name: 'Já conversando',
    state,
    completion_source: state === 'delivered' ? 'provider_receipt' : null,
    public_error: publicError,
    progress: { delivered, total: 1 },
    steps: [{
      id: 'step-lifecycle',
      position: 0,
      type: 'quotation_pdf',
      state: stepState,
      attempt_count: 1,
      public_error: publicError,
      updated_at: token,
    }],
    next_attempt_at: null,
    action_deadline: null,
    reconciliation_deadline: state === 'reconciling' ? token : null,
    delivered_at: state === 'delivered' ? token : null,
    updated_at: token,
  };
}

async function routeTemplates(page) {
  await page.route('**/api/settings**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        templates: [{ key: 'padrao', name: 'Padrão', is_default: true, hash }],
      }),
    });
  });
}

test('core quotation detail accepts JSON-string section snapshots from PostgreSQL @quotations @critical', async ({ page }) => {
  await page.route('**/api/settings**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ templates: [{ key: 'padrao', name: 'Padrão', is_default: true, hash }] }),
    });
  });
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail({ secoes: JSON.stringify(detail().secoes) })),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Emitido', { exact: true }).first()).toBeVisible();
  const itemRow = page.locator('tr').filter({ hasText: 'Produto lifecycle' }).first();
  await expect(itemRow.getByText('10', { exact: true })).toBeVisible();
  await expect(itemRow.getByText('10.000', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Título - Pagamento')).toBeDisabled();
});

test('core lifecycle emission uses the current reviewed commercial fields and template @quotations @critical', async ({ page }) => {
  let authoritative = detail({ status: 'Rascunho', status_canonical: 'rascunho' });
  let issuePayload;
  let issueKey;
  let savePayload;
  await page.route('**/api/quotation-issues**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      issuePayload = request.postDataJSON();
      issueKey = request.headers()['idempotency-key'];
      authoritative = detail({ status: 'Emitido', status_canonical: 'emitido' });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          quotation_id: id,
          quotation_uuid: detail().quotation_uuid,
          revision_id: detail().revision_id,
          revision_number: 1,
          status: 'emitido',
          issued_at: token,
          valid_until: '2026-08-12',
          pdf_url: `/api/quotation-preview?id=${detail().quotation_uuid}&format=pdf`,
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
  });
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authoritative),
      });
      return;
    }
    if (request.method() === 'PUT') {
      savePayload = request.postDataJSON();
      authoritative = detail({
        status: 'Rascunho',
        status_canonical: 'rascunho',
        pagamento: savePayload.pagamento,
        entrega: savePayload.entrega,
        validade_dias: savePayload.validade_dias,
        observacoes: savePayload.observacoes,
        template_key: savePayload.template_key,
        template_version_id: savePayload.template_version_id,
        secoes: savePayload.secoes,
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    if (request.method() === 'POST') {
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'legacy emission disabled' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/settings**', async (route) => fulfillJson(route, {}));
  await page.route('**/api/quotation-templates**', async (route) => fulfillJson(route, {
    templates: [
      { key: 'padrao', name: 'Padrão', is_default: true, hash, current_version_id: '55555555-5555-4555-8555-555555555555' },
      { key: 'minimalista', name: 'Minimalista', is_default: false, hash: 'a'.repeat(64), current_version_id: '77777777-7777-4777-8777-777777777777' },
    ],
  }));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Rascunho', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Pagamento do orçamento').fill('30 dias após emissão');
  await page.getByLabel('Entrega do orçamento').fill('7 dias úteis');
  await page.getByLabel('Observações do orçamento').fill('Conteúdo revisado pelo operador');
  await page.getByLabel('Modelo do orçamento').selectOption('minimalista');
  await page.getByLabel('Título - Pagamento').fill('Pagamento revisado');
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText('Salvo.')).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Validade do orçamento').fill('42');
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText('Salvo.')).toBeVisible();
  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toHaveCount(0);
  expect(issueKey).toMatch(/^[0-9a-f-]{36}$/i);
  expect(issuePayload).toMatchObject({
    sourceQuotationId: detail().quotation_uuid,
    sourceRevisionId: detail().revision_id,
    draft: { extracted: {
      nome: 'Cliente lifecycle',
      items: [{ item_code: 'SKU-1', qty: 10 }],
      pagamento: '30 dias após emissão',
      entrega: '7 dias úteis',
      validade_dias: 42,
      observacoes: 'Conteúdo revisado pelo operador',
      template_key: 'minimalista',
      template_version_id: '77777777-7777-4777-8777-777777777777',
      secoes: { pagamento: { current: { title: 'Pagamento revisado' } } },
    } },
  });
});

test('detail reload restores durable accepted, reconciling, delivered and failed delivery states @quotations @critical', async ({ page }) => {
  const phases = [
    ['provider_accepted', 'Aceito pela Evolution'],
    ['reconciling', 'Reconciliação em andamento'],
    ['delivered', 'Entregue'],
    ['failed', 'Falhou'],
  ];
  let phaseIndex = 0;
  await page.route('**/api/quotations**', async (route) => fulfillJson(route, detail()));
  await page.route('**/api/communication-flows**', async (route) => fulfillJson(route, {
    success: true,
    selectedFlowId: 'already-talking',
    flows: [{ id: 'already-talking', name: 'Já conversando', context: 'already_talking', channel: 'whatsapp', vendor_name: 'Evolution', enabled: true, delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1, steps: [{ id: 'pdf', type: 'document', source: 'quotation_pdf' }] }],
  }));
  await page.route('**/api/whatsapp-send-status**', async (route) => {
    const [phase] = phases[phaseIndex];
    await fulfillJson(route, {
      delivery_id: 'delivery-lifecycle',
      phase,
      error: null,
      updated_at: token,
      revision_id: detail().revision_id,
      flow_id: 'already-talking',
    });
  });
  await page.route('**/api/quotation-deliveries**', async (route) => {
    const [phase] = phases[phaseIndex];
    await fulfillJson(route, deliveryView(phase));
  });
  await routeTemplates(page);
  for (phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    await page.goto(`/#/quotations/${id}`);
    await expect(page.getByText(phases[phaseIndex][1], { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar WhatsApp' })).toBeDisabled();
    if (phaseIndex < phases.length - 1) await page.reload();
  }
});

test('detail retryable status distinguishes verified PDF from generic failure @quotations @critical', async ({ page }) => {
  let pdfFailure = true;
  await page.route('**/api/quotations**', async (route) => fulfillJson(route, detail()));
  await page.route('**/api/communication-flows**', async (route) => fulfillJson(route, {
    success: true,
    selectedFlowId: 'already-talking',
    flows: [{ id: 'already-talking', name: 'Já conversando', context: 'already_talking', channel: 'whatsapp', vendor_name: 'Evolution', enabled: true, delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1, steps: [{ id: 'pdf', type: 'document', source: 'quotation_pdf' }] }],
  }));
  await page.route('**/api/whatsapp-send-status**', async (route) => fulfillJson(route, {
    delivery_id: 'delivery-lifecycle',
    phase: 'failed',
    error: pdfFailure ? 'PDF indisponível. Tentar novamente.' : 'Falha de transporte.',
    updated_at: token,
    revision_id: detail().revision_id,
    flow_id: 'already-talking',
  }));
  await page.route('**/api/quotation-deliveries**', async (route) => fulfillJson(route, deliveryView(
    'failed',
    pdfFailure ? 'PDF indisponível. Tentar novamente.' : 'Falha antes do transporte. Tentar novamente.',
  )));
  await routeTemplates(page);
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('PDF indisponível. Tentar novamente')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar WhatsApp' })).toBeDisabled();
  pdfFailure = false;
  await page.reload();
  await expect(page.getByText('Falha antes do transporte. Tentar novamente.')).toBeVisible();
  await expect(page.getByText('PDF indisponível. Tentar novamente')).toHaveCount(0);
});

test('expired detail blocks send, loss requires reason and emitted deletion remains hidden @quotations @critical', async ({ page }) => {
  let authoritative = detail({ derived_expired: true });
  const posts = [];
  await page.route('**/api/quotations**', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      authoritative = detail({ status: 'Perdido', status_canonical: 'perdido' });
    }
    await fulfillJson(route, authoritative);
  });
  await page.route('**/api/communication-flows**', async (route) => fulfillJson(route, { success: true, selectedFlowId: null, flows: [] }));
  await routeTemplates(page);
  let reason = '';
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') await dialog.accept(reason);
    else await dialog.accept();
  });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByRole('button', { name: 'Enviar WhatsApp' })).toBeDisabled();
  await expect(page.getByText('Orçamento vencido. Crie uma nova revisão.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluir' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Marcar como perdido' }).click();
  await expect(page.getByText('Informe um motivo para marcar o orçamento como perdido.')).toBeVisible();
  expect(posts).toHaveLength(0);
  reason = 'Preço';
  await page.getByRole('button', { name: 'Marcar como perdido' }).click();
  expect(posts[0]).toMatchObject({ action: 'set_status', status: 'perdido', loss_reason: 'Preço', concurrency_token: token });
});

test('core lifecycle marks sent quotations and creates a revision from issued history @quotations @critical', async ({
  page,
}) => {
  let authoritative = detail();
  const posts = [];
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authoritative),
      });
      return;
    }
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      posts.push(payload);
      if (payload.action === 'set_status')
        authoritative = detail({
          status: 'Aprovado',
          status_canonical: 'aprovado',
          revision_history: [
            detail().revision_history[0] && {
              ...detail().revision_history[0],
              status: 'Aprovado',
              status_canonical: 'aprovado',
            },
          ],
        });
      if (payload.action === 'create_revision')
        authoritative = detail({
          status: 'Rascunho',
          status_canonical: 'rascunho',
          revision_number: 2,
          revision: 2,
          revision_id: '66666666-6666-4666-8666-666666666666',
          revision_history: [
            { ...detail().revision_history[0] },
            {
              ...detail().revision_history[0],
              id: '66666666-6666-4666-8666-666666666666',
              revision_id: '66666666-6666-4666-8666-666666666666',
              revision: 2,
              revision_number: 2,
              status: 'Rascunho',
              status_canonical: 'rascunho',
            },
          ],
        });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authoritative),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, total_pages: 0 },
      }),
    });
  });
  await routeTemplates(page);
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Emitido', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Título - Pagamento')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  const modelPreview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Visualizar modelo' }).click();
  const modelPopup = await modelPreview;
  const modelUrl = new globalThis.URL(modelPopup.url());
  expect(modelUrl.pathname).toBe('/api/quotation-preview');
  expect(modelUrl.searchParams.get('id')).toBe('22222222-2222-4222-8222-222222222222');
  expect(modelUrl.searchParams.has('template_version_id')).toBe(false);
  expect(modelUrl.searchParams.has('template')).toBe(false);
  await modelPopup.close();
  const pdfPreview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  const pdfPopup = await pdfPreview;
  const pdfUrl = new globalThis.URL(pdfPopup.url());
  expect(pdfUrl.pathname).toBe('/api/quotation-preview');
  expect(pdfUrl.searchParams.get('id')).toBe('22222222-2222-4222-8222-222222222222');
  expect(pdfUrl.searchParams.get('format')).toBe('pdf');
  expect(pdfUrl.searchParams.has('template_version_id')).toBe(false);
  expect(pdfUrl.searchParams.has('template')).toBe(false);
  await pdfPopup.close();
  const historyPreview = page.waitForEvent('popup');
  await page.locator('tbody tr').filter({ hasText: 'R1' }).getByRole('button', { name: 'Visualizar', exact: true }).click();
  const historyPopup = await historyPreview;
  const historyUrl = new globalThis.URL(historyPopup.url());
  expect(historyUrl.searchParams.get('id')).toBe('22222222-2222-4222-8222-222222222222');
  await historyPopup.close();
  await page.getByRole('button', { name: 'Marcar como aprovado' }).click();
  await expect(page.getByText('Aprovado', { exact: true }).first()).toBeVisible();
  expect(posts[0]).toMatchObject({
    action: 'set_status',
    status: 'aprovado',
    concurrency_token: token,
  });

  // Re-open the terminal history entry to exercise the revision action.
  authoritative = detail({
    status: 'Aprovado',
    status_canonical: 'aprovado',
    revision_history: [
      detail().revision_history[0] && {
        ...detail().revision_history[0],
        status: 'Aprovado',
        status_canonical: 'aprovado',
      },
    ],
  });
  await page.reload();
  await page.getByRole('button', { name: 'Nova revisão' }).click();
  await expect(page.getByText('Nova revisão criada em rascunho.')).toBeVisible();
  await expect(page.getByText('Rascunho', { exact: true }).first()).toBeVisible();
  expect(posts.at(-1)).toMatchObject({
    action: 'create_revision',
    source_revision_id: '22222222-2222-4222-8222-222222222222',
    concurrency_token: token,
  });
});

function fulfillJson(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test('frontend source guard rejects removed external files, tokens, and app URLs @quotations @critical', () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const forbidden = /external-crm|external-erp|internal_mode|external_url/i;
  const externalAppUrl = /https?:\/\/[^\s"']+\/(?:app|desk)\//i;
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(filename);
    }
  };
  visit(srcRoot);
  expect(fs.existsSync(path.join(srcRoot, 'types/external-crm.ts'))).toBe(false);
  expect(fs.existsSync(path.join(srcRoot, 'lib/externalLinks.ts'))).toBe(false);
  const violations = files.flatMap((filename) => {
    const content = fs.readFileSync(filename, 'utf8');
    return forbidden.test(content) || externalAppUrl.test(content) ? [path.relative(srcRoot, filename)] : [];
  });
  expect(violations).toEqual([]);
});

test('local sales order detail has no external app link and keeps local quotation navigation @quotations @critical', async ({ page }) => {
  await page.route('**/api/sales-orders**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    const id = url.searchParams.get('id');
    await fulfillJson(route, {
      id,
      status: 'Completed',
      customer_name: 'Cliente local',
      date: '2026-07-01',
      source_quotation: id === 'LOCAL-WITH-QUOTE' ? 'ORC-LOCAL-1' : undefined,
      grand_total: 100,
      items: [{ item_code: 'SKU-1', item_name: 'Produto local', qty: 1, rate: 100, amount: 100, uom: 'und' }],
    });
  });
  await page.goto('/#/sales-orders/LOCAL-NO-QUOTE');
  await expect(page.getByText('Cliente local', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /ERP|extern/i })).toHaveCount(0);
  await expect(page.getByText('Voltar ao orçamento', { exact: true })).toHaveCount(0);

  await page.goto('/#/sales-orders/LOCAL-WITH-QUOTE');
  await expect(page.getByRole('button', { name: 'Voltar ao orçamento' }).last()).toBeVisible();
  await expect(page.getByRole('link', { name: /ERP|extern/i })).toHaveCount(0);
});

test('empty local dashboard renders zero metrics @quotations @critical', async ({ page }) => {
  await page.route('**/api/sales-dashboard**', async (route) => fulfillJson(route, {
    success: true,
    period: { label: 'Últimos 30 dias', from: '2026-06-01', to: '2026-07-01' },
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
  }));
  await page.goto('/#/dashboard');
  await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('R$ 0,00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Nenhum produto vendido no período.', { exact: true })).toBeVisible();
  await expect(page.getByText('Nenhuma venda no período.', { exact: true })).toBeVisible();
});

test('products page uses local controls without response mode metadata @quotations @critical', async ({ page }) => {
  await page.route('**/api/products**', async (route) => fulfillJson(route, {
    data: [{ sku: 'SKU-LOCAL', nome: 'Produto local', descricao: '', unidade: 'Und', ativo: true }],
    pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
  }));
  await page.goto('/#/products');
  await expect(page.getByRole('cell', { name: 'Produto local' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ativos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arquivados' })).toBeVisible();
});

test('manual quotation accepts metadata-free local responses @quotations @critical', async ({ page }) => {
  await page.route('**/api/quotation-templates**', async (route) => fulfillJson(route, {
    templates: [{ key: 'padrao', name: 'Padrão', is_default: true }],
    default_key: 'padrao',
  }));
  await page.route('**/api/leads-clients**', async (route) => fulfillJson(route, {
    data: [{ id: 'client-local', nome: 'Cliente local', email: 'local@example.com', telefone: '5511999990000', tipo: 'cliente' }],
    pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
  }));
  await page.route('**/api/products**', async (route) => fulfillJson(route, {
    data: [{ sku: 'SKU-LOCAL', nome: 'Produto local', preco_minimo: '10.00', pricing_available: true }],
    pagination: { page: 1, limit: 8, total: 1, total_pages: 1 },
  }));
  await page.route('**/api/pricing-lookup**', async (route) => fulfillJson(route, {
    success: true,
    items: [{ item_code: 'SKU-LOCAL', qty: 30, rate: '10.00' }],
  }));
  await page.route('**/api/orcamento**', async (route) => fulfillJson(route, {
    success: true,
    quotation_id: 'ORC-LOCAL-1',
    quote_id: 'quote-local-1',
    revision_id: 'revision-local-1',
    revision_number: 1,
    cliente: 'Cliente local',
    status: 'rascunho',
  }, 201));
  await page.goto('/#/manual');
  await page.getByRole('button', { name: 'Buscar cliente existente' }).click();
  await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('Cliente');
  await page.getByRole('button', { name: 'Selecionar Cliente local' }).click();
  await page.getByRole('region', { name: 'Seleção de cliente' }).getByRole('combobox').selectOption('Google Ads');
  await page.getByRole('textbox', { name: 'Buscar produto para adicionar ao orçamento' }).fill('SKU-LOCAL');
  await page.getByRole('button', { name: 'Adicionar SKU-LOCAL ao orçamento' }).click();
  await page.getByRole('button', { name: 'Criar orçamento' }).click();
  await expect(page.getByText('Rascunho persistido com sucesso', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Visualizar PDF/ })).toHaveCount(0);
});

test('empty local CRM and leads retain loading/error/retry states @quotations @critical', async ({ page }) => {
  await page.route('**/api/crm-deals**', async (route) => fulfillJson(route, { columns: [] }));
  await page.route('**/api/crm-prune-candidates**', async (route) => fulfillJson(route, { candidates: [], meta: { threshold_days: 30, protect_recent_days: 7, count: 0 } }));
  await page.goto('/#/crm');
  await expect(page.getByText('Nenhum deal no pipeline', { exact: true })).toBeVisible();

  let leadAttempts = 0;
  await page.route('**/api/leads-clients**', async (route) => {
    leadAttempts += 1;
    if (leadAttempts === 1) return fulfillJson(route, { error: 'Falha temporária.' }, 503);
    return fulfillJson(route, { data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 0 } });
  });
  await page.goto('/#/leads');
  await expect(page.getByText('Erro ao carregar clientes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByText('Nenhum cliente encontrado', { exact: true })).toBeVisible();
});

test('communication screen consumes local conversation and message IDs only @quotations @critical', async ({ page }) => {
  const conversation = {
    id: 'conversation-local-1', canonicalPhone: '5511999990000', phone: '5511999990000',
    displayLabel: 'Cliente local', displayName: 'Cliente local', identityStatus: 'verified',
    lastMessageAt: '2026-07-01T12:00:00.000Z', lastMessagePreview: 'Olá', status: 'new',
    createdAt: '2026-07-01T12:00:00.000Z', updatedAt: '2026-07-01T12:00:00.000Z',
  };
  const message = { id: 'message-local-1', conversationId: conversation.id, direction: 'inbound', type: 'text', body: 'Olá local', mediaUrl: '', timestamp: '2026-07-01T12:00:00.000Z' };
  await page.route('**/api/whatsapp-conversations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.has('messages')) return fulfillJson(route, { success: true, data: [message] });
    if (request.method() === 'GET' && url.searchParams.has('id')) return fulfillJson(route, { success: true, data: conversation });
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'sync-messages') return fulfillJson(route, { success: true, data: [message] });
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'sync') return fulfillJson(route, { success: true, data: { conversations: [conversation], syncedMessages: 1 } });
    return fulfillJson(route, { success: true, data: [conversation] });
  });
  await page.goto('/#/whatsapp-inbox');
  await expect(page.getByText('Cliente local', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Olá local', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/provider|conversationId|messageId/i);
});
