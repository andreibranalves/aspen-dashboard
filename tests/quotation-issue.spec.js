import { expect, test } from '@playwright/test';

const key = '550e8400-e29b-41d4-a716-446655440000';
const draft = {
  index: 0,
  original: { nome: 'Cliente' },
  edited: {
    nome: 'Cliente', email: '', telefone: '', urgente: false, origem: 'Google Ads', cnpj: '',
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
    items: [{ item_code: 'SKU-1', item_name: 'Produto', qty: 2, rate: 10 }], prazo_producao: '',
  },
  approved: false, discarded: false,
};

async function setup(page, issueResponse, postResponse = issueResponse, { deferPost = false, idempotencyKey = key } = {}) {
  const requests = [];
  let releasePost;
  const postReleased = new Promise((resolve) => { releasePost = resolve; });
  await page.route('/api/**', async (route) => {
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
    if (url.pathname.endsWith('/orcamento')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        success: true,
        quotation_id: 'q-1',
        quotation_name: 'ORC-20260001',
        quotation_uuid: '11111111-1111-4111-8111-111111111101',
        revision_id: 'r-1',
        quote_revision_id: 'r-1',
        revision_number: 1,
        concurrency_token: '2026-08-13T00:00:00.000Z',
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.addInitScript(({ storedDraft, idempotencyKey }) => {
    globalThis.sessionStorage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [{ ...storedDraft, ...(idempotencyKey ? { issueIdempotencyKey: idempotencyKey } : {}) }] }));
  }, { storedDraft: draft, idempotencyKey });
  return { requests, releasePost: () => releasePost?.() };
}

test('emission persists once and navigates to the canonical detail @quotations @critical', async ({ page }) => {
  const { requests, releasePost } = await setup(page, null, {
    quotationId: 'q-1', businessNumber: 'ORC-20260001', revisionId: 'r-1', revisionNumber: 1,
    status: 'emitido', issuedAt: '2026-08-13T00:00:00.000Z', validUntil: '2026-08-28', pdfUrl: '/api/quotation-preview?id=q-1&format=pdf',
  }, { deferPost: true, idempotencyKey: null });
  let saveWrites = 0;
  page.context().on('request', (request) => {
    if (request.url().endsWith('/api/orcamento') && request.method() === 'POST') saveWrites += 1;
  });
  await page.goto('/#/auto');
  await page.waitForTimeout(500);
  const saveRequestPromise = page.waitForRequest((request) => request.url().endsWith('/api/orcamento') && request.method() === 'POST');
  const postRequestPromise = page.waitForRequest((request) => request.url().includes('/api/quotation-issues') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Emitir orçamento' }).dblclick();
  const saveRequest = await saveRequestPromise;
  const postRequest = await postRequestPromise;
  expect(saveRequest.postDataJSON().extracted.items).toHaveLength(1);
  await expect.poll(() => saveWrites).toBe(1);
  const postKey = postRequest.headers()['idempotency-key'];
  expect(postKey).toMatch(/^[0-9a-f-]{8}-[0-9a-f-]{27}$/i);
  await expect.poll(() => page.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts') || '{}').drafts?.[0]?.issueIdempotencyKey)).toBe(postKey);
  releasePost();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  const recordedPost = requests.find((request) => request.method() === 'POST');
  expect(recordedPost?.headers()['idempotency-key']).toBe(postKey);
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
  expect(requests.some((request) => request.url().includes('send-whatsapp'))).toBe(false);
  const postCount = requests.filter((request) => request.method() === 'POST').length;
  const saveCount = saveWrites;
  await page.reload();
  await page.waitForTimeout(300);
  expect(requests.filter((request) => request.method() === 'POST').length).toBe(postCount);
  expect(saveWrites).toBe(saveCount);
  expect(requests.some((request) => request.url().includes('send-whatsapp'))).toBe(false);
});

test('active emission remains processing while POST is pending @quotations @critical', async ({ page }) => {
  const { releasePost } = await setup(page, null, {
    quotationId: 'q-1', businessNumber: 'ORC-20260001', revisionId: 'r-1', revisionNumber: 1,
    status: 'emitido', issuedAt: '2026-08-13T00:00:00.000Z', validUntil: '2026-08-28', pdfUrl: '/api/quotation-preview?id=q-1&format=pdf',
  }, { deferPost: true, idempotencyKey: null });
  await page.goto('/#/auto');
  const postRequest = page.waitForRequest((request) => request.url().includes('/api/quotation-issues') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await postRequest;
  await expect(page.getByRole('button', { name: 'Emitindo…' })).toBeDisabled();
  releasePost();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('GET recovery is read-only after a lost POST response @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, { state: 'completed', quotationId: 'q-1', businessNumber: 'ORC-20260001', revisionId: 'r-1', revisionNumber: 1, status: 'emitido', issuedAt: '2026-08-13T00:00:00.000Z', validUntil: '2026-08-28', pdfUrl: '/api/quotation-preview?id=q-1&format=pdf' });
  await page.goto('/#/auto');
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
  expect(requests.some((request) => request.method() === 'GET')).toBe(true);
  expect(requests.some((request) => request.method() === 'POST')).toBe(false);
});
