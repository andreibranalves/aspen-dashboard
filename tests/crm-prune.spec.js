// @ts-check
import { test, expect } from '@playwright/test';

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
          email: 'antigo@example.com',
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
  ],
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

  await page.goto('/#/crm');

  await expect(page.getByText('Limpeza de pipeline disponível')).toBeVisible();
  await page.getByRole('button', { name: 'Revisar e marcar como Perdido' }).click();

  await expect(page.getByText('Revisar limpeza de pipeline')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Cliente Antigo', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'QTN-OLD', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Marcar selecionados como Perdido' }).click();

  await expect.poll(() => postedBody).toEqual({ deal_ids: ['DEAL-OLD'] });
  await expect(page.getByText('1 oportunidades marcadas como Perdido. 0 ignoradas.')).toBeVisible();
  await expect(page.getByText('Limpeza de pipeline disponível')).toHaveCount(0);
});
