// @ts-check
import { test, expect } from '@playwright/test';
import { URL } from 'node:url';

const STAGE_NAMES = {
  'Novo Lead': 'Novo lead',
  'Contato Feito': 'Contato feito',
  'Orcamento Enviado': 'Orçamento enviado',
  'Em Negociacao': 'Em negociação',
  'Arte Aprovada': 'Arte aprovada',
  'Pedido Fechado': 'Pedido fechado',
  Perdido: 'Perdido',
};

const CRM_DEALS_INITIAL = {
  columns: [
    { status: 'Novo Lead', count: 0, deals: [] },
    { status: 'Contato Feito', count: 0, deals: [] },
    {
      status: 'Orcamento Enviado',
      count: 1,
      deals: [
        {
          id: 'DEAL-OLD',
          lead_name: 'Cliente Antigo',
          client_id: '11111111-1111-4111-8111-111111111111',
          email: 'antigo@example.com',
          telefone: '5511999990000',
          quotation: 'QTN-OLD',
          follow_up_stage: 0,
          modificado_em: '2026-06-01T10:00:00.000Z',
          criado_em: '2026-05-01T10:00:00.000Z',
          status: 'Orcamento Enviado',
        },
      ],
    },
    { status: 'Em Negociacao', count: 0, deals: [] },
    { status: 'Arte Aprovada', count: 0, deals: [] },
    { status: 'Pedido Fechado', count: 0, deals: [] },
    { status: 'Perdido', count: 0, deals: [] },
  ].map((column) => ({ ...column, name: STAGE_NAMES[column.status] })),
};

const CRM_DEALS_AFTER = {
  columns: CRM_DEALS_INITIAL.columns.map((column) =>
    column.status === 'Orcamento Enviado'
      ? { ...column, count: 0, deals: [] }
      : column.status === 'Perdido'
        ? {
            ...column,
            count: 1,
            deals: [{ ...CRM_DEALS_INITIAL.columns[2].deals[0], status: 'Perdido' }],
          }
        : column
  ),
};

const PRUNE_CANDIDATES_INITIAL = {
  candidates: [
    {
      deal_id: 'DEAL-OLD',
      lead_name: 'Cliente Antigo',
      quotation: 'QTN-OLD',
      quotation_date: '2026-05-01',
      age_days: 56,
      deal_modified: '2026-06-01T10:00:00.000Z',
      grand_total: 1500,
    },
  ],
  meta: { threshold_days: 30, protect_recent_days: 7, count: 1 },
};

const PRUNE_CANDIDATES_EMPTY = {
  candidates: [],
  meta: { threshold_days: 30, protect_recent_days: 7, count: 0 },
};

function crmDealsForStatus(status) {
  return {
    columns: CRM_DEALS_INITIAL.columns.map((column) =>
      column.status === status
        ? {
            ...column,
            count: 1,
            deals: [{ ...CRM_DEALS_INITIAL.columns[2].deals[0], status }],
          }
        : { ...column, count: 0, deals: [] }
    ),
  };
}

test('reviews and marks stale Kanban deals as Perdido @crm', async ({ page }) => {
  let pruned = false;
  let postedBody = null;

  await page.route('**/api/crm-deals**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pruned ? CRM_DEALS_AFTER : CRM_DEALS_INITIAL),
    });
  });

  await page.route('**/api/crm-prune-candidates', async (route) => {
    if (route.request().method() === 'POST') {
      postedBody = route.request().postDataJSON();
      pruned = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, updated: 1, skipped: 0, skipped_deals: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pruned ? PRUNE_CANDIDATES_EMPTY : PRUNE_CANDIDATES_INITIAL),
    });
  });

  await page.goto('/#/crm?tab=deals');

  await expect(page.getByText('(11) 99999-0000', { exact: true })).toBeVisible();
  await expect(page.getByText('Revisar pipeline', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Revisar pipeline (1)' }).click();

  await expect(page.getByText('Revisar limpeza de pipeline')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Cliente Antigo', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'QTN-OLD', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Marcar selecionados como Perdido' }).click();

  await expect.poll(() => postedBody).toEqual({ deal_ids: ['DEAL-OLD'] });
  await expect(page.getByText('1 oportunidades marcadas como Perdido. 0 ignoradas.')).toBeVisible();
  await expect(page.getByText('Revisar pipeline', { exact: true }).first()).toHaveCount(0);
});

test('moves a deal from the accessible Mover para menu and restores focus @crm', async ({
  page,
}) => {
  let persistedStatus = 'Orcamento Enviado';
  let putBody = null;

  await page.route('**/api/crm-deals**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(crmDealsForStatus(persistedStatus)),
    });
  });
  await page.route('**/api/crm-prune-candidates', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PRUNE_CANDIDATES_EMPTY),
    });
  });
  await page.route('**/api/crm-update-deal', async (route) => {
    putBody = route.request().postDataJSON();
    persistedStatus = putBody.status;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.goto('/#/crm?tab=deals');

  const moveMenu = page.getByRole('combobox', { name: 'Mover para Cliente Antigo' });
  await expect(moveMenu).toHaveValue('Orcamento Enviado');
  await moveMenu.selectOption('Em Negociacao');

  await expect
    .poll(() => putBody)
    .toEqual({
      deal_id: 'DEAL-OLD',
      status: 'Em Negociacao',
    });
  await expect(moveMenu).toHaveValue('Em Negociacao');
  await expect(moveMenu).toBeFocused();
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
    'Cliente Antigo movido para Em negociação.'
  );

  await page.getByRole('link', { name: 'Abrir lead Cliente Antigo' }).click();
  await expect(page).toHaveURL(/#\/leads\/cliente\/11111111-1111-4111-8111-111111111111$/);
});

test('refetches the server state after a failed deal move @crm', async ({ page }) => {
  let dealRequests = 0;

  await page.route('**/api/crm-deals**', async (route) => {
    dealRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(crmDealsForStatus('Orcamento Enviado')),
    });
  });
  await page.route('**/api/crm-prune-candidates', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PRUNE_CANDIDATES_EMPTY),
    });
  });
  await page.route('**/api/crm-update-deal', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Falha temporária.' }),
    });
  });

  await page.goto('/#/crm?tab=deals');

  const moveMenu = page.getByRole('combobox', { name: 'Mover para Cliente Antigo' });
  await moveMenu.selectOption('Em Negociacao');
  await expect(moveMenu).toBeFocused();
  await expect(moveMenu).toHaveValue('Orcamento Enviado');
  await expect.poll(() => dealRequests).toBeGreaterThan(1);
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
    'Não foi possível mover Cliente Antigo. O pipeline foi restaurado.'
  );
});

test('creates, renames, reorders and removes an empty pipeline stage @crm', async ({ page }) => {
  const stages = CRM_DEALS_INITIAL.columns.map((column, position) => ({
    key: column.status,
    name: column.name,
    position,
    role:
      column.status === 'Novo Lead'
        ? 'new'
        : column.status === 'Orcamento Enviado'
          ? 'issued'
          : column.status === 'Pedido Fechado'
            ? 'won'
            : column.status === 'Perdido'
              ? 'lost'
              : null,
    dealCount: column.deals.length,
  }));
  const mutations = [];

  await page.route('**/api/crm-deals**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        columns: stages.map((stage) => ({
          status: stage.key,
          name: stage.name,
          count: stage.dealCount,
          deals: [],
        })),
      }),
    });
  });
  await page.route('**/api/crm-prune-candidates', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PRUNE_CANDIDATES_EMPTY),
    });
  });
  await page.route('**/api/crm-pipeline-stages**', async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stages }),
      });
      return;
    }
    if (method === 'POST') {
      const body = request.postDataJSON();
      mutations.push({ method, body });
      const stage = {
        key: 'custom_triagem',
        name: body.name,
        position: stages.length,
        role: null,
        dealCount: 0,
      };
      stages.push(stage);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ stage }),
      });
      return;
    }
    if (method === 'PATCH') {
      const body = request.postDataJSON();
      mutations.push({ method, body });
      if (body.name) stages.find((stage) => stage.key === body.key).name = body.name;
      if (body.ordered_keys) {
        body.ordered_keys.forEach((key, position) => {
          stages.find((stage) => stage.key === key).position = position;
        });
        stages.sort((left, right) => left.position - right.position);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          body.name ? { stage: stages.find((stage) => stage.key === body.key) } : { stages }
        ),
      });
      return;
    }
    mutations.push({ method, key: new URL(request.url()).searchParams.get('key') });
    stages.splice(
      stages.findIndex((stage) => stage.key === 'custom_triagem'),
      1
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.goto('/#/crm?tab=deals');
  await page.getByRole('button', { name: 'Editar etapas' }).click();
  await expect(page.getByRole('dialog', { name: 'Editar etapas do funil' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Não é possível remover Novo lead/ })
  ).toBeDisabled();

  await page.getByLabel('Nova etapa').fill('Triagem');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText('Triagem', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Renomear Triagem' }).click();
  await page.getByLabel('Nome da etapa').fill('Qualificação');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Qualificação', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Mover Qualificação para cima' }).click();
  await page.getByRole('button', { name: 'Remover Qualificação' }).click();
  await page.getByRole('button', { name: 'Remover etapa' }).click();
  await expect(page.getByText('Qualificação', { exact: true })).toHaveCount(0);

  expect(mutations.map((mutation) => mutation.method)).toEqual([
    'POST',
    'PATCH',
    'PATCH',
    'DELETE',
  ]);
});
