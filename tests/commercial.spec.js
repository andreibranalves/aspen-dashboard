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
  quote_lead_id: 'lead-commercial',
  lead_source: 'site',
  next_step: 'Retomar contato',
  status: 'Orcamento Enviado',
  modificado_em: '2026-08-20T10:00:00.000Z',
};

const crm = {
  columns: [
    { status: 'Novo Lead', name: 'Novo Lead', count: 0, deals: [] },
    { status: 'Contato Feito', name: 'Contato Feito', count: 0, deals: [] },
    { status: 'Orcamento Enviado', name: 'Orçamento Enviado', count: 1, deals: [deal] },
    { status: 'Em Negociacao', name: 'Em Negociação', count: 0, deals: [] },
    { status: 'Arte Aprovada', name: 'Arte Aprovada', count: 0, deals: [] },
    { status: 'Pedido Fechado', name: 'Pedido Fechado', count: 0, deals: [] },
    { status: 'Perdido', name: 'Perdido', count: 0, deals: [] },
  ],
};

test('comercial alterna negócios entre Lista e Quadro', async ({ page }) => {
  await page.route('**/api/crm-deals**', (route) => json(route, crm));

  await page.goto('/#/crm?tab=deals');
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Negócios' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('link', { name: 'Abrir lead Cliente Comercial' })).toBeVisible();
  await expect(page.getByText('(11) 99999-0000', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo orçamento' }).last()).toBeVisible();

  await page.getByRole('tab', { name: 'Lista' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#\/crm\?tab=deals&view=board$/);
  await expect(page.getByRole('region', { name: 'Pipeline CRM' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Orçamento Enviado' })).toBeVisible();
  await expect(page.getByText('ORC-COMERCIAL', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Origem · site', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Atualizado há \d+ dias$/)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Lista' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('link', { name: 'Abrir orçamento ORC-COMERCIAL' }).click();
  await expect(page).toHaveURL(/#\/quotations\/quotation-commercial$/);
});

test('comercial expõe Fila e Negócios sem Retornos operacionais (#254)', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) =>
    json(route, { data: [], total: 0, page: 1, page_size: 25 })
  );
  await page.route('**/api/crm-deals**', (route) => json(route, crm));

  await page.goto('/#/crm');
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Fila' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Negócios' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Retornos' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Sem resposta' })).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Follow-ups' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Negócios' }).click();
  await expect(page).toHaveURL(/#\/crm\?.*tab=deals/);
  await expect(page.getByRole('tab', { name: 'Negócios' })).toHaveAttribute('aria-selected', 'true');
});
