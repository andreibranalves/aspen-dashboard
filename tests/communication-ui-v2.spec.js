// @ts-check
import { expect, test } from '@playwright/test';

const editableFlow = {
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
    { id: 'step-final', type: 'text', template: 'Mensagem final' },
  ],
};

async function mockFlows(page, saveStatus = 200) {
  await page.route('**/api/communication-flows*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: saveStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          saveStatus === 200 ? { success: true } : { error: 'Detalhe interno não exibido' }
        ),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        selectedFlowId: editableFlow.id,
        flows: [editableFlow],
      }),
    });
  });
}

test('fluxos exibem contexto, etapas, estado e data reais', async ({ page }) => {
  await mockFlows(page);

  await page.goto('/#/comunicacao?tab=flows');

  await expect(page.getByRole('heading', { name: 'Fluxo comercial' })).toHaveCount(1);
  await expect(page.getByText('Primeiro contato por e-mail').first()).toBeVisible();
  await expect(page.getByText('3 etapas')).toHaveCount(1);
  await expect(page.getByText('Ativo')).toHaveCount(1);
  await expect(page.locator('time[datetime="2026-08-02T09:00:00.000Z"]')).toHaveCount(1);
  await expect(page.getByText('Mensagem configurada').first()).toBeVisible();
});

test('salva a última etapa na área de edição sem iniciar envio', async ({ page }) => {
  await mockFlows(page);
  const saveRequest = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/api/communication-flows')
  );
  const transportRequests = [];
  page.on('request', (request) => {
    const requestUrl = request.url();
    const requestPath = requestUrl.replace(/^https?:\/\/[^/]+/, '');
    if (requestPath.startsWith('/api/') && /send|whatsapp/i.test(requestPath)) {
      transportRequests.push(request.url());
    }
  });

  await page.goto('/#/comunicacao?tab=flows');

  const finalMessage = page.getByLabel('Mensagem').last();
  await finalMessage.fill('Mensagem final alterada');

  await expect(page.getByText('Alterações não salvas')).toBeVisible();
  const saveButton = page.getByRole('button', { name: 'Salvar' });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await finalMessage.scrollIntoViewIfNeeded();
    await expect(saveButton).toBeInViewport();
  }
  await saveButton.click();

  const request = await saveRequest;
  const payload = request.postDataJSON();
  expect(payload.flows[0].steps.at(-1).template).toBe('Mensagem final alterada');
  await expect(page.getByText('Fluxos salvos com sucesso.')).toBeVisible();
  expect(transportRequests).toEqual([]);
});

test('mantém a edição e apresenta erro coerente quando salvar falha', async ({ page }) => {
  await mockFlows(page, 500);
  await page.goto('/#/comunicacao?tab=flows');

  const finalMessage = page.getByLabel('Mensagem').last();
  await finalMessage.fill('Mensagem ainda não salva');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page.getByRole('alert')).toHaveText('Não foi possível salvar os fluxos.');
  await expect(finalMessage).toHaveValue('Mensagem ainda não salva');
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeEnabled();
});

test('protege alterações ao trocar aba ou navegar pela sidebar', async ({ page }) => {
  await mockFlows(page);
  await page.goto('/#/comunicacao?tab=flows');

  const finalMessage = page.getByLabel('Mensagem').last();
  await finalMessage.fill('Texto preservado');

  await page.getByRole('tab', { name: 'Biblioteca de mídias' }).click();
  await expect(page.getByRole('dialog', { name: 'Sair sem salvar?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(finalMessage).toHaveValue('Texto preservado');

  await page.getByRole('button', { name: 'Clientes' }).click();
  await expect(page.getByRole('dialog', { name: 'Sair sem salvar?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(finalMessage).toHaveValue('Texto preservado');

  await page.getByRole('button', { name: 'Clientes' }).click();
  await page.getByRole('button', { name: 'Sair da página' }).click();
  await expect(page).toHaveURL(/#\/leads$/);
});

test('histórico abre o orçamento referenciado, volta para a aba e mantém evento sem referência inerte', async ({
  page,
}) => {
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
          {
            id: 'event-without-quotation',
            status: 'pending',
            flow_name: 'Fluxo sem orçamento',
            steps_sent: 0,
            steps_planned: 1,
          },
        ],
      }),
    });
  });

  await page.goto('/#/comunicacao?tab=history');

  await expect(page.getByRole('heading', { name: 'Histórico de envios' })).toBeVisible();
  await expect(page.getByText('Falhou')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir orçamento ORC-2026-001' })).toBeVisible();
  await expect(page.getByText('1/2 etapas')).toBeVisible();
  await expect(page.getByText('(11) 99999-9999')).toBeVisible();
  await expect(page.locator('time[datetime="2026-08-02T09:00:00.000Z"]').first()).toBeVisible();

  const eventWithoutQuotation = page
    .getByRole('article')
    .filter({ hasText: 'Fluxo sem orçamento' });
  await expect(eventWithoutQuotation.getByRole('button')).toHaveCount(0);
  await expect(eventWithoutQuotation.getByRole('link')).toHaveCount(0);
  await expect(eventWithoutQuotation.getByText('—')).toHaveCount(2);

  await page.getByRole('button', { name: 'Abrir orçamento ORC-2026-001' }).click();
  await expect(page).toHaveURL(/#\/quotations\/ORC-2026-001$/);
  const returnToHistory = page.getByRole('button', { name: 'Voltar para Histórico de envios' });
  await expect(returnToHistory).toBeVisible();
  await returnToHistory.click();

  await expect(page).toHaveURL(/#\/comunicacao\?tab=history$/);
  await expect(page.getByRole('tab', { name: 'Histórico de envios' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
});
