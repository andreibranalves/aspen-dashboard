import { expect, test } from '@playwright/test';

const updatedAt = '2026-08-17T12:00:00.000Z';

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function stepState(state) {
  return {
    queued: 'queued',
    processing: 'sending',
    provider_accepted: 'server_ack',
    reconciling: 'reconciling',
    retry_scheduled: 'retry_scheduled',
    needs_review: 'needs_review',
    delivered: 'delivered',
    failed: 'failed',
  }[state];
}

function delivery(state, options = {}) {
  const isDelivered = state === 'delivered';
  const delayed = options.delayed === true;
  const id = options.id || `delivery-${state}-${options.number || '1'}`;
  return {
    id,
    revision_id: options.revisionId || `revision-${options.number || '1'}`,
    business_number: options.number || `ORC-${state.toUpperCase()}`,
    client_name: options.clientName || `Cliente ${state}`,
    phone: options.phone || '5511999990000',
    flow_id: 'flow-1',
    flow_name: options.flowName || 'Fluxo comercial',
    state,
    public_error: state === 'failed' ? 'Falha antes do transporte.' : null,
    completion_source: options.completionSource ?? (isDelivered ? 'provider_receipt' : null),
    progress: { delivered: isDelivered ? 1 : 0, total: 1 },
    steps: [
      {
        id: `${id}-step-1`,
        position: 0,
        type: 'text',
        state: stepState(state),
        attempt_count: 1,
        public_error: state === 'failed' ? 'Falha antes do transporte.' : null,
        updated_at: updatedAt,
      },
    ],
    next_attempt_at: state === 'retry_scheduled' ? updatedAt : null,
    action_deadline:
      state === 'provider_accepted'
        ? delayed
          ? '2020-01-01T00:00:00.000Z'
          : '2099-01-01T00:00:00.000Z'
        : null,
    reconciliation_deadline: state === 'reconciling' ? '2099-01-01T00:00:00.000Z' : null,
    delivered_at: isDelivered ? updatedAt : null,
    updated_at: updatedAt,
    provider_message_id: 'provider-message-raw-must-not-render',
  };
}

function summary(data, overrides = {}) {
  const activeStates = new Set([
    'queued',
    'processing',
    'provider_accepted',
    'reconciling',
    'retry_scheduled',
  ]);
  return {
    active: data.filter((item) => activeStates.has(item.state)).length,
    requires_action: data.filter((item) => item.state === 'needs_review').length,
    retry_scheduled: data.filter((item) => item.state === 'retry_scheduled').length,
    delayed: data.filter((item) => item.action_deadline && item.state === 'provider_accepted').length,
    delivered_last_24_hours: data.filter((item) => item.state === 'delivered').length,
    ...overrides,
  };
}

function listResponse(data, options = {}) {
  return {
    data,
    total: options.total ?? data.length,
    page: options.page || 1,
    page_size: 25,
    summary: options.summary || summary(data),
  };
}

async function mockList(page, handler) {
  await page.route('**/api/quotation-deliveries**', (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'PATCH') return handler(route, url);
    return handler(route, url);
  });
}

test('outbox defaults to actionable work and resolves one delivery', async ({ page }) => {
  const needsReviewDelivery = delivery('needs_review', {
    number: 'ORC-NEEDS',
    clientName: 'Cliente com nome excepcionalmente longo para validar a largura da tabela',
    flowName: 'Fluxo comercial com um nome igualmente longo',
  });
  const processingDelivery = delivery('processing', {
    number: 'ORC-PROCESSING',
    clientName: 'Outro cliente com nome longo e estado diferente',
    flowName: 'Fluxo de acompanhamento prolongado',
  });
  const deliveredDelivery = delivery('delivered', { number: 'ORC-DELIVERED' });
  let firstQuery;
  let resolvedDelivery = null;

  await mockList(page, (route, url) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      expect(body.decision).toBe('confirmed_received');
      expect(body.note).toBe('Cliente confirmou recebimento por ligação.');
      resolvedDelivery = delivery('delivered', {
        id: needsReviewDelivery.id,
        number: needsReviewDelivery.business_number,
        clientName: needsReviewDelivery.client_name,
      });
      return json(route, resolvedDelivery);
    }
    if (!firstQuery) firstQuery = url.searchParams;
    return json(
      route,
      listResponse([resolvedDelivery || needsReviewDelivery, processingDelivery], {
        total: 2,
        summary: {
          active: 1,
          requires_action: 1,
          retry_scheduled: 0,
          delayed: 0,
          delivered_last_24_hours: 1,
        },
      })
    );
  });
  await page.route('**/api/communication-send-events**', (route) =>
    json(route, { success: true, items: [], total: 0, source: 'postgres' })
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/whatsapp-deliveries');
  await page.evaluate(() => globalThis.document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'Envios' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Envios', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Pendências' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Histórico' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Pendências' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('cell', { name: needsReviewDelivery.business_number, exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: processingDelivery.business_number, exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: deliveredDelivery.business_number, exact: true })).toHaveCount(0);
  const needsReviewDetails = page.getByRole('button', {
    name: 'Abrir detalhes de ORC-NEEDS, linha 1',
  });
  await needsReviewDetails.click();
  const needsReviewDrawer = page.getByRole('dialog', { name: needsReviewDelivery.id });
  await expect(needsReviewDrawer).toBeVisible();
  await expect(needsReviewDrawer.getByText('Requer revisão', { exact: true })).toBeVisible();
  await expect(needsReviewDrawer.getByText(needsReviewDelivery.flow_name)).toBeVisible();
  await expect(needsReviewDrawer.getByText('Recibo', { exact: true })).toBeVisible();
  await expect(needsReviewDrawer.getByText('—', { exact: true })).toBeVisible();
  await expect(needsReviewDrawer.getByText('provider-message-raw-must-not-render')).toHaveCount(0);
  await needsReviewDrawer.getByRole('button', { name: 'Fechar' }).click();
  const processingDetails = page.getByRole('button', {
    name: 'Abrir detalhes de ORC-PROCESSING, linha 2',
  });
  await expect(processingDetails).toBeVisible();
  await expect(page.getByText('(11) 99999-0000').first()).toBeVisible();
  const tableScroll = await page
    .getByRole('table', { name: 'Tabela de entregas WhatsApp' })
    .evaluate((table) => {
      const container = table.parentElement;
      return { clientWidth: container?.clientWidth || 0, scrollWidth: container?.scrollWidth || 0 };
    });
  expect(tableScroll.scrollWidth).toBeLessThanOrEqual(tableScroll.clientWidth + 1);
  for (const button of await page.getByRole('button', { name: /detalhes de ORC-/i }).all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
  }
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const table = page.getByRole('table', { name: 'Tabela de entregas WhatsApp' });
    await table.evaluate((element) => {
      if (element.parentElement)
        element.parentElement.scrollLeft = element.parentElement.scrollWidth;
    });
    const box = await processingDetails.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(firstQuery.get('requires_action')).toBe('true');
  expect(firstQuery.get('include_active')).toBe('true');
  expect(firstQuery.get('page')).toBe('1');
  expect(firstQuery.get('page_size')).toBe('25');

  await needsReviewDetails.click();
  const resolutionDrawer = page.getByRole('dialog', { name: needsReviewDelivery.id });
  await resolutionDrawer.getByRole('button', { name: 'Cliente confirmou recebimento' }).click();
  await page.getByLabel('Justificativa').fill('Cliente confirmou recebimento por ligação.');
  await page.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
});

test('limpar fila permite cancelar a confirmação e só então cancela tentativas pendentes', async ({
  page,
}) => {
  const pendingDelivery = delivery('retry_scheduled', { number: 'ORC-CLEAR' });
  let cleared = false;
  let clearRequests = 0;
  await page.route('**/api/quotation-deliveries**', (route) => {
    if (route.request().method() === 'POST') {
      clearRequests += 1;
      expect(route.request().postDataJSON()).toEqual({ action: 'cancel_pending' });
      cleared = true;
      return json(route, { cancelled: 1 });
    }
    return json(route, listResponse(cleared ? [] : [pendingDelivery]));
  });
  await page.goto('/#/whatsapp-deliveries');
  await expect(page.getByText('ORC-CLEAR', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar fila' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('ORC-CLEAR', { exact: true })).toBeVisible();
  expect(clearRequests).toBe(0);

  await page.getByRole('button', { name: 'Limpar fila' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Limpar fila' }).click();
  await expect(page.getByText('1 tentativa pendente cancelada.', { exact: true })).toBeVisible();
  await expect(page.getByText('ORC-CLEAR', { exact: true })).toHaveCount(0);
  expect(clearRequests).toBe(1);
});

test('browser absent while cron completes delivery leaves one durable delivered row', async ({ page, context }) => {
  let durableState = 'processing';
  let workerCalls = 0;
  let transportCalls = 0;
  let sendCalls = 0;
  const cronRow = () =>
    delivery(durableState, { number: 'ORC-CRON-COMPLETE', id: 'delivery-cron-complete' });
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCalls += 1;
    return json(route, { success: false, error: 'browser send must not run' }, 500);
  });
  await context.route('**/api/quotation-delivery-worker', (route) => {
    workerCalls += 1;
    transportCalls += 1;
    durableState = 'delivered';
    return json(route, { processed: 1, remaining: false });
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    return url.searchParams.has('id') ? json(route, cronRow()) : json(route, listResponse([cronRow()]));
  });

  await page.goto('/#/whatsapp-deliveries');
  await expect(page.getByText('ORC-CRON-COMPLETE', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel(/^Estado: Enviando\./)).toBeVisible();
  await page.getByRole('button', { name: 'Abrir detalhes de ORC-CRON-COMPLETE, linha 1' }).click();
  const drawer = page.getByRole('dialog', { name: 'delivery-cron-complete' });
  const drawerSteps = drawer.getByLabel('Passos da entrega ORC-CRON-COMPLETE');
  await expect(drawerSteps.getByText('Enviando', { exact: true })).toBeVisible();

  const cronPage = await context.newPage();
  const workerResponse = await cronPage.goto('/api/quotation-delivery-worker');
  expect(workerResponse?.status()).toBe(200);
  await expect(workerResponse).toBeTruthy();
  expect(await workerResponse.json()).toEqual({ processed: 1, remaining: false });
  await cronPage.close();

  // The list and the open detail poll the durable state: no browser reload needed.
  await expect(page.getByLabel(/^Estado: Entregue\./)).toBeVisible({ timeout: 15000 });
  await expect(drawerSteps.getByText('Entregue', { exact: true })).toBeVisible({ timeout: 15000 });

  await page.reload();
  await expect(page.getByText('ORC-CRON-COMPLETE', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel(/^Estado: Entregue\./)).toBeVisible();
  expect(workerCalls).toBe(1);
  expect(transportCalls).toBe(1);
  expect(sendCalls).toBe(0);
  expect(durableState).toBe('delivered');
});

test('filters expose Portuguese controls and query state, search, and period', async ({ page }) => {
  const deliveredDelivery = delivery('delivered', {
    number: 'ORC-DELIVERED',
    clientName: 'Maria Silva',
  });
  const processingDelivery = delivery('processing', {
    number: 'ORC-PROCESSING',
    clientName: 'João Souza',
  });
  const queries = [];

  await mockList(page, (route, url) => {
    if (route.request().method() === 'PATCH') return json(route, deliveredDelivery);
    queries.push(url.searchParams);
    if (url.searchParams.get('state') === 'delivered')
      return json(route, listResponse([deliveredDelivery]));
    if (url.searchParams.get('search') === 'Maria')
      return json(route, listResponse([deliveredDelivery]));
    return json(route, listResponse([processingDelivery]));
  });

  await page.goto('/#/whatsapp-deliveries');
  for (const label of [
    'Requer ação',
    'Em processamento',
    'Reagendado',
    'Atrasados',
    'Entregues',
    'Falhos',
  ]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  await expect(page.getByLabel('Busca')).toBeVisible();
  await expect(page.getByLabel('Data inicial')).toBeVisible();
  await expect(page.getByLabel('Data final')).toBeVisible();

  await page.getByLabel('Entregues').check();
  await expect(page.getByRole('cell', { name: deliveredDelivery.business_number, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Detalhes de ORC-DELIVERED, linha 1' }).click();
  await expect(page.getByRole('dialog', { name: deliveredDelivery.id }).getByText('Recibo do provedor')).toBeVisible();
  const deliveredQuery = queries.find((query) => query.get('state') === 'delivered');
  expect(deliveredQuery.get('requires_action')).toBe('false');
  expect(deliveredQuery.get('include_active')).toBe('false');

  await page.getByLabel('Busca').fill('Maria');
  await expect(page.getByText(deliveredDelivery.client_name, { exact: true })).toBeVisible();
  const searchQuery = queries.find((query) => query.get('search') === 'Maria');
  expect(searchQuery).toBeTruthy();

  await page.getByLabel('Data inicial').fill('01/08/2026');
  await page.getByLabel('Data final').fill('31/08/2026');
  await expect
    .poll(() =>
      queries.some(
        (query) =>
          query.get('from') === '2026-08-01' && query.get('to') === '2026-08-31T23:59:59.999Z'
      )
    )
    .toBe(true);
});

test('pagination requests the next page and delayed accepted deliveries stay actionable', async ({
  page,
}) => {
  const pageOneDelivery = delivery('processing', { number: 'ORC-PAGE-1' });
  const pageTwoDelivery = delivery('retry_scheduled', { number: 'ORC-PAGE-2' });
  const delayedDelivery = delivery('provider_accepted', { number: 'ORC-DELAYED', delayed: true });
  const pages = [];

  await mockList(page, (route, url) => {
    if (route.request().method() === 'PATCH') return json(route, delayedDelivery);
    const requestedPage = Number(url.searchParams.get('page'));
    pages.push(requestedPage);
    if (url.searchParams.get('delayed') === 'true') {
      return json(
        route,
        listResponse([delayedDelivery], {
          summary: {
            active: 1,
            requires_action: 0,
            retry_scheduled: 0,
            delayed: 1,
            delivered_last_24_hours: 0,
          },
        })
      );
    }
    return json(
      route,
      listResponse([requestedPage === 2 ? pageTwoDelivery : pageOneDelivery], {
        total: 26,
        page: requestedPage,
      })
    );
  });

  await page.goto('/#/whatsapp-deliveries');
  await expect(page.getByRole('cell', { name: pageOneDelivery.business_number, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Próxima página' }).click();
  await expect(page.getByRole('cell', { name: pageTwoDelivery.business_number, exact: true })).toBeVisible();
  expect(pages).toContain(2);

  await page.getByLabel('Atrasados').check();
  await expect(page.getByRole('cell', { name: delayedDelivery.business_number, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir detalhes de ORC-DELAYED, linha 1' }).click();
  const delayedDrawer = page.getByRole('dialog', { name: delayedDelivery.id });
  await expect(delayedDrawer.getByText(/aceitação do provedor está atrasada/i)).toBeVisible();
  await expect(delayedDrawer.getByRole('button', { name: 'Cliente confirmou recebimento' })).toBeVisible();
  await expect(
    delayedDrawer.getByRole('button', { name: 'Confirmado que não recebeu, reenviar' })
  ).toBeVisible();
});

test('empty state and API failure remain readable and actionable', async ({ page }) => {
  let mode = 'empty';
  await page.route('**/api/quotation-deliveries**', (route) => {
    if (mode === 'failure')
      return json(route, { error: 'Não foi possível consultar as entregas.' }, 503);
    return json(route, listResponse([]));
  });

  await page.goto('/#/whatsapp-deliveries');
  await expect(page.getByRole('status')).toContainText('Nenhuma entrega encontrada');

  mode = 'failure';
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível consultar as entregas.');
  await expect(page.getByRole('heading', { name: 'Envios' })).toBeVisible();
});

async function openResolvableDrawer(page, active) {
  await expect(page.getByText(active.business_number, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Abrir detalhes de ${active.business_number}, linha 1` }).click();
  const drawer = page.getByRole('dialog', { name: active.id });
  await expect(drawer).toBeVisible();
  return drawer;
}

test('a stale detail success released after PATCH cannot reopen the drawer', async ({ page }) => {
  const active = delivery('provider_accepted', {
    id: 'delivery-stale-success',
    number: 'ORC-STALE-SUCCESS',
    clientName: 'Cliente stale success',
    delayed: true,
  });
  const resolved = delivery('delivered', {
    id: active.id,
    number: active.business_number,
    clientName: active.client_name,
  });
  let patchCount = 0;
  let postCount = 0;
  let detailReads = 0;
  const staleReleased = Promise.withResolvers();
  const patchReleased = Promise.withResolvers();
  await page.route('**/api/send-whatsapp-flow', (route) => {
    postCount += 1;
    return json(route, { error: 'unexpected provider POST' }, 500);
  });
  await page.route('**/api/communication-send-events**', (route) =>
    json(route, { success: true, items: [], total: 0, source: 'postgres' })
  );
  await page.route('**/api/quotation-deliveries**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'PATCH') {
      patchCount += 1;
      await patchReleased.promise;
      return json(route, resolved);
    }
    if (url.searchParams.has('id')) {
      detailReads += 1;
      await staleReleased.promise;
      return json(route, active);
    }
    return json(route, listResponse([active]));
  });

  await page.goto('/#/whatsapp-deliveries');
  const drawer = await openResolvableDrawer(page, active);
  // Wait for the active-state detail poll to start and stay in flight.
  await expect.poll(() => detailReads, { timeout: 15000 }).toBeGreaterThan(0);

  await drawer.getByRole('button', { name: 'Cliente confirmou recebimento' }).click();
  await page.getByLabel('Justificativa').fill('Cliente confirmou recebimento por ligação.');
  await page.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect.poll(() => patchCount).toBe(1);

  // Release the resolution first, then the stale provider_accepted detail read.
  patchReleased.resolve();
  staleReleased.resolve();

  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cliente confirmou recebimento' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(patchCount).toBe(1);
  expect(postCount).toBe(0);
});

test('a stale detail rejection released after PATCH cannot restore controls or an error', async ({ page }) => {
  const active = delivery('provider_accepted', {
    id: 'delivery-stale-rejection',
    number: 'ORC-STALE-REJECTION',
    clientName: 'Cliente stale rejection',
    delayed: true,
  });
  const resolved = delivery('delivered', {
    id: active.id,
    number: active.business_number,
    clientName: active.client_name,
  });
  let patchCount = 0;
  let postCount = 0;
  let detailReads = 0;
  const staleReleased = Promise.withResolvers();
  const patchReleased = Promise.withResolvers();
  await page.route('**/api/send-whatsapp-flow', (route) => {
    postCount += 1;
    return json(route, { error: 'unexpected provider POST' }, 500);
  });
  await page.route('**/api/communication-send-events**', (route) =>
    json(route, { success: true, items: [], total: 0, source: 'postgres' })
  );
  await page.route('**/api/quotation-deliveries**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'PATCH') {
      patchCount += 1;
      await patchReleased.promise;
      return json(route, resolved);
    }
    if (url.searchParams.has('id')) {
      detailReads += 1;
      await staleReleased.promise;
      return json(route, { error: 'detail unavailable' }, 503);
    }
    return json(route, listResponse([active]));
  });

  await page.goto('/#/whatsapp-deliveries');
  const drawer = await openResolvableDrawer(page, active);
  await expect.poll(() => detailReads, { timeout: 15000 }).toBeGreaterThan(0);

  await drawer.getByRole('button', { name: 'Cliente confirmou recebimento' }).click();
  await page.getByLabel('Justificativa').fill('Cliente confirmou recebimento por ligação.');
  await page.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect.poll(() => patchCount).toBe(1);

  patchReleased.resolve();
  staleReleased.resolve();

  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cliente confirmou recebimento' })).toHaveCount(0);
  expect(patchCount).toBe(1);
  expect(postCount).toBe(0);
});

test('a held foreground list GET released after PATCH cannot restore the stale row or loading', async ({
  page,
}) => {
  const active = delivery('needs_review', {
    id: 'delivery-foreground-stale',
    number: 'ORC-FG-STALE',
    clientName: 'Cliente foreground stale',
  });
  const resolved = delivery('delivered', {
    id: active.id,
    number: active.business_number,
    clientName: active.client_name,
  });
  let heldCount = 0;
  let holdForeground = false;
  let patchCount = 0;
  let postCount = 0;
  const heldReleased = Promise.withResolvers();
  await page.route('**/api/send-whatsapp-flow', (route) => {
    postCount += 1;
    return json(route, { error: 'unexpected provider POST' }, 500);
  });
  await page.route('**/api/communication-send-events**', (route) =>
    json(route, { success: true, items: [], total: 0, source: 'postgres' })
  );
  await page.route('**/api/quotation-deliveries**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'PATCH') {
      patchCount += 1;
      return json(route, resolved);
    }
    if (url.searchParams.has('id')) {
      return json(route, active);
    }
    // Initial (and StrictMode-duplicated) loads resolve immediately; only the
    // foreground Atualizar GET requested after the flag is held.
    if (!holdForeground) return json(route, listResponse([active]));
    heldCount += 1;
    await heldReleased.promise;
    return json(route, listResponse([active]));
  });

  await page.goto('/#/whatsapp-deliveries');
  await expect(page.getByText(active.business_number, { exact: true })).toBeVisible();

  holdForeground = true;
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect.poll(() => heldCount, { timeout: 15000 }).toBeGreaterThan(0);

  const table = page.getByRole('table', { name: 'Tabela de entregas WhatsApp' });
  const drawer = page.getByRole('dialog', { name: active.id });
  await page
    .getByRole('button', { name: `Abrir detalhes de ${active.business_number}, linha 1` })
    .click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Cliente confirmou recebimento' }).click();
  await page.getByLabel('Justificativa').fill('Cliente confirmou recebimento por ligação.');
  await page.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect.poll(() => patchCount).toBe(1);

  // The resolution is authoritative and finalizes loading while the stale GET is
  // still held.
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await expect(table).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Atualizar' })).toBeEnabled();

  // Releasing the old GET carrying needs_review must change neither the row, nor
  // the error banner, nor the loading state.
  heldReleased.resolve();
  await expect(page.getByText('Requer revisão', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(table).toHaveAttribute('aria-busy', 'false');
  expect(patchCount).toBe(1);
  expect(postCount).toBe(0);
});
