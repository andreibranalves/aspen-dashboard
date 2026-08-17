import { expect, test } from '@playwright/test';

const key = '550e8400-e29b-41d4-a716-446655440000';
const draft = {
  index: 0,
  original: { nome: 'Cliente' },
  edited: {
    nome: 'Cliente', email: '', telefone: '', urgente: false, origem: 'Site', cnpj: '',
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
    items: [{ item_code: 'SKU-1', item_name: 'Produto', qty: 2, rate: 10 }], prazo_producao: '',
  },
  approved: false, discarded: false,
};

async function setup(page, issueResponse, postResponse = issueResponse, { deferPost = false } = {}) {
  const requests = [];
  let releasePost;
  const postReleased = new Promise((resolve) => { releasePost = resolve; });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (url.pathname.endsWith('/quotation-issues')) {
      requests.push(request);
      if (request.method() === 'GET') {
        await route.fulfill({ status: issueResponse ? 200 : 404, contentType: 'application/json', body: JSON.stringify(issueResponse || { error: 'Emissão não encontrada.' }) });
      } else {
        if (deferPost) await postReleased;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(postResponse) });
      }
      return;
    }
    if (url.pathname.endsWith('/quotation-templates')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) });
      return;
    }
    if (url.pathname.endsWith('/communication-flows')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flows: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.addInitScript(({ storedDraft, idempotencyKey }) => {
    globalThis.localStorage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [{ ...storedDraft, ...(idempotencyKey ? { issueIdempotencyKey: idempotencyKey } : {}) }] }));
  }, { storedDraft: draft, idempotencyKey: key });
  return { requests, releasePost: () => releasePost?.() };
}

test('preview and emission use explicit UI clicks with one stable idempotent POST', async ({ page }) => {
  const { requests, releasePost } = await setup(page, null, {
    quotation_id: 'q-1', business_number: 'ORC-20260001', revision_id: 'r-1', revision_number: 1,
    status: 'emitido', issued_at: '2026-08-13T00:00:00.000Z', valid_until: '2026-08-28', pdf_url: '/api/quotation-preview?id=q-1&format=pdf',
  }, { deferPost: true });
  await page.addInitScript(() => {
    const value = JSON.parse(globalThis.localStorage.getItem('aspen_drafts'));
    value.drafts[0].issueIdempotencyKey = undefined;
    globalThis.localStorage.setItem('aspen_drafts', JSON.stringify(value));
  });
  let previewWrites = 0;
  page.context().on('request', (request) => { if (request.url().includes('/api/quotation-preview')) previewWrites += 1; });
  await page.route('**/api/quotation-preview', async (route) => { await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' }); });
  await page.goto('/#/auto');
  await page.waitForTimeout(500);
  const previewRequest = page.waitForRequest('**/api/quotation-preview');
  const previewPopup = page.waitForEvent('popup').catch(() => null);
  await page.getByRole('button', { name: 'Visualizar proposta' }).click();
  await Promise.race([previewRequest, previewPopup]);
  await expect.poll(() => previewWrites).toBe(1);
  expect(previewWrites).toBe(1);
  const postRequestPromise = page.waitForRequest((request) => request.url().includes('/api/quotation-issues') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Gerar orçamento' }).dblclick();
  const postRequest = await postRequestPromise;
  const postKey = postRequest.headers()['idempotency-key'];
  expect(postKey).toMatch(/^[0-9a-f-]{8}-[0-9a-f-]{27}$/i);
  await expect.poll(() => page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('aspen_drafts') || '{}').drafts?.[0]?.issueIdempotencyKey)).toBe(postKey);
  releasePost();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  const recordedPost = requests.find((request) => request.method() === 'POST');
  expect(recordedPost?.headers()['idempotency-key']).toBe(postKey);
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
  await expect(page.getByText('ORC-20260001', { exact: false })).toBeVisible();
  expect(requests.some((request) => request.url().includes('send-whatsapp'))).toBe(false);
  const postCount = requests.filter((request) => request.method() === 'POST').length;
  await page.reload();
  await page.waitForTimeout(300);
  expect(requests.filter((request) => request.method() === 'POST').length).toBe(postCount);
  expect(requests.some((request) => request.url().includes('send-whatsapp'))).toBe(false);
});

test('GET recovery is read-only after a lost POST response', async ({ page }) => {
  const { requests } = await setup(page, { state: 'completed', quotation_id: 'q-1', business_number: 'ORC-20260001', revision_id: 'r-1', revision_number: 1, status: 'emitido', issued_at: '2026-08-13T00:00:00.000Z', valid_until: '2026-08-28', pdf_url: '/api/quotation-preview?id=q-1&format=pdf' });
  await page.goto('/#/auto');
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
  expect(requests.some((request) => request.method() === 'GET')).toBe(true);
  expect(requests.some((request) => request.method() === 'POST')).toBe(false);
});
