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
    eligibility_version: options.eligibilityVersion || version,
    state: options.state || view,
    follow_up_id: options.followUpId || null,
    message_snapshot: null,
    closed_reason: null,
    approved_at: null,
    sent_at: null,
    updated_at: timestamp,
  };
}

function list(data) {
  return { data, total: data.length, page: 1, page_size: 25 };
}

test('operador alterna filas e aprova ou dispensa follow-ups', async ({ page }) => {
  const rows = {
    ready: followUp('ready', { number: 'ORC-READY' }),
    waiting: followUp('waiting', { number: 'ORC-WAITING' }),
    sent: followUp('sent', { number: 'ORC-SENT', state: 'sent', followUpId: 'follow-up-sent' }),
    dismissed: followUp('dismissed', { number: 'ORC-DISMISSED', state: 'dismissed', followUpId: 'follow-up-dismissed' }),
    attention: followUp('attention', { number: 'ORC-ATTENTION', state: 'needs_review', followUpId: 'follow-up-attention' }),
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
  await expect(page.getByText('ORC-READY')).toBeVisible();

  await page.getByRole('tab', { name: 'Aguardando 24h' }).click();
  await expect(page.getByText('ORC-WAITING')).toBeVisible();
  await page.getByRole('tab', { name: 'Enviados' }).click();
  await expect(page.getByText('ORC-SENT')).toBeVisible();
  await page.getByRole('tab', { name: 'Dispensados' }).click();
  await expect(page.getByText('ORC-DISMISSED')).toBeVisible();
  await page.getByRole('tab', { name: 'Atenção' }).click();
  await expect(page.getByText('ORC-ATTENTION')).toBeVisible();

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
    new Set(requests.filter(({ method }) => method === 'GET').map(({ view }) => view)),
  ).toEqual(new Set(['ready', 'waiting', 'sent', 'dismissed', 'attention']));
});
