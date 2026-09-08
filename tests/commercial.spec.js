// @ts-check
import { expect, test } from '@playwright/test';

function json(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const deal = {
  id: 'deal-commercial',
  lead_name: 'Cliente Comercial',
  client_id: '11111111-1111-4111-8111-111111111111',
  email: 'cliente@example.com',
  telefone: '5511999990000',
  quotation: 'ORC-COMERCIAL',
  quotation_id: 'quotation-commercial',
  next_step: 'Retomar contato',
  status: 'Orcamento Enviado',
  modificado_em: '2026-08-20T10:00:00.000Z',
};

const crm = {
  columns: [
    { status: 'Novo Lead', count: 0, deals: [] },
    { status: 'Contato Feito', count: 0, deals: [] },
    { status: 'Orcamento Enviado', count: 1, deals: [deal] },
    { status: 'Em Negociacao', count: 0, deals: [] },
    { status: 'Arte Aprovada', count: 0, deals: [] },
    { status: 'Pedido Fechado', count: 0, deals: [] },
    { status: 'Perdido', count: 0, deals: [] },
  ],
};

function dashboard() {
  return {
    success: true,
    summary: {
      total_revenue: 0,
      orders_count: 0,
      avg_ticket: 0,
      open_orders: 0,
      conversion_rate: 0,
    },
    stale_quotations: [
      {
        id: 'ORC-SEM-RESPOSTA',
        customer: 'Cliente sem resposta',
        age: 3,
        value: 1800,
        status: 'emitido',
      },
    ],
  };
}

function followUpList() {
  return {
    data: [],
    total: 0,
    page: 1,
    page_size: 25,
  };
}

test('comercial alterna negócios entre Lista e Quadro', async ({ page }) => {
  await page.route('**/api/crm-deals**', (route) => json(route, crm));
  await page.route('**/api/crm-prune-candidates', (route) =>
    json(route, { candidates: [], meta: { threshold_days: 30, protect_recent_days: 7, count: 0 } })
  );

  await page.goto('/#/crm');
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Negócios' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('link', { name: 'Abrir lead Cliente Comercial' })).toBeVisible();
  await expect(page.getByText('(11) 99999-0000', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Quadro' }).click();
  await expect(page).toHaveURL(/#\/crm\?view=board$/);
  await expect(page.getByRole('region', { name: 'Pipeline CRM' })).toBeVisible();
});

test('comercial alterna Retornos entre Sem resposta e Após envio', async ({ page }) => {
  await page.route('**/api/sales-dashboard**', (route) => json(route, dashboard()));
  await page.route('**/api/follow-ups**', (route) => json(route, followUpList()));

  await page.goto('/#/crm?tab=returns&return=unanswered');
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Sem resposta' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('link', { name: 'Abrir orçamento ORC-SEM-RESPOSTA' })).toBeVisible();

  await page.getByRole('tab', { name: 'Após envio' }).click();
  await expect(page).toHaveURL(/#\/crm\?tab=returns&return=sent$/);
  await expect(page.getByRole('tab', { name: 'Prontos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nenhum follow-up' })).toBeVisible();
});
