import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { withCanonicalQuotationDetail } from './fixtures/quotation-detail.js';

const id = 'ORC-20260012';
const token = '2026-07-01T12:00:00.000Z';
const hash = 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e';

function detail(overrides = {}) {
  return withCanonicalQuotationDetail({
    id,
    quotation_id: id,
    quotation_name: id,
    quotation_uuid: '11111111-1111-4111-8111-111111111111',
    revision_id: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    revision_number: 1,
    status: 'Emitido',
    status_canonical: 'emitido',
    cliente: 'Cliente lifecycle',
    client_id: '33333333-3333-4333-8333-333333333333',
    cliente_snapshot: {
      id: '33333333-3333-4333-8333-333333333333',
      nome: 'Cliente lifecycle',
      email: 'original@example.com',
    },
    email_sent: false,
    email_sent_at: null,
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
      prazo_producao: {
        base: { enabled: true, title: 'Prazo de produção' },
        current: { enabled: true, title: 'Prazo de produção' },
      },
      pagamento: {
        base: { enabled: true, title: 'Pagamento', body: 'À vista' },
        current: { enabled: true, title: 'Pagamento', body: 'À vista' },
      },
      condicoes_gerais: {
        base: { enabled: true, title: 'Condições Gerais', body: '' },
        current: { enabled: true, title: 'Condições Gerais', body: '' },
      },
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
  });
}

function deliveryView(state, publicError = null) {
  const stepState =
    {
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
    steps: [
      {
        id: 'step-lifecycle',
        position: 0,
        type: 'quotation_pdf',
        state: stepState,
        attempt_count: 1,
        public_error: publicError,
        updated_at: token,
      },
    ],
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

test('operator confirms editable email and sends the current issued revision', async ({ page }) => {
  const sentBodies = [];
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) =>
    fulfillJson(
      route,
      detail({
        status: 'Enviado',
        status_canonical: 'emitido',
        email: 'original@example.com',
        email_sent: false,
        email_sent_at: null,
      })
    )
  );
  await page.route('**/api/send-quotation-email', async (route) => {
    sentBodies.push(route.request().postDataJSON());
    await fulfillJson(route, {
      success: true,
      delivery: {
        state: 'accepted',
        recipient: 'corrigido@example.com',
        accepted_at: '2026-08-17T12:00:00.000Z',
      },
    });
  });

  await page.goto('/#/quotations/ORC-42');
  await page.getByRole('button', { name: 'Enviar por e-mail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  await expect(dialog.getByLabel('E-mail do destinatário')).toHaveValue('original@example.com');
  await dialog.getByLabel('E-mail do destinatário').fill('corrigido@example.com');
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();

  await expect(page.getByText('E-mail aceito para envio.')).toBeVisible();
  expect(sentBodies).toHaveLength(1);
  expect(sentBodies[0]).toMatchObject({
    revision_id: detail().revision_id,
    recipient: 'corrigido@example.com',
  });
  expect(sentBodies[0].attempt_id).toMatch(/^[0-9a-f-]{36}$/i);
});

test('operator retries an ambiguous quotation email with the same attempt', async ({ page }) => {
  const sentBodies = [];
  let sendCount = 0;
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) =>
    fulfillJson(
      route,
      detail({
        email_sent: false,
        email_sent_at: null,
      })
    )
  );
  await page.route('**/api/send-quotation-email', async (route) => {
    sentBodies.push(route.request().postDataJSON());
    sendCount += 1;
    if (sendCount === 1) {
      await fulfillJson(
        route,
        {
          error: 'O resultado do envio não pôde ser confirmado. Tente novamente.',
          retry_same_attempt: true,
        },
        503
      );
      return;
    }
    await fulfillJson(route, {
      success: true,
      delivery: {
        state: 'accepted',
        recipient: 'corrigido@example.com',
        accepted_at: '2026-08-17T12:00:00.000Z',
      },
    });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Enviar por e-mail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  await dialog.getByLabel('E-mail do destinatário').fill('corrigido@example.com');
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'O resultado do envio não pôde ser confirmado. Tente novamente.'
  );
  const firstAttemptId = sentBodies[0].attempt_id;
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();
  await expect(page.getByText('E-mail aceito para envio.')).toBeVisible();
  expect(sentBodies).toHaveLength(2);
  expect(firstAttemptId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(sentBodies[1].attempt_id).toBe(firstAttemptId);
  expect(sentBodies[0].recipient).toBe('corrigido@example.com');
  expect(sentBodies[1].recipient).toBe('corrigido@example.com');
});

test('operator starts a new quotation email attempt after a confirmed failure', async ({
  page,
}) => {
  const sentBodies = [];
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) =>
    fulfillJson(
      route,
      detail({
        email_sent: false,
        email_sent_at: null,
      })
    )
  );
  await page.route('**/api/send-quotation-email', async (route) => {
    sentBodies.push(route.request().postDataJSON());
    await fulfillJson(
      route,
      {
        error: 'A Resend não aceitou o e-mail.',
        retry_same_attempt: false,
      },
      502
    );
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Enviar por e-mail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Não foi possível enviar o e-mail. Tente novamente.'
  );
  const firstAttemptId = sentBodies[0].attempt_id;
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Não foi possível enviar o e-mail. Tente novamente.'
  );
  expect(sentBodies).toHaveLength(2);
  expect(firstAttemptId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(sentBodies[1].attempt_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(sentBodies[1].attempt_id).not.toBe(firstAttemptId);
});

test('quotation email dialog traps focus, validates, cancels, and locks while sending', async ({
  page,
}) => {
  const sentBodies = [];
  let releaseSend = () => {};
  const sendStarted = new Promise((resolve) => {
    releaseSend = resolve;
  });
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) =>
    fulfillJson(
      route,
      detail({
        email_sent: false,
        email_sent_at: null,
      })
    )
  );
  await page.route('**/api/send-quotation-email', async (route) => {
    sentBodies.push(route.request().postDataJSON());
    await sendStarted;
    await fulfillJson(route, {
      success: true,
      delivery: {
        state: 'accepted',
        recipient: 'valid@example.com',
        accepted_at: '2026-08-17T12:00:00.000Z',
      },
    });
  });

  await page.goto(`/#/quotations/${id}`);
  const opener = page.getByRole('button', { name: 'Enviar por e-mail' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  const input = dialog.getByLabel('E-mail do destinatário');
  const submit = dialog.getByRole('button', { name: 'Enviar e-mail' });
  await expect(input).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await page
    .getByRole('dialog', { name: 'Enviar orçamento por e-mail' })
    .getByRole('button', { name: 'Cancelar' })
    .click();
  await expect(opener).toBeFocused();

  await opener.click();
  await page
    .getByRole('button', { name: 'Fechar envio por e-mail' })
    .click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await input.fill('');
  await submit.click();
  await expect.poll(() => input.evaluate((element) => element.matches(':invalid'))).toBe(true);
  expect(sentBodies).toHaveLength(0);

  await input.fill('valid@example.com');
  await submit.click();
  await expect.poll(() => sentBodies.length).toBe(1);
  await expect(input).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Enviando...' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Fechar envio por e-mail' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  releaseSend();
  await expect(page.getByText('E-mail aceito para envio.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('technical details traps focus, closes with Escape and restores the actions trigger', async ({
  page,
}) => {
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) => fulfillJson(route, detail()));

  await page.goto(`/#/quotations/${id}`);
  const opener = page.getByRole('button', { name: 'Mais ações' });
  await opener.click();
  await page.getByRole('menuitem', { name: 'Detalhes técnicos' }).click();

  const dialog = page.getByRole('dialog', { name: 'Detalhes técnicos' });
  const close = dialog.getByRole('button', { name: 'Fechar' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await opener.focus();
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('quotation email preserves ambiguous recipient and rotates attempt when changed', async ({
  page,
}) => {
  const sentBodies = [];
  let sendCount = 0;
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) =>
    fulfillJson(
      route,
      detail({
        email_sent: false,
        email_sent_at: null,
      })
    )
  );
  await page.route('**/api/send-quotation-email', async (route) => {
    sentBodies.push(route.request().postDataJSON());
    sendCount += 1;
    if (sendCount === 1) {
      await fulfillJson(
        route,
        {
          error: 'O resultado do envio não pôde ser confirmado. Tente novamente.',
          retry_same_attempt: true,
        },
        503
      );
      return;
    }
    await fulfillJson(route, {
      success: true,
      delivery: {
        state: 'accepted',
        recipient: 'second@example.com',
        accepted_at: '2026-08-17T12:00:00.000Z',
      },
    });
  });

  await page.goto(`/#/quotations/${id}`);
  const opener = page.getByRole('button', { name: 'Enviar por e-mail' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  const input = dialog.getByLabel('E-mail do destinatário');
  await input.fill('first@example.com');
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'O resultado do envio não pôde ser confirmado. Tente novamente.'
  );
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(opener).toBeFocused();

  await opener.click();
  const reopenedDialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  const reopenedInput = reopenedDialog.getByLabel('E-mail do destinatário');
  await expect(reopenedInput).toHaveValue('first@example.com');
  await reopenedInput.fill('second@example.com');
  await reopenedDialog.getByRole('button', { name: 'Enviar e-mail' }).click();
  await expect(page.getByText('E-mail aceito para envio.')).toBeVisible();
  expect(sentBodies).toHaveLength(2);
  expect(sentBodies[0].recipient).toBe('first@example.com');
  expect(sentBodies[1].recipient).toBe('second@example.com');
  expect(sentBodies[1].attempt_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(sentBodies[1].attempt_id).not.toBe(sentBodies[0].attempt_id);
});

test('accepted quotation email feedback survives a failed authoritative reload', async ({
  page,
}) => {
  let quotationGets = 0;
  let reloadFailed = false;
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', async (route) => {
    quotationGets += 1;
    if (reloadFailed) {
      await fulfillJson(route, { error: 'upstream reload failure' }, 503);
      return;
    }
    await fulfillJson(route, detail({ email_sent: false, email_sent_at: null }));
  });
  await page.route('**/api/send-quotation-email', (route) => {
    reloadFailed = true;
    return fulfillJson(route, {
      success: true,
      delivery: {
        state: 'accepted',
        recipient: 'original@example.com',
        accepted_at: '2026-08-17T12:00:00.000Z',
      },
    });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Enviar por e-mail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();
  await expect.poll(() => quotationGets).toBeGreaterThan(1);
  await expect(page.getByText('E-mail aceito para envio.')).toBeVisible();
  await expect(page.getByText('Erro ao carregar orçamento')).toHaveCount(0);
  await expect(
    page.getByText('Não foi possível atualizar o orçamento. Exibindo os dados anteriores.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reenviar por e-mail' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar por e-mail', exact: true })).toHaveCount(0);
});

test('quotation email network failures show only a safe Portuguese message', async ({ page }) => {
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) =>
    fulfillJson(
      route,
      detail({
        email_sent: false,
        email_sent_at: null,
      })
    )
  );
  await page.route('**/api/send-quotation-email', (route) => route.abort('failed'));

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Enviar por e-mail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar orçamento por e-mail' });
  await dialog.getByRole('button', { name: 'Enviar e-mail' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Não foi possível enviar o e-mail. Tente novamente.'
  );
  await expect(
    dialog.getByText(/Failed to fetch|NetworkError|ERR_FAILED|fetch failed/i)
  ).toHaveCount(0);
});

test('authoritative quotation email reload changes the action to resend', async ({ page }) => {
  let authoritative = detail({ email_sent: false, email_sent_at: null });
  let quotationGets = 0;
  let sent = false;
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', async (route) => {
    quotationGets += 1;
    await fulfillJson(route, authoritative);
  });
  await page.route('**/api/send-quotation-email', async (route) => {
    sent = true;
    authoritative = detail({ email_sent: true, email_sent_at: '2026-08-17T12:00:00.000Z' });
    await fulfillJson(route, {
      success: true,
      delivery: {
        state: 'accepted',
        recipient: 'original@example.com',
        accepted_at: '2026-08-17T12:00:00.000Z',
      },
    });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Enviar por e-mail' }).click();
  await page
    .getByRole('dialog', { name: 'Enviar orçamento por e-mail' })
    .getByRole('button', { name: 'Enviar e-mail' })
    .click();
  await expect.poll(() => sent).toBe(true);
  await expect.poll(() => quotationGets).toBeGreaterThan(1);
  await expect(page.getByText('E-mail aceito para envio.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reenviar por e-mail' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar por e-mail', exact: true })).toHaveCount(0);
});

test('draft quotations do not expose the email action', async ({ page }) => {
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/quotations?id=*', (route) =>
    fulfillJson(
      route,
      detail({
        status: 'Rascunho',
        status_canonical: 'rascunho',
        email_sent: false,
        email_sent_at: null,
      })
    )
  );

  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByRole('button', { name: 'Enviar por e-mail', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reenviar por e-mail', exact: true })).toHaveCount(
    0
  );
});

test('core quotation detail accepts JSON-string section snapshots from PostgreSQL @quotations @critical', async ({
  page,
}) => {
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Emitido', { exact: true }).first()).toBeVisible();
  const itemRow = page.locator('tr').filter({ hasText: 'Produto lifecycle' }).first();
  await expect(itemRow.getByText('10', { exact: true })).toBeVisible();
  await expect(itemRow.getByText('10.000', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Título da seção Dados para pagamento')).toHaveCount(0);
});

test('core lifecycle emission uses the current reviewed commercial fields and template @quotations @critical', async ({
  page,
}) => {
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
          quotationId: detail().quotation_uuid,
          businessNumber: id,
          revisionId: detail().revision_id,
          revisionNumber: 1,
          status: 'emitido',
          issuedAt: token,
          validUntil: '2026-08-12',
          pdfUrl: `/api/quotation-preview?id=${detail().quotation_uuid}&format=pdf`,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not found' }),
    });
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
        pagamento: savePayload.secoes?.pagamento?.current?.body || detail().pagamento,
        entrega: savePayload.entrega,
        validade_dias: savePayload.validade_dias,
        observacoes: savePayload.secoes?.condicoes_gerais?.current?.body || detail().observacoes,
        template_key: savePayload.template_key,
        template_version_id: savePayload.template_version_id,
        secoes: savePayload.secoes,
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authoritative),
      });
      return;
    }
    if (request.method() === 'POST') {
      await route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'legacy emission disabled' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route('**/api/settings**', async (route) => fulfillJson(route, {}));
  await page.route('**/api/quotation-templates**', async (route) =>
    fulfillJson(route, {
      templates: [
        {
          key: 'padrao',
          name: 'Padrão',
          is_default: true,
          hash,
          current_version_id: '55555555-5555-4555-8555-555555555555',
        },
        {
          key: 'minimalista',
          name: 'Minimalista',
          is_default: false,
          hash: 'a'.repeat(64),
          current_version_id: '77777777-7777-4777-8777-777777777777',
        },
      ],
    })
  );
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Rascunho', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Condição de pagamento').fill('30 dias após emissão');
  await page.getByLabel('Entrega do orçamento').fill('7 dias úteis');
  await page
    .getByRole('textbox', { name: 'Condições gerais', exact: true })
    .fill('Conteúdo revisado pelo operador');
  await page.getByLabel('Modelo do orçamento').selectOption('minimalista');
  await page.getByLabel('Título da seção Dados para pagamento').fill('Pagamento revisado');
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText('Orçamento salvo.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Validade do orçamento em dias').fill('42');
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText('Orçamento salvo.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  // emissão pede confirmação
  await page.getByRole('dialog').getByRole('button', { name: 'Emitir', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toHaveCount(0);
  expect(issueKey).toMatch(/^[0-9a-f-]{36}$/i);
  // Emission is by reference: only the revision identity and concurrency
  // token travel in the POST; reviewed commercial fields stay server-side.
  expect(issuePayload).toStrictEqual({
    revision_id: detail().revision_id,
    concurrency_token: token,
  });
});

test('detail reload restores durable accepted, reconciling, delivered and failed delivery states @quotations @critical', async ({
  page,
}) => {
  const phases = [
    ['provider_accepted', 'Aceito'],
    ['reconciling', 'Reconciliação em andamento'],
    ['delivered', 'Entregue'],
    ['failed', 'Falhou'],
  ];
  let phaseIndex = 0;
  await page.route('**/api/quotations**', async (route) => fulfillJson(route, detail()));
  await page.route('**/api/communication-flows**', async (route) =>
    fulfillJson(route, {
      success: true,
      selectedFlowId: 'already-talking',
      flows: [
        {
          id: 'already-talking',
          name: 'Já conversando',
          context: 'already_talking',
          channel: 'whatsapp',
          vendor_name: 'Evolution',
          enabled: true,
          delay_min_seconds: 0,
          delay_max_seconds: 0,
          max_media_per_product_group: 1,
          steps: [{ id: 'pdf', type: 'document', source: 'quotation_pdf' }],
        },
      ],
    })
  );
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

test('detail retryable status distinguishes verified PDF from generic failure @quotations @critical', async ({
  page,
}) => {
  let pdfFailure = true;
  await page.route('**/api/quotations**', async (route) => fulfillJson(route, detail()));
  await page.route('**/api/communication-flows**', async (route) =>
    fulfillJson(route, {
      success: true,
      selectedFlowId: 'already-talking',
      flows: [
        {
          id: 'already-talking',
          name: 'Já conversando',
          context: 'already_talking',
          channel: 'whatsapp',
          vendor_name: 'Evolution',
          enabled: true,
          delay_min_seconds: 0,
          delay_max_seconds: 0,
          max_media_per_product_group: 1,
          steps: [{ id: 'pdf', type: 'document', source: 'quotation_pdf' }],
        },
      ],
    })
  );
  await page.route('**/api/quotation-deliveries**', async (route) =>
    fulfillJson(
      route,
      deliveryView(
        'failed',
        pdfFailure
          ? 'PDF indisponível. Tentar novamente.'
          : 'Falha antes do transporte. Tentar novamente.'
      )
    )
  );
  await routeTemplates(page);
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('PDF indisponível. Tentar novamente')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar WhatsApp' })).toBeDisabled();
  pdfFailure = false;
  await page.reload();
  await expect(page.getByText('Falha antes do transporte. Tentar novamente.')).toBeVisible();
  await expect(page.getByText('PDF indisponível. Tentar novamente')).toHaveCount(0);
});

test('expired detail blocks send, loss requires reason and emitted deletion remains hidden @quotations @critical', async ({
  page,
}) => {
  let authoritative = detail({ derived_expired: true });
  const posts = [];
  await page.route('**/api/quotations**', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      authoritative = detail({ status: 'Perdido', status_canonical: 'perdido' });
    }
    await fulfillJson(route, authoritative);
  });
  await page.route('**/api/communication-flows**', async (route) =>
    fulfillJson(route, { success: true, selectedFlowId: null, flows: [] })
  );
  await routeTemplates(page);
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByRole('button', { name: 'Enviar WhatsApp' })).toBeDisabled();
  await expect(
    page.getByText('Validade expirada — crie uma nova revisão para reenviar.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluir' })).toHaveCount(0);
  // motivo da perda agora é dialog dedicado (sem window.prompt)
  await page.getByRole('button', { name: 'Marcar como perdido' }).click();
  const lossDialog = page.getByRole('dialog', { name: 'Motivo da perda' });
  await expect(lossDialog.getByRole('button', { name: 'Marcar como perdido' })).toBeDisabled();
  expect(posts).toHaveLength(0);
  await lossDialog.getByLabel('Motivo').selectOption('Preço');
  await lossDialog.getByRole('button', { name: 'Marcar como perdido' }).click();
  expect(posts[0]).toMatchObject({
    action: 'set_status',
    status: 'perdido',
    loss_reason: 'Preço',
    concurrency_token: token,
  });
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
          sales_order_id: 'PED-2026-0012',
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
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  const pdfPreview = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Visualizar PDF' }).click();
  const pdfPopup = await pdfPreview;
  await pdfPopup.waitForURL('**/api/quotation-preview**');
  const pdfUrl = new globalThis.URL(pdfPopup.url());
  expect(pdfUrl.pathname).toBe('/api/quotation-preview');
  expect(pdfUrl.searchParams.get('id')).toBe('22222222-2222-4222-8222-222222222222');
  expect(pdfUrl.searchParams.get('format')).toBe('pdf');
  expect(pdfUrl.searchParams.has('template_version_id')).toBe(false);
  expect(pdfUrl.searchParams.has('template')).toBe(false);
  await pdfPopup.close();
  await page.getByText('Histórico e revisões').click();
  const historyPreview = page.waitForEvent('popup');
  await page
    .locator('tbody tr')
    .filter({ hasText: 'R1' })
    .getByRole('button', { name: 'Visualizar', exact: true })
    .click();
  const historyPopup = await historyPreview;
  await historyPopup.waitForURL('**/api/quotation-preview**');
  const historyUrl = new globalThis.URL(historyPopup.url());
  expect(historyUrl.searchParams.get('id')).toBe('22222222-2222-4222-8222-222222222222');
  await historyPopup.close();
  await page.getByRole('button', { name: 'Aprovar e criar pedido' }).click();
  await expect(page.getByText('Aprovado', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver pedido PED-2026-0012' })).toBeVisible();
  await expect(page.getByText('Pedido PED-2026-0012 criado.')).toBeVisible();
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
  await page.getByText('Histórico e revisões').click();
  await page.getByRole('button', { name: 'Nova revisão' }).click();
  await expect(page.getByText('Nova revisão criada em rascunho.')).toBeVisible();
  await expect(page.getByText('Rascunho', { exact: true }).first()).toBeVisible();
  expect(posts.at(-1)).toMatchObject({
    action: 'create_revision',
    source_revision_id: '22222222-2222-4222-8222-222222222222',
    concurrency_token: token,
  });
});

test('new revision prices a product selected from an added item row @quotations @critical', async ({
  page,
}) => {
  let authoritative = detail();
  const pricingBodies = [];
  await routeTemplates(page);
  await page.route('**/api/communication-flows**', (route) => fulfillJson(route, { flows: [] }));
  await page.route('**/api/products?*', (route) =>
    fulfillJson(route, {
      data: [{ sku: 'SKU-NEW', nome: 'Produto novo', pricing_available: true }],
    })
  );
  await page.route('**/api/pricing-lookup', async (route) => {
    const payload = route.request().postDataJSON();
    pricingBodies.push(payload);
    const qty = String(payload.items?.[0]?.qty || '');
    await fulfillJson(route, {
      success: true,
      items: [
        {
          item_code: 'SKU-NEW',
          item_name: 'Produto novo',
          qty,
          rate: qty === '100' ? '8.50' : '12.34',
        },
      ],
    });
  });
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await fulfillJson(route, authoritative);
      return;
    }
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      if (payload.action === 'create_revision') {
        authoritative = detail({
          status: 'Rascunho',
          status_canonical: 'rascunho',
          revision: 2,
          revision_number: 2,
          revision_id: '66666666-6666-4666-8666-666666666666',
        });
      }
      await fulfillJson(route, authoritative);
      return;
    }
    await fulfillJson(route, { data: [] });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByText('Histórico e revisões').click();
  await page.getByRole('button', { name: 'Nova revisão' }).click();
  await expect(page.getByText('Nova revisão criada em rascunho.')).toBeVisible();
  await page.getByRole('button', { name: 'Item', exact: true }).click();

  const row = page.locator('table').first().locator('tbody tr').last();
  await row.getByLabel(/^SKU do item/).fill('SKU-NEW');
  await page.getByRole('button', { name: /SKU-NEW.*Produto novo/ }).click();

  await expect(row.getByLabel('Preço aplicado SKU-NEW')).toHaveValue('12.34');
  const quantity = row.locator('input[type="number"]').first();
  await quantity.fill('100');
  await quantity.blur();
  await expect(row.getByLabel('Preço aplicado SKU-NEW')).toHaveValue('8.50');
  expect(pricingBodies).toEqual([
    { items: [{ item_code: 'SKU-NEW', qty: '1.000' }], urgent: false },
    { items: [{ item_code: 'SKU-NEW', qty: '100' }], urgent: false },
  ]);
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
    return forbidden.test(content) || externalAppUrl.test(content)
      ? [path.relative(srcRoot, filename)]
      : [];
  });
  expect(violations).toEqual([]);
});

test('sales order detail presents one origin, one progress summary, and protected peer actions @quotations @critical', async ({
  page,
}) => {
  const states = {
    'LOCAL-PENDING': {
      status: 'To Deliver and Bill',
      per_delivered: 0,
      per_billed: 0,
    },
    'LOCAL-PARTIAL': {
      status: 'To Deliver and Bill',
      per_delivered: 60,
      per_billed: 40,
      source_quotation: 'ORC-LOCAL-1',
    },
    'LOCAL-COMPLETED': {
      status: 'Completed',
      per_delivered: 100,
      per_billed: 100,
    },
  };

  await page.route('**/api/sales-orders**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    const id = url.searchParams.get('id');
    const state = states[id];
    await fulfillJson(route, {
      id,
      customer_name: 'Cliente local',
      date: '2026-07-01',
      grand_total: 100,
      items: [
        {
          item_code: 'SKU-1',
          item_name: 'Produto local',
          qty: 1,
          rate: 100,
          amount: 100,
          uom: 'und',
        },
      ],
      ...state,
    });
  });

  await page.goto('/#/sales-orders/LOCAL-PENDING');
  await expect(page.getByText('A entregar e faturar', { exact: true })).toBeVisible();
  await expect(page.getByText('Produto local', { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Atualizar pedido').getByText('R$ 100,00', { exact: true })
  ).toBeVisible();
  const pendingProgress = page.getByRole('region', { name: 'Progresso do pedido' });
  await expect(pendingProgress.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(pendingProgress.getByText('Faturado', { exact: true })).toBeVisible();
  await expect(pendingProgress.getByText('0%', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Abrir orçamento de origem' })).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation', { name: 'Trilha de navegação' })
      .getByRole('button', { name: 'Pedidos', exact: true })
  ).toHaveCount(1);

  const pendingActions = page.getByRole('complementary', { name: 'Atualizar pedido' });
  const billButton = pendingActions.getByRole('button', { name: 'Marcar faturado' });
  const deliverButton = pendingActions.getByRole('button', { name: 'Marcar entregue' });
  await expect(billButton).toBeEnabled();
  await expect(deliverButton).toBeEnabled();
  await expect(billButton).toHaveAttribute('data-variant', 'outline');
  await expect(deliverButton).toHaveAttribute('data-variant', 'outline');

  await page.goto('/#/sales-orders/LOCAL-PARTIAL');
  const partialProgress = page.getByRole('region', { name: 'Progresso do pedido' });
  await expect(partialProgress.getByText('60%', { exact: true })).toBeVisible();
  await expect(partialProgress.getByText('40%', { exact: true })).toBeVisible();
  const sourceButton = page.getByRole('button', { name: 'Abrir orçamento ORC-LOCAL-1' });
  await expect(sourceButton).toHaveCount(1);
  await expect(sourceButton).toHaveAttribute('data-variant', 'link');
  await sourceButton.click();
  await expect(page).toHaveURL(/\/#\/quotations\/ORC-LOCAL-1$/);

  await page.goto('/#/sales-orders/LOCAL-COMPLETED');
  await expect(page.getByTitle('Concluído')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Progresso do pedido' }).getByText('100%', { exact: true })
  ).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Marcar faturado' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Marcar entregue' })).toBeDisabled();
  await expect(page.getByRole('link', { name: /ERP|extern/i })).toHaveCount(0);
});

test('empty local dashboard renders zero metrics @quotations @critical', async ({ page }) => {
  await page.route('**/api/sales-dashboard**', async (route) =>
    fulfillJson(route, {
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
    })
  );
  await page.goto('/#/dashboard');
  await expect(page.getByText('Resultados', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('R$ 0,00', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Produtos' }).click();
  await expect(page.getByText('Nenhum produto vendido no período.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Visão geral' }).click();
  await expect(page.getByText('Nenhum movimento neste período.', { exact: true })).toBeVisible();
});

test('products page uses local controls without response mode metadata @quotations @critical', async ({
  page,
}) => {
  await page.route('**/api/products**', async (route) =>
    fulfillJson(route, {
      data: [
        { sku: 'SKU-LOCAL', nome: 'Produto local', descricao: '', unidade: 'Und', ativo: true },
      ],
      pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
    })
  );
  await page.goto('/#/products');
  await expect(page.getByRole('cell', { name: 'Produto local' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ativos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arquivados' })).toBeVisible();
});

test('manual quotation accepts metadata-free local responses @quotations @critical', async ({
  page,
}) => {
  await page.route('**/api/quotation-templates**', async (route) =>
    fulfillJson(route, {
      templates: [{ key: 'padrao', name: 'Padrão', is_default: true }],
      default_key: 'padrao',
    })
  );
  await page.route('**/api/leads-clients**', async (route) =>
    fulfillJson(route, {
      data: [
        {
          id: 'client-local',
          nome: 'Cliente local',
          email: 'local@example.com',
          telefone: '5511999990000',
          tipo: 'cliente',
        },
      ],
      pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
    })
  );
  await page.route('**/api/products**', async (route) =>
    fulfillJson(route, {
      data: [
        { sku: 'SKU-LOCAL', nome: 'Produto local', preco_minimo: '10.00', pricing_available: true },
      ],
      pagination: { page: 1, limit: 8, total: 1, total_pages: 1 },
    })
  );
  await page.route('**/api/pricing-lookup**', async (route) =>
    fulfillJson(route, {
      success: true,
      items: [{ item_code: 'SKU-LOCAL', qty: 30, rate: '10.00' }],
    })
  );
  await page.route('**/api/orcamento**', async (route) =>
    fulfillJson(
      route,
      {
        success: true,
        quotation_id: 'ORC-LOCAL-1',
        quote_id: 'quote-local-1',
        revision_id: 'revision-local-1',
        revision_number: 1,
        cliente: 'Cliente local',
        status: 'rascunho',
        concurrency_token: '2026-08-17T12:00:00.000Z',
      },
      201
    )
  );
  await page.route('**/api/quotations?id=*', async (route) =>
    fulfillJson(
      route,
      withCanonicalQuotationDetail({
        id: 'ORC-LOCAL-1',
        quotation_id: 'ORC-LOCAL-1',
        quotation_name: 'ORC-LOCAL-1',
        quotation_uuid: 'quote-local-1',
        revision_id: 'revision-local-1',
        revision: 1,
        revision_number: 1,
        status: 'Rascunho',
        status_canonical: 'rascunho',
        cliente: 'Cliente local',
        client_id: 'client-local',
        cliente_snapshot: {
          id: 'client-local',
          nome: 'Cliente local',
          email: 'local@example.com',
          telefone: '5511999990000',
        },
        validade_dias: 15,
        validade: '2026-08-31',
        data: '2026-08-17',
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
        items: [
          {
            item_code: 'SKU-LOCAL',
            sku: 'SKU-LOCAL',
            item_name: 'Produto local',
            nome: 'Produto local',
            qty: '30.000',
            suggested_unit_price: '10.00',
            applied_unit_price: '10.00',
            price_difference: '0.00',
            line_total: '300.00',
            manual_rate: false,
          },
        ],
        subtotal: '300.00',
        total: '300.00',
        valor: '300.00',
        revision_history: [],
        derived_expired: false,
        concurrency_token: '2026-08-17T12:00:00.000Z',
        updated_at: '2026-08-17T12:00:00.000Z',
        email_sent: false,
        email_sent_at: null,
      })
    )
  );
  await page.goto('/#/manual');
  await page.getByRole('button', { name: 'Buscar cliente existente' }).click();
  await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('Cliente');
  await page.getByRole('button', { name: 'Selecionar Cliente local' }).click();
  await page
    .getByRole('dialog', { name: 'Cliente do orçamento' })
    .getByRole('button', { name: 'Aplicar ao rascunho' })
    .click();
  await page
    .getByRole('region', { name: 'Seleção de cliente' })
    .getByRole('combobox')
    .selectOption('Google Ads');
  await page
    .getByRole('textbox', { name: 'Buscar produto para adicionar ao orçamento' })
    .fill('SKU-LOCAL');
  await page.getByRole('button', { name: 'Adicionar SKU-LOCAL ao orçamento' }).click();
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page).toHaveURL(/#\/quotations\/quote-local-1$/);
  await expect(page.getByRole('heading', { name: 'ORC-LOCAL-1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Visualizar PDF' })).toHaveCount(0);
});

test('empty local CRM and leads retain loading/error/retry states @quotations @critical', async ({
  page,
}) => {
  await page.route('**/api/crm-deals**', async (route) => fulfillJson(route, { columns: [] }));
  await page.goto('/#/crm?tab=deals');
  await expect(page.getByText('Nenhum negócio no pipeline.', { exact: true })).toBeVisible();

  let leadAttempts = 0;
  await page.route('**/api/leads-clients**', async (route) => {
    leadAttempts += 1;
    if (leadAttempts === 1) return fulfillJson(route, { error: 'Falha temporária.' }, 503);
    return fulfillJson(route, {
      data: [],
      pagination: { page: 1, limit: 10, total: 0, total_pages: 0 },
    });
  });
  await page.goto('/#/leads');
  await expect(page.getByText('Erro ao carregar clientes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByText('Nenhum cliente encontrado', { exact: true })).toBeVisible();
});
