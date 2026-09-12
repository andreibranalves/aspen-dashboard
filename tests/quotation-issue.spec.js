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

const issue = {
  quotationId: 'q-1', businessNumber: 'ORC-20260001', revisionId: 'r-1', revisionNumber: 1,
  status: 'emitido', issuedAt: '2026-08-13T00:00:00.000Z', validUntil: '2026-08-28', pdfUrl: '/api/quotation-preview?id=q-1&format=pdf',
};

const saved = {
  quotationId: 'q-1', businessNumber: 'ORC-20260001', revisionId: 'r-1', concurrencyToken: 'token-1',
  snapshot: { items: [{ item_code: 'SKU-1', item_name: 'Produto', qty: 2, rate: 10, _rateManual: false }], frete: '0.00', total: '20.00' },
};

const manualDraft = {
  version: 1,
  clientType: 'new',
  clientSearch: '',
  selectedClient: null,
  newClient: { nome: 'Cliente manual', email: '', telefone: '' },
  leadSource: 'Google Ads',
  cnpj: '',
  address: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
  showAddress: false,
  items: [{ _key: 'sku-1', sku: 'SKU-1', nome: 'Produto', qty: 2, rate: 10, _rateManual: false }],
  prazo: '',
  observacoes: '',
  urgente: false,
  templateKey: '',
};

function storedDraft(overrides = {}) {
  return {
    ...draft,
    saved,
    ...overrides,
  };
}

async function seedManualDraft(page, overrides = {}) {
  await page.addInitScript((value) => {
    globalThis.localStorage.setItem('aspen_manual_draft', JSON.stringify({ ...value, version: 1 }));
  }, { ...manualDraft, ...overrides });
}

function savedResponse(request, overrides = {}) {
  const extracted = request.postDataJSON().extracted;
  const items = extracted.items.map((item) => ({
    item_code: item.item_code,
    qty: String(item.qty),
    nome: item.item_name,
    applied_unit_price: Number(item.rate || 0).toFixed(2),
    manual_rate: item.manual_rate,
  }));
  return {
    success: true,
    quotation_id: 'ORC-20260001',
    quotation_uuid: 'q-1',
    revision_id: 'r-1',
    concurrency_token: 'token-1',
    items,
    frete: extracted.frete || '0.00',
    total: items.reduce((sum, item) => sum + Number(item.qty) * Number(item.applied_unit_price), 0).toFixed(2),
    ...overrides,
  };
}

async function setup(page, {
  storedDraft = draft,
  issueResponse = null,
  postResponse = issue,
  postStatus = 200,
  getResponses = [],
  getStatuses = [],
  deferGet = false,
  deferPost = false,
  deferSave = false,
  saveResponses = [],
  storedDrafts,
  postStatuses = [],
  postResponses = [],
  postBehaviors = [],
  idempotencyKey,
} = {}) {
  const requests = [];
  const saveRequests = [];
  let getCount = 0;
  let saveCount = 0;
  let issuePostCount = 0;
  let releaseGet;
  let releasePost;
  let releaseSave;
  const getReleased = new Promise((resolve) => { releaseGet = resolve; });
  const postReleased = new Promise((resolve) => { releasePost = resolve; });
  const saveReleased = new Promise((resolve) => { releaseSave = resolve; });

  await page.route('/api/**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (url.pathname.endsWith('/quotation-issues')) {
      requests.push(request);
      if (request.method() === 'GET') {
        if (deferGet) await getReleased;
        const response = getResponses[getCount] ?? issueResponse;
        const status = getStatuses[getCount] ?? (response ? 200 : 404);
        getCount += 1;
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response || { error: 'Emissão não encontrada.' }) });
      } else {
        const postIndex = issuePostCount++;
        if (postBehaviors[postIndex] === 'transport') {
          await route.abort('failed');
          return;
        }
        if (deferPost) await postReleased;
        await route.fulfill({ status: postStatuses[postIndex] ?? postStatus, contentType: 'application/json', body: JSON.stringify(postResponses[postIndex] ?? postResponse ?? { error: 'Emissão falhou.' }) });
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
      saveRequests.push(request);
      const response = saveResponses[saveCount++] || savedResponse(request);
      if (deferSave) await saveReleased;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });

  const initialDrafts = (storedDrafts || [storedDraft]).map((value) => ({ ...value }));
  for (const initialDraft of initialDrafts) {
    if (idempotencyKey) initialDraft.issueIdempotencyKey = idempotencyKey;
    if (idempotencyKey === null) delete initialDraft.issueIdempotencyKey;
  }
  await page.addInitScript(({ storedDrafts: initial }) => {
    if (!globalThis.sessionStorage.getItem('aspen_drafts')) {
      globalThis.sessionStorage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: initial }));
    }
  }, { storedDrafts: initialDrafts });
  return {
    requests,
    saveRequests,
    releaseGet: () => releaseGet?.(),
    releasePost: () => releasePost?.(),
    releaseSave: () => releaseSave?.(),
  };
}

async function prepareForcedReload(page) {
  await page.addInitScript(() => {
    const listeners = [];
    const add = globalThis.addEventListener.bind(globalThis);
    const remove = globalThis.removeEventListener.bind(globalThis);
    globalThis.addEventListener = (type, listener, options) => {
      if (type === 'beforeunload') listeners.push({ listener, options });
      return add(type, listener, options);
    };
    globalThis.__aspenAllowReload = () => listeners.splice(0).forEach(({ listener, options }) => remove('beforeunload', listener, options));
  });
}

async function forceReload(page) {
  await page.evaluate(() => {
    globalThis.dispatchEvent(new globalThis.Event('pagehide'));
    globalThis.__aspenAllowReload?.();
  });
  await page.reload();
}

test('emission persists once and navigates to the canonical detail @quotations @critical', async ({ page }) => {
  const { requests, saveRequests, releasePost } = await setup(page, { deferPost: true });
  await page.goto('/#/auto');
  const postRequestPromise = page.waitForRequest((request) => request.url().includes('/api/quotation-issues') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).dblclick();
  const postRequest = await postRequestPromise;
  await expect.poll(() => saveRequests.length).toBe(1);
  expect(postRequest.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/i);
  await expect.poll(() => page.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts') || '{}').drafts?.[0]?.issueIdempotencyKey)).toBe(postRequest.headers()['idempotency-key']);
  releasePost();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
});

test('mantém emissão e edição bloqueadas enquanto o POST oficial está pendente @quotations @critical', async ({ page }) => {
  const { releasePost } = await setup(page, { deferPost: true });
  await page.goto('/#/auto');
  const postRequest = page.waitForRequest((request) => request.url().includes('/api/quotation-issues') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await postRequest;
  await expect(page.getByRole('button', { name: 'Emitindo…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Editar' })).toBeDisabled();
  releasePost();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('não emite quando o armazenamento falha e permite tentar novamente @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, {
    storedDraft: {
      ...draft,
      saved: { quotationId: 'q-1', businessNumber: 'ORC-1', revisionId: 'r-1', concurrencyToken: 'token-1' },
    },
  });
  await page.addInitScript(() => {
    globalThis.__aspenFailStorage = true;
    const originalSetItem = globalThis.Storage.prototype.setItem;
    globalThis.Storage.prototype.setItem = function(keyName, value) {
      if (keyName === 'aspen_drafts' && globalThis.__aspenFailStorage) throw new Error('storage unavailable');
      return originalSetItem.call(this, keyName, value);
    };
  });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect(page.getByText('Não foi possível preparar a emissão com segurança. Verifique o armazenamento do navegador e tente novamente.', { exact: true })).toBeVisible();
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
  await page.evaluate(() => { globalThis.__aspenFailStorage = false; });
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('falha ao persistir o marcador não envia POST, libera o lock e permite retry @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, { storedDraft: { ...draft, saved } });
  await page.addInitScript(() => {
    globalThis.__aspenFailIssueMarker = true;
    const originalSetItem = globalThis.Storage.prototype.setItem;
    globalThis.Storage.prototype.setItem = function(keyName, value) {
      if (keyName === 'aspen_drafts' && globalThis.__aspenFailIssueMarker
        && JSON.parse(value).drafts?.some((candidate) => candidate.issueDispatchStarted === true)) {
        throw new Error('storage unavailable');
      }
      return originalSetItem.call(this, keyName, value);
    };
  });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect(page.getByText('Não foi possível preparar a emissão com segurança. Verifique o armazenamento do navegador e tente novamente.', { exact: true })).toBeVisible();
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
  await page.evaluate(() => { globalThis.__aspenFailIssueMarker = false; });
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('não grava saved quando a persistência não retorna token, mesmo com snapshot válido @quotations @critical', async ({ page }) => {
  const { requests, saveRequests } = await setup(page, {
    saveResponses: [{
      success: true,
      quotation_id: 'ORC-1', quotation_uuid: 'q-1', revision_id: 'r-1',
      items: [{ item_code: 'SKU-1', qty: '2', nome: 'Produto', applied_unit_price: '10.00', manual_rate: false }],
      frete: '0.00', total: '20.00',
    }],
  });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => saveRequests.length).toBe(1);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
  expect(await page.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts')).drafts[0].saved)).toBeUndefined();
});

test('recupera emissão pendente por GET sem repetir POST @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, { issueResponse: { state: 'completed', ...issue }, idempotencyKey: key });
  await page.goto('/#/auto');
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
  expect(requests.filter((request) => request.method() === 'GET')).toHaveLength(1);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
});

test('mantém lock após quatro respostas processing e oferece recuperação explícita @quotations @critical', async ({ page }) => {
  const processing = { state: 'processing', retryAfterMs: 1 };
  const { requests } = await setup(page, { getResponses: [processing, processing, processing, processing, processing], idempotencyKey: key });
  await page.goto('/#/auto');
  await expect(page.getByText('A emissão continua em processamento. Tente novamente quando estiver pronta.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Consultar novamente' })).toBeVisible();
  const beforeRetry = requests.filter((request) => request.method() === 'GET').length;
  await page.getByRole('button', { name: 'Consultar novamente' }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(beforeRetry + 1);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
});

test('mantém lock em falha ambígua e consulta o mesmo idempotency key @quotations @critical', async ({ page }) => {
  const retryable = { state: 'retryable', error: 'Falha antes da emissão. Tente novamente.' };
  const { requests } = await setup(page, { postStatus: 503, postResponse: { error: 'Emissão ambígua.' }, getResponses: [retryable] });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(1);
  const post = requests.find((request) => request.method() === 'POST');
  const get = requests.find((request) => request.method() === 'GET');
  expect(new globalThis.URL(get.url()).searchParams.get('idempotency_key')).toBe(post.headers()['idempotency-key']);
  await expect(page.getByText(/Não foi possível emitir o orçamento|Falha antes da emissão/)).toBeVisible();
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
});

test('persiste snapshot autoritativo antes da emissão @quotations @critical', async ({ page }) => {
  const authoritative = {
    success: true,
    quotation_id: 'ORC-1', quotation_uuid: 'q-1', revision_id: 'r-1', concurrency_token: 'token-1',
    items: [{ item_code: 'SKU-SERVER', sku: 'SKU-SERVER', qty: '5', nome: 'Item confirmado', applied_unit_price: '7.50', manual_rate: false }],
    frete: '3.50', total: '41.00',
  };
  const { saveRequests, releasePost } = await setup(page, { deferPost: true, saveResponses: [authoritative] });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => saveRequests.length).toBe(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts')).drafts[0].saved.snapshot)).toEqual({
    items: [{ item_code: 'SKU-SERVER', item_name: 'Item confirmado', qty: 5, rate: 7.5, _rateManual: false }],
    frete: '3.50', total: '41.00',
  });
  releasePost();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

for (const [label, options] of [
  ['perda de transporte', { postBehaviors: ['transport'] }],
  ['resposta 409', { postStatuses: [409], postResponses: [{ error: 'Emissão concorrente.' }] }],
  ['resposta 503', { postStatuses: [503], postResponses: [{ error: 'Emissão indisponível.' }] }],
]) {
  test(`mantém o lock e aguarda recovery após ${label} @quotations @critical`, async ({ page }) => {
    const retryable = { state: 'retryable', error: 'Falha antes da emissão. Tente novamente.' };
    const { requests, releaseGet } = await setup(page, {
      storedDraft: storedDraft({ saved }),
      idempotencyKey: null,
      deferGet: true,
      getResponses: [retryable],
      postResponses: [{ error: 'Emissão ambígua.' }],
      postStatuses: options.postStatuses || [200],
      postBehaviors: options.postBehaviors || [],
    });
    try {
      await page.goto('/#/auto');
      const issueButtons = page.getByRole('button', { name: 'Emitir orçamento', exact: true });
      await expect(issueButtons).toHaveCount(1);
      await issueButtons.click();
      await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
      await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(1);
      await expect(page.getByRole('button', { name: /Emitindo/ })).toBeDisabled();
      releaseGet();
      await expect(page.getByText(retryable.error, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Emitir orçamento', exact: true })).toBeEnabled();
      expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
    } finally {
      releaseGet();
    }
  });
}

test('recupera uma emissão pendente no modo manual sem repetir o POST @quotations @critical', async ({ page }) => {
  await seedManualDraft(page);
  const { requests } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    issueResponse: { state: 'completed', ...issue },
  });
  await page.goto('/#/manual');
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
  expect(requests.filter((request) => request.method() === 'GET')).toHaveLength(1);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
});

test('persiste recovery manual concluído antes de navegar e não repete GET ao voltar @quotations @critical', async ({ page }) => {
  await seedManualDraft(page);
  const { requests } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    issueResponse: { state: 'completed', ...issue },
  });
  await page.goto('/#/manual');
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
  await expect.poll(() => page.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts')).drafts[0])).toMatchObject({
    issue: { quotationId: 'q-1' },
    status: 'done',
  });
  await page.goto('/#/quotations');
  await expect(page.getByRole('heading', { name: 'Orçamentos' })).toBeVisible();
  await page.goto('/#/manual');
  await expect(page.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
  expect(requests.filter((request) => request.method() === 'GET')).toHaveLength(1);
  expect(page.getByText('Recuperando a emissão pendente…', { exact: true })).toHaveCount(0);
});

test('mantém a recuperação manual acionável após quatro respostas processing @quotations @critical', async ({ page }) => {
  await seedManualDraft(page);
  const processing = { state: 'processing', retryAfterMs: 1 };
  const { requests } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    getResponses: [processing, processing, processing, processing, processing],
  });
  await page.goto('/#/manual');
  await expect(page.getByText('A emissão continua em processamento. Tente novamente quando estiver pronta.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Consultar novamente' })).toBeVisible();
  await expect(page.getByLabel('Nome do cliente')).toBeDisabled();
  await page.getByRole('tab', { name: 'Da conversa' }).click();
  await expect(page.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
  const beforeRetry = requests.filter((request) => request.method() === 'GET').length;
  await page.getByRole('button', { name: 'Consultar novamente' }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(beforeRetry + 1);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
});

test('libera 404 pré-dispatch e repete a emissão com a mesma chave e revisão no modo conversa @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, { storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: false } });
  await page.goto('/#/auto');
  await expect(page.getByText('A emissão ainda não foi iniciada. Tente emitir novamente.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  const post = requests.find((request) => request.method() === 'POST');
  expect(post.headers()['idempotency-key']).toBe(key);
  expect(post.postDataJSON()).toMatchObject({ revision_id: 'r-1', concurrency_token: 'token-1' });
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('reload sem snapshot autoritativo não repete o save e oferece recuperação segura @quotations @critical', async ({ page }) => {
  const { requests, saveRequests, releaseSave } = await setup(page, { deferSave: true, idempotencyKey: null });
  try {
    await prepareForcedReload(page);
    await page.goto('/#/auto');
    await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
    await expect.poll(() => saveRequests.length).toBe(1);
    await expect.poll(() => page.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts') || '{}').drafts?.[0]?.issueIdempotencyKey)).toMatch(/^[0-9a-f-]{36}$/i);
    await forceReload(page);
    await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(1);
    await expect(page.getByText('Não foi possível confirmar o salvamento do rascunho. Verifique Orçamentos antes de tentar novamente.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar ausência e liberar nova tentativa', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Emitindo/ })).toBeDisabled();
    expect(saveRequests).toHaveLength(1);
    expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
  } finally {
    releaseSave();
  }
});

test('libera 404 pré-dispatch e repete a emissão no modo manual com a mesma identidade @quotations @critical', async ({ page }) => {
  await seedManualDraft(page);
  const { requests } = await setup(page, { storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: false } });
  await page.goto('/#/manual');
  await expect(page.getByRole('status').getByText('A emissão ainda não foi iniciada. Tente emitir novamente.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Emitir novamente' }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  const post = requests.find((request) => request.method() === 'POST');
  expect(post.headers()['idempotency-key']).toBe(key);
  expect(post.postDataJSON()).toMatchObject({ revision_id: 'r-1', concurrency_token: 'token-1' });
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('mantém o lock para 404 depois do dispatch e oferece consulta novamente @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, { storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true } });
  await page.goto('/#/auto');
  await expect(page.getByText('Não foi possível consultar a emissão. Tente novamente.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Consultar novamente' })).toBeVisible();
  await page.getByRole('button', { name: 'Consultar novamente' }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(2);
  await expect(page.getByRole('button', { name: 'Editar' })).toBeDisabled();
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
});

test('não libera o lock quando POST ambíguo recebe 404 no recovery @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, {
    storedDraft: { ...draft, saved },
    postStatuses: [503],
    postResponses: [{ error: 'Emissão ambígua.' }],
    getStatuses: [404],
  });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(1);
  await expect(page.getByText('Não foi possível consultar a emissão. Tente novamente.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Emitindo/ })).toBeDisabled();
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
});

test('repete uma emissão retryable com a mesma chave, revisão e token @quotations @critical', async ({ page }) => {
  const retryable = { state: 'retryable', error: 'Falha antes da emissão. Tente novamente.' };
  const { requests, saveRequests } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    issueResponse: retryable,
  });
  await page.goto('/#/auto');
  await expect(page.getByText(retryable.error, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  expect(saveRequests).toHaveLength(0);
  const post = requests.find((request) => request.method() === 'POST');
  expect(post.headers()['idempotency-key']).toBe(key);
  expect(post.postDataJSON()).toEqual({ revision_id: 'r-1', concurrency_token: 'token-1' });
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('bloqueia save, revisão e emissão manual enquanto o repricing de quantidade está pendente @quotations @critical', async ({ page }) => {
  let releasePricing;
  const pricingReleased = new Promise((resolve) => { releasePricing = resolve; });
  const pricingRequests = [];
  await setup(page, { idempotencyKey: null });
  await seedManualDraft(page);
  await page.route('**/api/pricing-lookup', async (route) => {
    pricingRequests.push(route.request());
    await pricingReleased;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [{ item_code: 'SKU-1', rate: 99, item_name: 'Produto repriced' }] }) });
  });
  await page.goto('/#/manual');
  await page.getByLabel('Quantidade de SKU-1').fill('3');
  await expect.poll(() => pricingRequests.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Revisar orçamento' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeDisabled();
  releasePricing();
  await expect(page.getByLabel('Preço unitário de SKU-1')).toHaveValue('99');
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeEnabled();
});

test('mantém somente o repricing mais novo em alterações manuais sobrepostas com mesma urgência @quotations @critical', async ({ page }) => {
  let releaseFirst;
  let releaseSecond;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const second = new Promise((resolve) => { releaseSecond = resolve; });
  const pricingRequests = [];
  await setup(page, { idempotencyKey: null });
  await seedManualDraft(page);
  await page.route('**/api/pricing-lookup', async (route) => {
    const index = pricingRequests.push(route.request()) - 1;
    await (index === 0 ? first : second);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [{ item_code: 'SKU-1', rate: index === 0 ? 99 : 77, item_name: 'Produto repriced' }] }) });
  });
  await page.goto('/#/manual');
  await page.getByLabel('Quantidade de SKU-1').fill('3');
  await expect.poll(() => pricingRequests.length).toBe(1);
  await page.getByLabel('Quantidade de SKU-1').fill('3.000');
  await expect.poll(() => pricingRequests.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeDisabled();
  expect(pricingRequests.map((request) => request.postDataJSON().urgent)).toEqual([false, false]);
  expect(pricingRequests.map((request) => request.postDataJSON().items[0].qty)).toEqual([3, 3]);
  const firstResponse = page.waitForResponse((response) => response.url().includes('/api/pricing-lookup') && response.request().method() === 'POST');
  releaseFirst();
  await firstResponse;
  await expect(page.getByLabel('Preço unitário de SKU-1')).toHaveValue('10');
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeDisabled();
  const secondResponse = page.waitForResponse((response) => response.url().includes('/api/pricing-lookup') && response.request().method() === 'POST');
  releaseSecond();
  await secondResponse;
  await expect(page.getByLabel('Preço unitário de SKU-1')).toHaveValue('77');
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeEnabled();
  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
  expect(pricingRequests[1].postDataJSON().urgent).toBe(false);
});

test('ignora o repricing antigo quando o mais novo termina primeiro com mesma urgência @quotations @critical', async ({ page }) => {
  let releaseFirst;
  let releaseSecond;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const second = new Promise((resolve) => { releaseSecond = resolve; });
  const pricingRequests = [];
  await setup(page, { idempotencyKey: null });
  await seedManualDraft(page);
  await page.route('**/api/pricing-lookup', async (route) => {
    const index = pricingRequests.push(route.request()) - 1;
    await (index === 0 ? first : second);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [{ item_code: 'SKU-1', rate: index === 0 ? 99 : 77, item_name: 'Produto repriced' }] }) });
  });
  await page.goto('/#/manual');
  await page.getByLabel('Quantidade de SKU-1').fill('3');
  await expect.poll(() => pricingRequests.length).toBe(1);
  await page.getByLabel('Quantidade de SKU-1').fill('3.000');
  await expect.poll(() => pricingRequests.length).toBe(2);
  expect(pricingRequests.map((request) => request.postDataJSON().urgent)).toEqual([false, false]);
  expect(pricingRequests.map((request) => request.postDataJSON().items[0].qty)).toEqual([3, 3]);
  const secondResponse = page.waitForResponse((response) => response.url().includes('/api/pricing-lookup') && response.request().method() === 'POST');
  releaseSecond();
  await secondResponse;
  await expect(page.getByLabel('Preço unitário de SKU-1')).toHaveValue('77');
  const firstResponse = page.waitForResponse((response) => response.url().includes('/api/pricing-lookup') && response.request().method() === 'POST');
  releaseFirst();
  await firstResponse;
  await expect(page.getByLabel('Preço unitário de SKU-1')).toHaveValue('77');
});

test('libera o bloqueio manual quando o repricing falha sem emitir preço antigo durante a requisição @quotations @critical', async ({ page }) => {
  const pricingRequests = [];
  await setup(page, { idempotencyKey: null });
  await seedManualDraft(page);
  await page.route('**/api/pricing-lookup', async (route) => {
    pricingRequests.push(route.request());
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'indisponível' }) });
  });
  await page.goto('/#/manual');
  await page.getByLabel('Quantidade de SKU-1').fill('3');
  await expect.poll(() => pricingRequests.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeEnabled();
  await expect(page.getByLabel('Preço unitário de SKU-1')).toHaveValue('10');
});

test('bloqueia emissão manual enquanto a inclusão de produto aguarda preço @quotations @critical', async ({ page }) => {
  let releasePricing;
  const pricingReleased = new Promise((resolve) => { releasePricing = resolve; });
  const pricingRequests = [];
  await setup(page, { idempotencyKey: null });
  await seedManualDraft(page, { items: [], newClient: { nome: 'Cliente manual', email: '', telefone: '' } });
  await page.route('**/api/products?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ sku: 'SKU-1', nome: 'Produto', pricing_available: true }] }) }));
  await page.route('**/api/pricing-lookup', async (route) => {
    pricingRequests.push(route.request());
    await pricingReleased;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [{ item_code: 'SKU-1', rate: 42 }] }) });
  });
  await page.goto('/#/manual');
  await page.getByLabel('Buscar produto para adicionar ao orçamento').fill('SKU-1');
  await expect(page.getByRole('button', { name: 'Adicionar SKU-1 ao orçamento' })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar SKU-1 ao orçamento' }).click();
  await expect.poll(() => pricingRequests.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeDisabled();
  releasePricing();
  await expect(page.getByLabel('Preço unitário de SKU-1')).toHaveValue('42');
  await expect(page.getByRole('button', { name: 'Emitir orçamento' })).toBeEnabled();
});

test('bloqueia edição, modo, navegação e beforeunload durante save manual @quotations @critical', async ({ page }) => {
  const { saveRequests, releaseSave } = await setup(page, { idempotencyKey: null, deferSave: true });
  await seedManualDraft(page);
  await page.goto('/#/manual');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect.poll(() => saveRequests.length).toBe(1);
  await expect(page.getByLabel('Nome do cliente')).toBeDisabled();
  await expect(page.getByLabel('Quantidade de SKU-1')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Buscar cliente existente' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Novo cliente' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Endereço opcional' })).toBeDisabled();
  await expect(page.getByLabel('Buscar produto para adicionar ao orçamento')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remover SKU-1' })).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Da conversa' })).toBeEnabled();
  await page.getByRole('tab', { name: 'Da conversa' }).click();
  await expect(page.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Orçamentos' }).click();
  await expect(page).toHaveURL(/#\/manual$/);
  await expect.poll(() => page.evaluate(() => {
    const event = new globalThis.Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  releaseSave();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('bloqueia edição, modo, navegação e beforeunload durante save da conversa @quotations @critical', async ({ page }) => {
  const { saveRequests, releaseSave } = await setup(page, { idempotencyKey: null, deferSave: true });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect.poll(() => saveRequests.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Editar' })).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Manual' })).toBeEnabled();
  await page.getByRole('tab', { name: 'Manual' }).click();
  await expect(page.getByRole('tab', { name: 'Da conversa' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Orçamentos' }).click();
  await expect(page).toHaveURL(/#\/auto$/);
  await expect.poll(() => page.evaluate(() => {
    const event = new globalThis.Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  releaseSave();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('não anexa resposta de extração depois de desmontar por navegação SPA @quotations @critical', async ({ page }) => {
  let releaseExtraction;
  const extractionGate = new Promise((resolve) => { releaseExtraction = resolve; });
  const pricingRequests = [];
  await setup(page, { idempotencyKey: null, storedDrafts: [] });
  await page.route('**/api/extract', async (route) => {
    await extractionGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [draft.edited] }) });
  });
  await page.route('**/api/pricing-lookup', async (route) => {
    pricingRequests.push(route.request());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [{ item_code: 'SKU-1', rate: 99 }] }) });
  });
  await page.goto('/#/auto');
  await page.evaluate(() => { globalThis.__aspenRealmMarker = (globalThis.__aspenRealmMarker || 0) + 1; });
  const realmMarker = await page.evaluate(() => globalThis.__aspenRealmMarker);
  await page.getByLabel('Mensagem do cliente para extração').fill('pedido pendente');
  await page.getByRole('button', { name: 'Extrair dados' }).click();
  const extractionResponse = page.waitForResponse((response) => response.url().includes('/api/extract') && response.request().method() === 'POST');
  await page.goto('/#/quotations');
  await expect(page).toHaveURL(/#\/quotations$/);
  await expect(page.getByRole('heading', { name: 'Orçamentos' })).toBeVisible();
  expect(await page.evaluate(() => globalThis.__aspenRealmMarker)).toBe(realmMarker);
  releaseExtraction();
  await extractionResponse;
  await page.waitForTimeout(50);
  expect(pricingRequests).toHaveLength(0);
  await expect(page.getByRole('heading', { name: 'Orçamentos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cliente' })).toHaveCount(0);
});

test('mantém os campos manuais bloqueados enquanto o POST oficial aguarda resposta @quotations @critical', async ({ page }) => {
  const { requests, releasePost } = await setup(page, { idempotencyKey: null, deferPost: true });
  await seedManualDraft(page);
  await page.goto('/#/manual');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect(page.getByRole('button', { name: 'Emitir orçamento', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Nome do cliente')).toBeDisabled();
  await expect(page.getByLabel('Origem *')).toBeDisabled();
  await expect(page.getByLabel('Quantidade de SKU-1')).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Da conversa' })).toBeEnabled();
  await page.getByRole('tab', { name: 'Da conversa' }).click();
  await expect(page.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => {
    const event = new globalThis.Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  releasePost();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('descarta a segunda emissão enquanto a primeira está pendente @quotations @critical', async ({ page }) => {
  const secondSaved = { ...saved, quotationId: 'q-2', businessNumber: 'ORC-20260002', revisionId: 'r-2', concurrencyToken: 'token-2' };
  const secondDraft = {
    ...draft,
    index: 1,
    edited: { ...draft.edited, nome: 'Segundo cliente', items: [{ ...draft.edited.items[0], item_code: 'SKU-2' }] },
    saved: secondSaved,
  };
  const secondIssue = { ...issue, quotationId: 'q-2', businessNumber: 'ORC-20260002', revisionId: 'r-2' };
  const { requests, releasePost } = await setup(page, {
    storedDrafts: [storedDraft({ saved }), secondDraft],
    idempotencyKey: null,
    deferPost: true,
    postResponses: [secondIssue],
  });
  await page.goto('/#/auto');
  const issueButtons = page.getByRole('button', { name: 'Emitir orçamento', exact: true });
  await expect(issueButtons).toHaveCount(1);
  const activeDraft = page.getByLabel('Rascunho ativo');
  await expect(activeDraft).toHaveValue('1');
  await issueButtons.click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect(activeDraft).toBeDisabled();
  await activeDraft.evaluate((select) => {
    select.removeAttribute('disabled');
    select.value = '0';
    select.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('heading', { name: 'Cliente' })).toBeVisible();
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).evaluate((button) => {
    button.removeAttribute('disabled');
    button.click();
  });
  await expect.poll(() => page.evaluate(() => {
    const drafts = JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts') || '{}').drafts || [];
    const second = drafts.find((draft) => draft.index === 0);
    return Boolean(second?.issueIdempotencyKey || second?.status || second?.issueDispatchStarted);
  })).toBe(false);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
  releasePost();
  await expect(page).toHaveURL(/#\/quotations\/q-2$/);
  const posts = requests.filter((request) => request.method() === 'POST');
  expect(posts[0].postDataJSON()).toMatchObject({ revision_id: 'r-2', concurrency_token: 'token-2' });
});

test('mantém o lock quando o GET de recovery falha e permite nova consulta @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    getStatuses: [503, 503],
  });
  await page.goto('/#/auto');
  await expect(page.getByText('Não foi possível consultar a emissão. Tente novamente.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar' })).toBeDisabled();
  await page.getByRole('button', { name: 'Consultar novamente' }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(2);
  await expect(page.getByRole('button', { name: 'Editar' })).toBeDisabled();
});

test('atualiza um saved legado antes de emitir usando o snapshot retornado pelo servidor @quotations @critical', async ({ page }) => {
  const legacySaved = { quotationId: 'q-legacy', businessNumber: 'ORC-LEGACY', revisionId: 'r-legacy', concurrencyToken: 'legacy-token' };
  const { requests, saveRequests, releaseSave } = await setup(page, {
    storedDraft: { ...draft, saved: legacySaved },
    idempotencyKey: null,
    deferSave: true,
  });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => saveRequests.length).toBe(1);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
  releaseSave();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  expect(await page.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts')).drafts[0].saved.snapshot.total)).toBe('20.00');
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('não agenda polling duplicado quando o recovery recarrega a página @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    issueResponse: { state: 'processing', retryAfterMs: 10_000 },
  });
  await prepareForcedReload(page);
  await page.goto('/#/auto');
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(1);
  await forceReload(page);
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(2);
  await page.waitForTimeout(650);
  expect(requests.filter((request) => request.method() === 'GET')).toHaveLength(2);
});

test('deduplica o GET inicial enquanto a consulta de recovery está pendente @quotations @critical', async ({ page }) => {
  const { requests, releaseGet } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    issueResponse: { state: 'processing', retryAfterMs: 10_000 },
    deferGet: true,
  });
  try {
    await page.goto('/#/auto');
    await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(1);
    await page.waitForTimeout(100);
    expect(requests.filter((request) => request.method() === 'GET')).toHaveLength(1);
  } finally {
    releaseGet();
  }
});

test('persiste o marcador pós-dispatch antes de enviar o POST oficial @quotations @critical', async ({ page }) => {
  const { requests, releasePost } = await setup(page, { storedDraft: { ...draft, saved }, idempotencyKey: null, deferPost: true });
  await page.goto('/#/auto');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts')).drafts[0])).toMatchObject({
    issueIdempotencyKey: expect.stringMatching(/.+/),
    issueDispatchStarted: true,
    status: 'processing',
  });
  releasePost();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('mantém a mesma chave e revisão após falha ambígua no modo manual @quotations @critical', async ({ page }) => {
  await seedManualDraft(page);
  const retryable = { state: 'retryable', error: 'Falha antes da emissão. Tente novamente.' };
  const { requests } = await setup(page, {
    idempotencyKey: null,
    postStatus: 503,
    postResponse: { error: 'Emissão ambígua.' },
    getResponses: [retryable],
  });
  await page.goto('/#/manual');
  await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(1);
  const post = requests.find((request) => request.method() === 'POST');
  const get = requests.find((request) => request.method() === 'GET');
  expect(new globalThis.URL(get.url()).searchParams.get('idempotency_key')).toBe(post.headers()['idempotency-key']);
  expect(post.postDataJSON()).toEqual({ revision_id: 'r-1', concurrency_token: 'token-1' });
  await expect(page.getByRole('status').getByText(retryable.error, { exact: true })).toBeVisible();
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
});

test('mantém beforeunload ativo enquanto o repricing manual está pendente e o remove ao concluir @quotations @critical', async ({ page }) => {
  let releasePricing;
  const pricingReleased = new Promise((resolve) => { releasePricing = resolve; });
  await setup(page, { idempotencyKey: null });
  await seedManualDraft(page);
  await page.route('**/api/pricing-lookup', async (route) => {
    await pricingReleased;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [{ item_code: 'SKU-1', rate: 99 }] }) });
  });
  await page.goto('/#/manual');
  await page.getByLabel('Quantidade de SKU-1').fill('3');
  await expect.poll(() => page.evaluate(() => {
    const event = new globalThis.Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  releasePricing();
  await expect(page.getByLabel('Preço unitário de SKU-1')).toHaveValue('99');
  await expect.poll(() => page.evaluate(() => {
    const event = new globalThis.Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test('bloqueia o modo manual enquanto o GET de recovery está pendente @quotations @critical', async ({ page }) => {
  await seedManualDraft(page);
  const { requests, releaseGet } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    issueResponse: { state: 'completed', ...issue },
    deferGet: true,
  });
  await page.goto('/#/manual');
  await expect.poll(() => requests.filter((request) => request.method() === 'GET').length).toBe(1);
  await expect(page.getByLabel('Nome do cliente')).toBeDisabled();
  await page.getByRole('tab', { name: 'Da conversa' }).click();
  await expect(page.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
  releaseGet();
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('preserva a identidade pré-dispatch depois do 404 até o operador emitir novamente @quotations @critical', async ({ page }) => {
  const { requests } = await setup(page, { storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: false } });
  await page.goto('/#/auto');
  await expect.poll(() => page.evaluate(() => {
    const draft = JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts')).drafts[0];
    return {
      newDemand: draft.edited.new_demand,
      issueIdempotencyKey: draft.issueIdempotencyKey,
      issueDispatchStarted: draft.issueDispatchStarted,
      status: draft.status,
      saved: draft.saved,
      result: draft.result,
    };
  })).toEqual({
    newDemand: undefined,
    issueIdempotencyKey: key,
    issueDispatchStarted: undefined,
    status: undefined,
    saved,
    result: { success: false, error: 'A emissão ainda não foi iniciada. Tente emitir novamente.' },
  });
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
});

test('preserva emissão concluída ao inicializar a oportunidade @quotations @critical', async ({ page }) => {
  const completedResult = {
    success: true,
    data: {
      businessNumber: issue.businessNumber,
      quotationId: issue.quotationId,
      revisionId: issue.revisionId,
      revisionNumber: issue.revisionNumber,
      status: issue.status,
      snapshot: saved.snapshot,
    },
  };
  const { requests } = await setup(page, {
    storedDraft: { ...draft, saved, issue, status: 'done', result: completedResult },
  });
  await page.goto('/#/auto');
  await expect.poll(() => page.evaluate(() => {
    const draft = JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts')).drafts[0];
    return {
      newDemand: draft.edited.new_demand,
      saved: draft.saved,
      issue: draft.issue,
      status: draft.status,
      result: draft.result,
    };
  })).toEqual({
    newDemand: undefined,
    saved,
    issue,
    status: 'done',
    result: completedResult,
  });
  expect(requests.filter((request) => request.method() === 'GET')).toHaveLength(0);
  expect(requests.filter((request) => request.method() === 'POST')).toHaveLength(0);
});

test('materializa nova demanda para draft automático ainda não salvo @quotations', async ({ page }) => {
  await setup(page);
  await page.goto('/#/auto');
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(globalThis.sessionStorage.getItem('aspen_drafts'));
    return stored.drafts[0].edited.new_demand;
  })).toBe(true);
});

test('repete no modo manual uma emissão retryable sem criar outro save ou revisão @quotations @critical', async ({ page }) => {
  await seedManualDraft(page);
  const retryable = { state: 'retryable', error: 'Falha antes da emissão. Tente novamente.' };
  const { requests, saveRequests } = await setup(page, {
    storedDraft: { ...draft, saved, issueIdempotencyKey: key, issueDispatchStarted: true },
    issueResponse: retryable,
  });
  await page.goto('/#/manual');
  await expect(page.getByRole('status').getByText(retryable.error, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Emitir novamente' }).click();
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  expect(saveRequests).toHaveLength(0);
  const post = requests.find((request) => request.method() === 'POST');
  expect(post.headers()['idempotency-key']).toBe(key);
  expect(post.postDataJSON()).toEqual({ revision_id: 'r-1', concurrency_token: 'token-1' });
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});

test('emite novamente no modo manual usando os campos visíveis após recovery @quotations @critical', async ({ page }) => {
  await seedManualDraft(page, {
    newClient: { nome: 'Cliente local diferente', email: '', telefone: '' },
    items: [{ _key: 'local-item', sku: 'SKU-LOCAL', nome: 'Produto local', qty: 1, rate: 3, _rateManual: false }],
  });
  const retryable = { state: 'retryable', error: 'Falha antes da emissão. Tente novamente.' };
  const pendingDraft = {
    ...draft,
    edited: {
      ...draft.edited,
      nome: 'Cliente pendente',
      items: [{ ...draft.edited.items[0], item_name: 'Produto pendente', qty: 7, rate: 11 }],
    },
    saved,
    issueIdempotencyKey: key,
    issueDispatchStarted: true,
  };
  const { requests, saveRequests } = await setup(page, {
    storedDraft: pendingDraft,
    issueResponse: retryable,
  });
  await page.goto('/#/manual');
  await expect(page.getByRole('status').getByText(retryable.error, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Nome do cliente')).toHaveValue('Cliente pendente');
  await expect(page.getByText('Produto pendente', { exact: true })).toBeVisible();
  await page.getByLabel('Nome do cliente').fill('Cliente visível');
  await page.getByRole('button', { name: 'Emitir novamente' }).click();
  await expect.poll(() => saveRequests.length).toBe(1);
  expect(saveRequests[0].postDataJSON().extracted.nome).toBe('Cliente visível');
  await expect.poll(() => requests.filter((request) => request.method() === 'POST').length).toBe(1);
  await expect(page).toHaveURL(/#\/quotations\/q-1$/);
});
