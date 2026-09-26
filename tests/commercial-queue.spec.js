// @ts-check
// Presentation contract of the Fila with mocked HTTP: layout, copy, error and
// retry affordances, and the pagination controls' request/response contract.
// The integrated ingestion -> PostgreSQL -> queue -> UI chain lives in
// tests/commercial-queue-integrated.spec.js.
import { expect, test } from '@playwright/test';

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const firstContact = {
  action_id: '11111111-1111-4111-8111-111111111111',
  opportunity_id: '22222222-2222-4222-8222-222222222222',
  kind: 'first_contact',
  kind_label: 'Primeiro contato',
  reason_code: 'new_lead',
  reason_label: 'Primeiro atendimento',
  reason: 'Primeiro atendimento',
  origin: 'automatic',
  state: 'active',
  due_at: '2026-09-11T12:00:00.000Z',
  due_date: '2026-09-11',
  due_time: '09:00',
  schedule_type: 'timed',
  due_status: 'overdue',
  version: 1,
  follow_up_stage: 0,
  actor: 'system',
  is_urgent: false,
  priority: 4,
  opportunity_status: 'Novo Lead',
  contact_context: {
    status: 'available',
    last_contact_at: '2026-09-11T11:30:00.000Z',
    last_contact_direction: 'inbound',
    blockers: [],
  },
  whatsapp_href: 'https://wa.me/5521999990000',
  demand_summary: 'Cangas 100 unidades',
  contact_name: 'Lead Sintético',
  contact_phone: '5521999990000',
  contact_email: 'synthetic@example.invalid',
  client_id: null,
  client_name: null,
  proposals: [],
};

function queue(items) {
  return { data: items, total: items.length, page: 1, page_size: 25 };
}

const proposalDeliveryAction = {
  ...firstContact,
  action_id: '33333333-3333-4333-8333-333333333333',
  opportunity_id: '44444444-4444-4444-8444-444444444444',
  kind: 'customer_contact',
  kind_label: 'Contato com cliente',
  reason_code: 'proposal_delivery_confirmed',
  reason_label: 'Entrega confirmada da proposta',
  reason: 'Entrega confirmada da proposta',
  origin: 'event',
  source_quotation_id: '55555555-5555-4555-8555-555555555555',
  source_revision_id: '66666666-6666-4666-8666-666666666666',
  source_delivery_id: '77777777-7777-4777-8777-777777777777',
  client_id: '88888888-8888-4888-8888-888888888888',
  client_name: 'Cliente da proposta',
  contact_name: 'Cliente da proposta',
  contact_phone: '5521999990000',
  contact_context: {
    status: 'available',
    last_contact_at: null,
    last_contact_direction: null,
    blockers: [],
  },
  proposals: [
    {
      quotation_id: '55555555-5555-4555-8555-555555555555',
      business_number: 'ORC-20260001',
      status: 'emitido',
      total: '1250.00',
    },
  ],
};

const followUpContext = {
  follow_up_id: '99999999-9999-4999-8999-999999999999',
  quotation_id: proposalDeliveryAction.source_quotation_id,
  revision_id: proposalDeliveryAction.source_revision_id,
  delivery_id: proposalDeliveryAction.source_delivery_id,
  business_number: 'ORC-20260001',
  client_name: 'Cliente da proposta',
  amount: '1250.00',
  instance: 'synthetic-instance',
  provider_conversation_id: '5521999990000@s.whatsapp.net',
  canonical_phone: '5521999990000',
  delivery_created_at: '2026-09-01T12:00:00.000Z',
  first_provider_receipt_at: '2026-09-01T12:01:00.000Z',
  due_at: '2026-09-02T12:01:00.000Z',
  eligibility_version: 'a'.repeat(64),
  state: 'ready',
  reason: 'ready',
  reason_label: 'Silêncio após o recibo',
  message_snapshot: 'Olá, Cliente da proposta.\n\nRetorno confirmado.',
  closed_reason: null,
  approved_at: null,
  sent_at: null,
  updated_at: '2026-09-12T12:00:00.000Z',
};

function followUpSuggestion(url) {
  const query = new globalThis.URL(url).searchParams;
  const occurredAt = query.get('occurred_at');
  const businessDays = Number(query.get('business_days'));
  const anchorDate = occurredAt?.slice(0, 10);
  const dates = {
    '2026-09-11:2': '2026-09-15',
    '2026-09-14:2': '2026-09-16',
    '2026-09-15:3': '2026-09-18',
  };
  return {
    anchor_date: anchorDate,
    suggested_date: dates[`${anchorDate}:${businessDays}`],
    business_days: businessDays,
  };
}

function manualContactResponse(body) {
  return {
    action_id: firstContact.action_id,
    opportunity_id: firstContact.opportunity_id,
    state: 'completed',
    version: 2,
    closed: false,
    successor: null,
    event_id: '99999999-9999-4999-8999-999999999999',
    command_id: body.command_id,
    contact_type: body.contact_type,
    occurred_at: body.occurred_at,
    note: body.note || null,
    result_code: body.result_code,
    counts_as_follow_up: body.counts_as_follow_up,
    continuation_type: body.continuation.type,
    source: 'operator_statement',
  };
}

test('ação de entrega confirmada abre o follow-up da proposta e aprova o texto editado', async ({
  page,
}) => {
  const followUpWrites = [];
  const queueReads = [];
  const followUpReads = [];
  await page.route('**/api/commercial-queue**', (route) => {
    queueReads.push(route.request().method());
    return json(route, queue([proposalDeliveryAction]));
  });
  await page.route('**/api/follow-ups**', (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.has('quotation_id')) {
      followUpReads.push(url);
      return json(route, { data: followUpContext });
    }
    if (request.method() === 'POST') {
      followUpWrites.push(request.postDataJSON());
      return json(route, {
        follow_up_id: followUpContext.follow_up_id,
        state: 'approved',
      }, 201);
    }
    return json(route, { data: [] });
  });

  await page.goto('/#/crm?tab=queue');
  const row = page.getByRole('row', { name: /Cliente da proposta/ });
  await row.getByRole('button', { name: 'Revisar retorno' }).click();

  const drawer = page.getByRole('dialog', { name: /ORC-20260001/ });
  await expect(drawer).toContainText('Cliente da proposta');
  await expect(drawer.getByLabel('Mensagem')).toHaveValue(/Retorno confirmado/);
  expect(followUpWrites).toEqual([]);

  const editedMessage = 'Olá, Cliente da proposta.\n\nMensagem revisada pelo operador.';
  await drawer.getByLabel('Mensagem').fill(editedMessage);
  await drawer.getByRole('button', { name: 'Aprovar e enviar retorno' }).click();

  await expect.poll(() => followUpWrites).toHaveLength(1);
  expect(followUpWrites[0]).toEqual({
    quotation_id: followUpContext.quotation_id,
    eligibility_version: followUpContext.eligibility_version,
    message: editedMessage,
  });
  expect(queueReads.every((method) => method === 'GET')).toBe(true);
  expect(followUpReads).toHaveLength(1);
  expect(followUpReads[0].searchParams.get('quotation_id')).toBe(proposalDeliveryAction.source_quotation_id);
  expect(followUpReads[0].searchParams.get('opportunity_id')).toBe(proposalDeliveryAction.opportunity_id);
  expect(followUpReads[0].searchParams.get('action_id')).toBe(proposalDeliveryAction.action_id);
});

test('relink before opening a proposal follow-up returns a safe conflict without a drawer', async ({
  page,
}) => {
  await page.route('**/api/commercial-queue**', (route) =>
    json(route, queue([proposalDeliveryAction])),
  );
  await page.route('**/api/follow-ups**', (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.has('quotation_id')) {
      return json(route, { error: 'A fila mudou. Recarregue e tente novamente.' }, 409);
    }
    return json(route, { data: [] });
  });

  await page.goto('/#/crm?tab=queue');
  await page
    .getByRole('row', { name: /Cliente da proposta/ })
    .getByRole('button', { name: 'Revisar retorno' })
    .click();

  await expect(page.getByText('A fila mudou. Recarregue e tente novamente.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /ORC-20260001/ })).toHaveCount(0);
});

test('primeiro sem resposta contado oferece sugestão de três dias úteis', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) => {
    if (
      new globalThis.URL(route.request().url()).searchParams.get('view') === 'follow_up_suggestion'
    ) {
      return json(route, followUpSuggestion(route.request().url()));
    }
    return json(route, queue([firstContact]));
  });

  await page.goto('/#/crm?tab=queue');
  await page
    .getByRole('row', { name: /Lead Sintético/ })
    .getByRole('button', { name: 'Registrar contato' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Data e hora do contato').fill('2026-09-15T10:00');
  await dialog.getByRole('combobox', { name: 'Resultado do contato' }).selectOption('no_response');
  await expect(dialog.getByRole('button', { name: 'Usar sugestão' })).toHaveCount(0);
  await dialog.getByLabel('Follow-up comercial concluído').check();
  await expect(dialog.getByText('Segundo retorno sugerido: 18/09/2026')).toBeVisible();
  await dialog.getByRole('button', { name: 'Usar sugestão' }).click();
  await expect(dialog.getByLabel('Data para aguardar')).toHaveValue('2026-09-18');
});

test('sugestão aplicada é invalidada e recalculada quando a ocorrência muda', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) => {
    if (
      new globalThis.URL(route.request().url()).searchParams.get('view') === 'follow_up_suggestion'
    ) {
      return json(route, followUpSuggestion(route.request().url()));
    }
    return json(route, queue([firstContact]));
  });

  await page.goto('/#/crm?tab=queue');
  await page
    .getByRole('row', { name: /Lead Sintético/ })
    .getByRole('button', { name: 'Registrar contato' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Data e hora do contato').fill('2026-09-11T10:00');
  await dialog
    .getByRole('combobox', { name: 'Resultado do contato' })
    .selectOption('awaiting_information');
  await expect(dialog.getByText('Primeiro retorno sugerido: 15/09/2026')).toBeVisible();
  await dialog.getByRole('button', { name: 'Usar sugestão' }).click();
  await expect(dialog.getByLabel('Continuidade', { exact: true })).toHaveValue('wait');
  await expect(dialog.getByLabel('Data para aguardar')).toHaveValue('2026-09-15');

  await dialog.getByLabel('Data e hora do contato').fill('2026-09-14T10:00');
  await expect(dialog.getByLabel('Continuidade', { exact: true })).toHaveValue('');
  await expect(dialog.getByText('Primeiro retorno sugerido: 16/09/2026')).toBeVisible();
  await dialog.getByRole('button', { name: 'Usar sugestão' }).click();
  await expect(dialog.getByLabel('Data para aguardar')).toHaveValue('2026-09-16');
});

test('resposta tardia não substitui uma continuidade de fim de semana editada pelo operador', async ({
  page,
}) => {
  const posts = [];
  const pendingSuggestions = [];
  await page.route('**/api/commercial-queue**', async (route) => {
    if (
      new globalThis.URL(route.request().url()).searchParams.get('view') === 'follow_up_suggestion'
    ) {
      await new Promise((resolve) => {
        pendingSuggestions.push(async () => {
          try {
            await json(route, followUpSuggestion(route.request().url()));
          } catch {
            // The UI may abort this request after the operator chooses a continuation.
          }
          resolve();
        });
      });
      return;
    }
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      posts.push(body);
      return json(route, manualContactResponse(body));
    }
    return json(route, queue([firstContact]));
  });

  await page.goto('/#/crm?tab=queue');
  await page
    .getByRole('row', { name: /Lead Sintético/ })
    .getByRole('button', { name: 'Registrar contato' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Data e hora do contato').fill('2026-09-11T10:00');
  await dialog
    .getByRole('combobox', { name: 'Resultado do contato' })
    .selectOption('awaiting_information');
  await expect.poll(() => pendingSuggestions.length).toBe(1);
  await dialog.getByRole('combobox', { name: 'Continuidade' }).selectOption('wait');
  await dialog.getByLabel('Data para aguardar').fill('2026-09-19');
  await dialog.getByLabel('Motivo da continuidade').fill('Aguardar documentos');
  await pendingSuggestions[0]();

  await expect(dialog.getByLabel('Data para aguardar')).toHaveValue('2026-09-19');
  await expect(dialog.getByRole('button', { name: 'Usar sugestão' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Registrar contato' }).click();
  await expect.poll(() => posts).toHaveLength(1);
  expect(posts[0].continuation.schedule.due_date).toBe('2026-09-19');
});

test('respostas fora de ordem não substituem o resultado da ocorrência atual', async ({ page }) => {
  const pendingSuggestions = new Map();
  await page.route('**/api/commercial-queue**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.get('view') === 'follow_up_suggestion') {
      const occurredAt = url.searchParams.get('occurred_at');
      await new Promise((resolve) => {
        pendingSuggestions.set(occurredAt, async () => {
          try {
            await json(route, followUpSuggestion(route.request().url()));
          } catch {
            // An older request may have been aborted by the current request.
          }
          resolve();
        });
      });
      return;
    }
    return json(route, queue([firstContact]));
  });

  await page.goto('/#/crm?tab=queue');
  await page
    .getByRole('row', { name: /Lead Sintético/ })
    .getByRole('button', { name: 'Registrar contato' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Data e hora do contato').fill('2026-09-11T10:00');
  await dialog
    .getByRole('combobox', { name: 'Resultado do contato' })
    .selectOption('awaiting_information');
  await expect.poll(() => pendingSuggestions.size).toBe(1);
  await dialog.getByLabel('Data e hora do contato').fill('2026-09-14T10:00');
  await expect.poll(() => pendingSuggestions.size).toBe(2);

  await pendingSuggestions.get('2026-09-14T13:00:00.000Z')?.();
  await expect(dialog.getByText('Primeiro retorno sugerido: 16/09/2026')).toBeVisible();
  await pendingSuggestions.get('2026-09-11T13:00:00.000Z')?.();
  await expect(dialog.getByText('Primeiro retorno sugerido: 16/09/2026')).toBeVisible();
});

test('estágio já contado não oferece um terceiro retorno genérico', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) =>
    json(route, queue([{ ...firstContact, follow_up_stage: 1 }]))
  );

  await page.goto('/#/crm?tab=queue');
  await page
    .getByRole('row', { name: /Lead Sintético/ })
    .getByRole('button', { name: 'Registrar contato' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Resultado do contato' })
    .selectOption('awaiting_information');
  await expect(dialog.getByRole('button', { name: 'Usar sugestão' })).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Resultado do contato' }).selectOption('no_response');
  await dialog.getByLabel('Follow-up comercial concluído').check();
  await expect(dialog.getByRole('button', { name: 'Usar sugestão' })).toHaveCount(0);
});

test('continuidade interna escolhida pelo operador não é substituída por sugestão', async ({
  page,
}) => {
  const posts = [];
  await page.route('**/api/commercial-queue**', async (route) => {
    if (
      new globalThis.URL(route.request().url()).searchParams.get('view') === 'follow_up_suggestion'
    ) {
      return json(route, followUpSuggestion(route.request().url()));
    }
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      posts.push(body);
      return json(route, manualContactResponse(body));
    }
    return json(route, queue([firstContact]));
  });

  await page.goto('/#/crm?tab=queue');
  await page
    .getByRole('row', { name: /Lead Sintético/ })
    .getByRole('button', { name: 'Registrar contato' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Resultado do contato' })
    .selectOption('awaiting_information');
  await dialog.getByRole('combobox', { name: 'Continuidade' }).selectOption('successor');
  await expect(dialog.getByRole('button', { name: 'Usar sugestão' })).toHaveCount(0);
  await dialog.getByLabel('Tipo da próxima ação').selectOption('internal');
  await dialog.getByLabel('Data da próxima ação').fill('2026-09-20');
  await dialog.getByLabel('Motivo da continuidade').fill('Separar amostras');
  await dialog.getByRole('button', { name: 'Registrar contato' }).click();

  await expect.poll(() => posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    continuation: {
      type: 'successor',
      schedule: {
        kind: 'internal',
        due_date: '2026-09-20',
        reason: 'Separar amostras',
      },
    },
  });
});

test('Comercial lista o lead novo com demanda, motivo e prazo na Fila', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) => json(route, queue([firstContact])));

  await page.goto('/#/crm?tab=queue');

  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Fila' })).toHaveAttribute('aria-selected', 'true');

  const row = page.getByRole('row', { name: /Lead Sintético/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('Cangas 100 unidades')).toBeVisible();
  await expect(row.getByText('Primeiro atendimento')).toBeVisible();
  await expect(row.getByText('(21) 99999-0000')).toBeVisible();
  await expect(row.getByText('11/09/2026', { exact: true })).toBeVisible();
  await expect(row.getByText('09:00', { exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: 'Abrir WhatsApp de Lead Sintético' })).toHaveAttribute(
    'href',
    'https://wa.me/5521999990000'
  );
});

test('a Fila mostra totais limitados à página e busca entre as ações carregadas', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) =>
    json(route, queue([
      firstContact,
      {
        ...firstContact,
        action_id: '33333333-3333-4333-8333-333333333333',
        reason_label: 'Validar prazo do evento',
        kind_label: 'Compromisso acordado',
        due_status: 'today',
        due_date: '2026-09-22',
        due_time: '10:30',
        due_at: '2026-09-22T13:30:00.000Z',
        contact_name: 'Outro lead sintético',
      },
    ]))
  );

  await page.goto('/#/crm?tab=queue');

  const summary = page.getByRole('region', { name: 'Resumo da fila nesta página' });
  await expect(summary.getByText('1', { exact: true })).toHaveCount(2);
  await expect(summary.getByText('Nesta página')).toHaveCount(4);
  await expect(page.getByRole('row', { name: /Lead Sintético/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Outro lead sintético/ })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Buscar nesta página da fila' }).fill('Validar prazo');
  await expect(page.getByRole('row', { name: /Outro lead sintético/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Lead Sintético/ })).toHaveCount(0);
});

test('a Fila mantém contexto explícito e oferece os quatro cortes', async ({ page }) => {
  const requestedFilters = [];
  const rows = [
    firstContact,
    {
      ...firstContact,
      action_id: '33333333-3333-4333-8333-333333333333',
      contact_name: 'Contato ambíguo',
      contact_context: {
        status: 'review',
        last_contact_at: null,
        last_contact_direction: null,
        blockers: [],
      },
      whatsapp_href: null,
    },
  ];
  await page.route('**/api/commercial-queue**', (route) => {
    requestedFilters.push(/[?&]filter=([^&]+)/.exec(route.request().url())?.[1] ?? null);
    return json(route, queue(rows));
  });

  await page.goto('/#/crm?tab=queue');
  for (const label of ['Atrasadas', 'Hoje', 'Agendadas', 'Encerradas']) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible();
  }
  await expect(
    page.getByRole('table').getByText('Último contato (cliente): 11/09/2026, 08:30')
  ).toBeVisible();
  await page.getByRole('row', { name: /Contato ambíguo/ }).getByText(/revisão necessária/).waitFor();
  await expect(
    page.getByRole('table').getByText('Último contato: revisão necessária (atribuição ambígua)')
  ).toBeVisible();
  await expect(page.getByRole('table').getByText('WhatsApp indisponível')).toBeVisible();

  await page.getByRole('tab', { name: 'Agendadas' }).click();
  await expect.poll(() => requestedFilters.at(-1)).toBe('scheduled');
});

test('a Fila alterna urgência sem perder o contexto da ação', async ({ page }) => {
  const requests = [];
  let urgent = false;
  await page.route('**/api/commercial-queue**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      requests.push(body);
      urgent = body.is_urgent;
      return json(route, {
        opportunity_id: firstContact.opportunity_id,
        action_id: firstContact.action_id,
        version: 1,
        is_urgent: urgent,
      });
    }
    return json(route, queue([{ ...firstContact, is_urgent: urgent, priority: urgent ? 1 : 4 }]));
  });

  await page.goto('/#/crm?tab=queue');
  await page.getByRole('row', { name: /Lead Sintético/ }).getByRole('button', { name: 'Marcar como urgente' }).click();
  await expect.poll(() => requests).toEqual([
    {
      command: 'set_urgency',
      opportunity_id: firstContact.opportunity_id,
      action_id: firstContact.action_id,
      expected_version: 1,
      is_urgent: true,
    },
  ]);
  await expect(page.getByRole('button', { name: 'Remover urgência' })).toBeVisible();
  await expect(page.getByRole('table').getByTitle('Urgente')).toBeVisible();
});

test('a Fila mostra o resultado terminal e bloqueia mutações de uma ação ainda ativa', async ({
  page,
}) => {
  const closedActive = {
    ...firstContact,
    action_id: '77777777-7777-4777-8777-777777777777',
    opportunity_id: '88888888-8888-4888-8888-888888888888',
    contact_name: 'Oportunidade encerrada',
    state: 'active',
    reason: 'Ação ativa após encerramento',
    due_status: 'closed',
    opportunity_status: 'Perdido',
    terminal_status: 'Perdido',
    terminal_reason: 'Cliente escolheu outro fornecedor',
    terminal_at: '2026-09-11T14:00:00.000Z',
  };
  await page.route('**/api/commercial-queue**', (route) => {
    const filter = /[?&]filter=([^&]+)/.exec(route.request().url())?.[1];
    return json(route, filter === 'closed' ? queue([closedActive]) : queue([]));
  });

  await page.goto('/#/crm?tab=queue');
  await page.getByRole('tab', { name: 'Encerradas' }).click();

  const row = page.getByRole('row', { name: /Oportunidade encerrada/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Status final: Perdido');
  await expect(row).toContainText('Motivo do encerramento: Cliente escolheu outro fornecedor');
  await expect(row).toContainText('Encerrado em: 11/09/2026, 11:00');
  await expect(row.getByRole('button', { name: 'Nova ação' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Reagendar' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Concluir' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Marcar como urgente' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Histórico' })).toBeVisible();
});

test('a Fila envia o reagendamento com data civil e token da ação', async ({ page }) => {
  const requests = [];
  await page.route('**/api/commercial-queue**', async (route) => {
    if (route.request().method() === 'POST') {
      requests.push(JSON.parse(route.request().postData() || '{}'));
      return json(route, {
        action_id: firstContact.action_id,
        opportunity_id: firstContact.opportunity_id,
        state: 'superseded',
        version: 2,
        closed: false,
        successor: null,
      });
    }
    return json(route, queue([firstContact]));
  });

  await page.goto('/#/crm?tab=queue');
  const row = page.getByRole('row', { name: /Lead Sintético/ });
  await row.getByRole('button', { name: 'Reagendar' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Data local').fill('2026-09-15');
  await dialog.getByLabel('Horário local').fill('14:30');
  await dialog.getByLabel('Motivo').fill('Cliente pediu retorno');
  await dialog.getByRole('button', { name: 'Reagendar' }).click();

  await expect
    .poll(() => requests)
    .toEqual([
      {
        command: 'reschedule',
        action_id: firstContact.action_id,
        expected_version: 1,
        kind: 'first_contact',
        due_date: '2026-09-15',
        due_time: '14:30',
        reason: 'Cliente pediu retorno',
      },
    ]);
});

test('a ação da Fila abre o cadastro do contato quando o cliente está vinculado', async ({
  page,
}) => {
  await page.route('**/api/commercial-queue**', (route) =>
    json(
      route,
      queue([
        {
          ...firstContact,
          client_id: '33333333-3333-4333-8333-333333333333',
          client_name: 'Empresa Sintética',
        },
      ])
    )
  );
  await page.route('**/api/client-detail**', (route) =>
    json(route, { success: true, data: { id: 'Empresa Sintética', nome: 'Empresa Sintética' } })
  );

  await page.goto('/#/crm?tab=queue');
  await page.getByRole('link', { name: 'Empresa Sintética', exact: true }).click();

  await expect(page).toHaveURL(/#\/leads\/cliente\/33333333-3333-4333-8333-333333333333$/);
});

test('Fila vazia explica o próximo passo sem inventar ação', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) => json(route, queue([])));

  await page.goto('/#/crm?tab=queue');

  await expect(page.getByRole('status', { name: 'Nenhuma próxima ação' })).toBeVisible();
  await expect(
    page.getByText('Leads novos entram aqui com o primeiro atendimento pendente.')
  ).toBeVisible();
});

test('falha ao carregar a Fila aparece em português com nova tentativa', async ({ page }) => {
  let failing = true;
  await page.route('**/api/commercial-queue**', (route) =>
    failing
      ? json(route, { error: 'Não foi possível carregar a fila comercial.' }, 503)
      : json(route, queue([firstContact]))
  );

  await page.goto('/#/crm?tab=queue');

  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível carregar a fila comercial.'
  );
  failing = false;
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('row', { name: /Lead Sintético/ })).toBeVisible();
});

test('resposta atrasada de uma página antiga não sobrescreve a página atual', async ({ page }) => {
  const staleRows = Array.from({ length: 3 }, (_, index) => ({
    ...firstContact,
    action_id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    contact_name: `Lead antigo ${index + 1}`,
  }));
  const freshRows = [
    {
      ...firstContact,
      action_id: '55555555-5555-4555-8555-555555555555',
      contact_name: 'Lead atual',
      demand_summary: 'Demanda da página atual',
    },
  ];
  // StrictMode mounts twice in development, so two page requests are in flight.
  // The older one answers last and must not win.
  let requests = 0;

  await page.route('**/api/commercial-queue**', async (route) => {
    requests += 1;
    const isStale = requests === 1;
    if (isStale) await new Promise((resolve) => globalThis.setTimeout(resolve, 1500));
    return json(route, {
      data: isStale ? staleRows : freshRows,
      total: isStale ? 3 : 1,
      page: 1,
      page_size: 25,
    });
  });

  await page.goto('/#/crm?tab=queue');

  await expect(page.getByRole('row', { name: /Lead atual/ })).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByRole('row', { name: /Lead atual/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Lead antigo 1\b/ })).toHaveCount(0);
  expect(requests).toBeGreaterThan(1);
});

test('a página que deixou de existir é recarregada com o trabalho restante', async ({ page }) => {
  // The real server clamps a page that a close/removal pushed out of range.
  // The panel must adopt the served page and keep showing remaining rows
  // instead of an empty state with unusable navigation.
  const row = (index, name) => ({
    ...firstContact,
    action_id: `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`,
    contact_name: name,
  });
  const remaining = Array.from({ length: 5 }, (_, index) =>
    row(index, `Lead restante ${index + 1}`)
  );
  const full = Array.from({ length: 25 }, (_, index) => row(index, `Lead ${index + 1}`));
  const requestedPages = [];
  let shrunk = false;

  await page.route('**/api/commercial-queue**', (route) => {
    const requested = Number(/[?&]page=(\d+)/.exec(route.request().url())?.[1] || '1');
    requestedPages.push(requested);
    if (requested >= 3) shrunk = true;
    if (shrunk) {
      // 30 rows remain: the last valid page is 2, so page 3 is clamped.
      return json(route, {
        data: remaining,
        total: 30,
        page: Math.min(requested, 2),
        page_size: 25,
      });
    }
    return json(route, { data: full, total: 60, page: requested, page_size: 25 });
  });

  await page.goto('/#/crm?tab=queue');
  await expect(page.getByText('Página 1 de 3')).toBeVisible();
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.getByText('Página 2 de 3')).toBeVisible();
  await page.getByRole('button', { name: 'Próxima' }).click();

  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  await expect(page.getByRole('row', { name: /Lead restante 1\b/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Anterior' })).toBeEnabled();

  // Refreshing must keep working from the page the server actually served, not
  // from the stale out-of-range page the operator had requested.
  requestedPages.length = 0;
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.getByRole('row', { name: /Lead restante 1\b/ })).toBeVisible();
  expect(requestedPages).toEqual([2]);
});

test('a Fila pagina os resultados em vez de esconder o trabalho restante', async ({ page }) => {
  const requested = [];
  const firstPageItems = Array.from({ length: 25 }, (_, index) => ({
    ...firstContact,
    action_id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    contact_name: `Lead ${index + 1}`,
  }));
  const lastItem = {
    ...firstContact,
    action_id: '22222222-2222-4222-8222-222222222222',
    contact_name: 'Lead 26',
    demand_summary: 'Última demanda da fila',
  };

  await page.route('**/api/commercial-queue**', (route) => {
    const requestUrl = route.request().url();
    requested.push({
      page: /[?&]page=(\d+)/.exec(requestUrl)?.[1] ?? null,
      pageSize: /[?&]page_size=(\d+)/.exec(requestUrl)?.[1] ?? null,
    });
    const pageNumber = Number(/[?&]page=(\d+)/.exec(requestUrl)?.[1] || '1');
    const items = pageNumber === 1 ? firstPageItems : [lastItem];
    return json(route, {
      data: items,
      total: 26,
      page: pageNumber,
      page_size: 25,
    });
  });

  await page.goto('/#/crm?tab=queue');
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  await expect(page.getByRole('row', { name: /Lead 1\b/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Lead 26/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Próxima' }).click();

  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  const lastRow = page.getByRole('row', { name: /Lead 26/ });
  await expect(lastRow).toBeVisible();
  await expect(lastRow.getByText('Última demanda da fila')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  expect(requested.at(-1)).toEqual({ page: '2', pageSize: '25' });
});
