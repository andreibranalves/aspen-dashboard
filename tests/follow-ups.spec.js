import { expect, test } from '@playwright/test';

const timestamp = '2026-08-20T12:00:00.000Z';
const version = 'a'.repeat(64);

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function followUp(view, options = {}) {
  const number = options.number || `ORC-${view.toUpperCase()}`;
  return {
    quotation_id: options.quotationId || `quotation-${view}`,
    revision_id: `revision-${view}`,
    delivery_id: `delivery-${view}`,
    business_number: number,
    client_name: options.clientName || `Cliente ${view}`,
    amount: '1250.00',
    instance: 'instance-1',
    provider_conversation_id: '5511999990000@s.whatsapp.net',
    canonical_phone: '5511999990000',
    delivery_created_at: timestamp,
    first_provider_receipt_at: timestamp,
    due_at: '2026-08-21T12:00:00.000Z',
    eligibility_version: Object.prototype.hasOwnProperty.call(options, 'eligibilityVersion')
      ? options.eligibilityVersion
      : version,
    state: options.state || view,
    reason: options.reason || (view === 'attention' ? 'transport_ambiguous' : view),
    reason_label:
      options.reasonLabel ||
      (view === 'attention'
        ? 'Falha de transporte'
        : view === 'ready'
          ? 'Silêncio após o recibo'
          : 'Aguardando 24h'),
    follow_up_id: options.followUpId || null,
    message_snapshot: null,
    closed_reason: null,
    approved_at: null,
    sent_at: null,
    updated_at: timestamp,
  };
}

function list(data, options = {}) {
  return {
    data,
    total: options.total ?? data.length,
    page: options.page ?? 1,
    page_size: options.pageSize ?? 25,
  };
}

test('operador alterna filas e aprova ou dispensa follow-ups', async ({ page }) => {
  const rows = {
    ready: followUp('ready', { number: 'ORC-READY' }),
    waiting: followUp('waiting', { number: 'ORC-WAITING' }),
    sent: followUp('sent', { number: 'ORC-SENT', state: 'sent', followUpId: 'follow-up-sent' }),
    dismissed: followUp('dismissed', {
      number: 'ORC-DISMISSED',
      state: 'dismissed',
      followUpId: 'follow-up-dismissed',
    }),
    attention: followUp('attention', {
      number: 'ORC-ATTENTION',
      state: 'needs_review',
      followUpId: 'follow-up-attention',
    }),
  };
  const requests = [];

  await page.route('**/api/follow-ups**', (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    requests.push({ method: request.method(), view: url.searchParams.get('view') });

    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body.quotation_id).toBe(rows.ready.quotation_id);
      expect(body.eligibility_version).toBe(version);
      expect(body.message).toContain('ORC-READY');
      return json(route, { follow_up_id: 'follow-up-ready', state: 'approved' }, 201);
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      expect(body.quotation_id).toBe(rows.waiting.quotation_id);
      expect(body.eligibility_version).toBe(version);
      expect(body.reason).toBe('do_not_contact');
      return json(route, { follow_up_id: 'follow-up-waiting', state: 'dismissed' });
    }

    const currentView = url.searchParams.get('view') || 'ready';
    return json(route, list([rows[currentView]]));
  });

  await page.goto('/#/follow-ups');
  await expect(page.getByRole('heading', { name: 'Follow-ups' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-READY' })).toBeVisible();

  await page.getByRole('tab', { name: 'Aguardando 24h' }).click();
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-WAITING' })).toBeVisible();
  await expect(page.getByText(/vence em/)).toBeVisible();
  await page.getByRole('tab', { name: 'Enviados' }).click();
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-SENT' })).toBeVisible();
  await page.getByRole('tab', { name: 'Dispensados' }).click();
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-DISMISSED' })).toBeVisible();
  await page.getByRole('tab', { name: 'Atenção' }).click();
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-ATTENTION' })).toBeVisible();

  await page.getByRole('tab', { name: 'Prontos' }).click();
  await page.getByRole('button', { name: 'Revisar' }).click();
  await expect(page.getByRole('dialog', { name: /ORC-READY/ })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Follow-up aprovado.' })).toBeVisible();

  await page.getByRole('tab', { name: 'Aguardando 24h' }).click();
  await page.getByRole('button', { name: 'Revisar' }).click();
  await page.getByLabel('Motivo da dispensa').selectOption('do_not_contact');
  await page.getByRole('button', { name: 'Dispensar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Follow-up dispensado.' })).toBeVisible();

  expect(requests.some(({ method }) => method === 'POST')).toBe(true);
  expect(requests.some(({ method }) => method === 'PATCH')).toBe(true);
  expect(
    new Set(requests.filter(({ method }) => method === 'GET').map(({ view }) => view))
  ).toEqual(new Set(['ready', 'waiting', 'sent', 'dismissed', 'attention']));
});

test('prontos mostra uma mensagem específica quando a fila está vazia', async ({ page }) => {
  await page.route('**/api/follow-ups**', (route) => json(route, list([])));
  await page.goto('/#/follow-ups');
  await expect(
    page.getByText('Nenhum follow-up pronto. Envios recentes ficam em Aguardando 24h.')
  ).toBeVisible();
});

test('operador pode dispensar aguardando recibo sem versão de elegibilidade', async ({ page }) => {
  const awaiting = followUp('attention', {
    number: 'ORC-AWAITING',
    state: 'awaiting_receipt',
    eligibilityVersion: null,
    followUpId: 'follow-up-awaiting',
    reason: 'awaiting_receipt',
    reasonLabel: 'Aguardando recibo do WhatsApp',
  });
  let patchBody;
  await page.route('**/api/follow-ups**', (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      patchBody = request.postDataJSON();
      return json(route, { follow_up_id: 'follow-up-awaiting', state: 'dismissed' });
    }
    return json(route, list([awaiting]));
  });

  await page.goto('/#/follow-ups');
  await page.getByRole('tab', { name: 'Atenção' }).click();
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-AWAITING' })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar' }).click();
  await expect(page.getByRole('dialog', { name: /ORC-AWAITING/ })).toBeVisible();
  await page.getByRole('button', { name: 'Dispensar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Follow-up dispensado.' })).toBeVisible();
  expect(patchBody).toEqual({
    quotation_id: awaiting.quotation_id,
    eligibility_version: '',
    reason: 'already_handled',
  });
});

test('aba e página sobrevivem a reload e ao retorno do orçamento', async ({ page }) => {
  const sent = followUp('sent', {
    quotationId: '11111111-1111-4111-8111-111111111111',
    number: 'ORC-CONTEXTO-26',
    state: 'sent',
    followUpId: 'follow-up-context',
  });
  const requests = [];

  await page.route('**/api/follow-ups**', (route) => {
    const url = new globalThis.URL(route.request().url());
    const view = url.searchParams.get('view');
    const currentPage = Number(url.searchParams.get('page'));
    requests.push({ view, page: currentPage });
    return json(route, list([sent], { total: 50, page: currentPage }));
  });
  await page.route('**/api/quotations?id=*', (route) =>
    json(route, { error: 'fixture sem detalhe' }, 503)
  );

  await page.goto('/#/follow-ups?view=sent&page=2');
  await expect(page.getByRole('tab', { name: 'Enviados' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-CONTEXTO-26' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-CONTEXTO-26' })).toBeVisible();
  await expect(page).toHaveURL(/#\/follow-ups\?view=sent&page=2$/);

  await page.getByRole('button', { name: 'Página anterior' }).click();
  await expect(page).toHaveURL(/#\/follow-ups\?view=sent$/);
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  await page.getByRole('button', { name: 'Próxima página' }).click();
  await expect(page).toHaveURL(/#\/follow-ups\?view=sent&page=2$/);

  await page.getByRole('link', { name: 'Abrir orçamento ORC-CONTEXTO-26' }).click();
  await expect(page).toHaveURL(/#\/quotations\/11111111-1111-4111-8111-111111111111$/);
  expect(page.url()).not.toContain(sent.client_name);
  expect(page.url()).not.toContain(sent.canonical_phone);

  await page.getByRole('button', { name: 'Voltar para Follow-ups' }).click();
  await expect(page).toHaveURL(/#\/follow-ups\?view=sent&page=2$/);
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-CONTEXTO-26' })).toBeVisible();
  expect(
    requests.filter(({ view, page: requestedPage }) => view === 'sent' && requestedPage === 2)
      .length
  ).toBeGreaterThanOrEqual(3);

  await page.getByRole('tab', { name: 'Atenção' }).click();
  await expect(page).toHaveURL(/#\/follow-ups\?view=attention$/);
  expect(requests.at(-1)).toEqual({ view: 'attention', page: 1 });
});

test('query inválida volta ao padrão e tabs respondem a setas', async ({ page }) => {
  const rows = {
    ready: followUp('ready', { number: 'ORC-READY-KEYBOARD' }),
    waiting: followUp('waiting', { number: 'ORC-WAITING-KEYBOARD' }),
    attention: followUp('attention', {
      number: 'ORC-ATTENTION-KEYBOARD',
      state: 'needs_review',
      followUpId: 'follow-up-attention-keyboard',
    }),
  };

  await page.route('**/api/follow-ups**', (route) => {
    const url = new globalThis.URL(route.request().url());
    const view = url.searchParams.get('view') || 'ready';
    return json(route, list(rows[view] ? [rows[view]] : []));
  });

  await page.goto('/#/follow-ups?view=inexistente&page=0');
  const readyTab = page.getByRole('tab', { name: 'Prontos' });
  await expect(readyTab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#\/follow-ups$/);
  await readyTab.focus();
  await readyTab.press('ArrowRight');

  const waitingTab = page.getByRole('tab', { name: 'Aguardando 24h' });
  await expect(waitingTab).toBeFocused();
  await expect(waitingTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute(
    'aria-labelledby',
    'follow-ups-tab-waiting'
  );
  await expect(page).toHaveURL(/#\/follow-ups\?view=waiting$/);

  await waitingTab.press('End');
  const attentionTab = page.getByRole('tab', { name: 'Atenção' });
  await expect(attentionTab).toBeFocused();
  await expect(attentionTab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#\/follow-ups\?view=attention$/);
});

test('estado e Revisar permanecem visíveis em desktop, tablet e celular', async ({ page }) => {
  const item = followUp('ready', {
    number: 'ORC-2026-IDENTIFICADOR-EXTENSO-00042',
    clientName: 'Cliente com nome sintético muito extenso para validar a largura disponível',
  });
  item.amount = '12345.67';

  await page.route('**/api/follow-ups**', (route) => json(route, list([item])));

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/#/follow-ups');
    const container =
      viewport.width >= 1024
        ? page.getByRole('row').filter({ hasText: item.business_number })
        : page.getByRole('article').filter({ hasText: item.business_number });
    await expect(container.getByText(item.client_name)).toBeVisible();
    await expect(container.getByText('Pronto')).toBeVisible();
    await expect(container.getByRole('button', { name: 'Revisar' })).toBeInViewport();
    await expect(container.getByText('R$\u00a012.345,67')).toBeVisible();
    await expect(container.getByText('(11) 99999-0000')).toBeVisible();
  }

  await page.getByRole('button', { name: 'Revisar' }).click();
  const drawer = page.getByRole('dialog', { name: new RegExp(item.business_number) });
  await expect(drawer).toContainText('R$\u00a012.345,67');
  await expect(drawer).toContainText('(11) 99999-0000');
  await expect(drawer).toContainText('20/08/2026, 09:00');
  await expect(drawer.getByLabel('Mensagem')).toHaveValue(new RegExp(item.business_number));
  await expect(drawer.getByLabel('Motivo da dispensa')).toBeVisible();
});
