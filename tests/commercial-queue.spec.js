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
  actor: 'system',
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
  await expect(row.getByText('11/09/2026, 09:00')).toBeVisible();
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
  await page.getByRole('link', { name: 'Empresa Sintética' }).click();

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

test.describe('layout compacto', () => {
  test.use({ viewport: { width: 480, height: 800 } });

  test('o cartão compacto da Fila abre o cadastro do contato vinculado', async ({ page }) => {
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

    await page.goto('/#/crm?tab=queue');
    await page.getByRole('link', { name: 'Empresa Sintética' }).click();

    await expect(page).toHaveURL(/#\/leads\/cliente\/33333333-3333-4333-8333-333333333333$/);
  });
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
