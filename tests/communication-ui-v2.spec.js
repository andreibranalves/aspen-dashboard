// @ts-check
import { expect, test } from '@playwright/test';

test('fluxos exibem contexto, etapas, estado e data reais', async ({ page }) => {
  await page.route('**/api/communication-flows*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        selectedFlowId: 'flow-real',
        flows: [
          {
            id: 'flow-real',
            name: 'Fluxo comercial',
            context: 'email_first_contact',
            channel: 'whatsapp',
            vendor_name: 'Juliana',
            enabled: true,
            delay_min_seconds: 5,
            delay_max_seconds: 8,
            max_media_per_product_group: 1,
            created_at: '2026-08-01T09:00:00.000Z',
            updated_at: '2026-08-02T09:00:00.000Z',
            steps: [
              { id: 'step-text', type: 'text', template: 'Mensagem configurada' },
              { id: 'step-document', type: 'document', source: 'quotation_pdf' },
            ],
          },
        ],
      }),
    });
  });

  await page.goto('/#/comunicacao?tab=flows');

  await expect(page.getByRole('heading', { name: 'Fluxo comercial' })).toBeVisible();
  await expect(page.getByText('Primeiro contato por e-mail').first()).toBeVisible();
  await expect(page.getByText('2 etapas').first()).toBeVisible();
  await expect(page.getByText('Ativo').first()).toBeVisible();
  await expect(page.locator('time[datetime="2026-08-02T09:00:00.000Z"]').first()).toBeVisible();
  await expect(page.getByText('Mensagem configurada').first()).toBeVisible();
});

test('histórico mantém status, orçamento, etapas e data do evento', async ({ page }) => {
  await page.route('**/api/communication-send-events*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [
          {
            id: 'event-real',
            status: 'failed',
            flow_name: 'Fluxo comercial',
            quotation_id: 'ORC-2026-001',
            phone: '5511999999999',
            steps_sent: 1,
            steps_planned: 2,
            sent_at: '2026-08-02T09:00:00.000Z',
          },
        ],
      }),
    });
  });

  await page.goto('/#/comunicacao?tab=history');

  await expect(page.getByRole('heading', { name: 'Histórico de envios' })).toBeVisible();
  await expect(page.getByText('Falhou')).toBeVisible();
  await expect(page.getByText('ORC-2026-001')).toBeVisible();
  await expect(page.getByText('1/2 etapas')).toBeVisible();
  await expect(page.locator('time[datetime="2026-08-02T09:00:00.000Z"]').first()).toBeVisible();
});
