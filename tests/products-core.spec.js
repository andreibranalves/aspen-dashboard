// @ts-check
import { expect, test } from '@playwright/test';

function product(sku, nome, ativo = true) {
  return {
    sku,
    nome,
    descricao: 'Produto do catálogo principal',
    unidade: 'Und',
    categoria: 'Catálogo',
    marca: null,
    ativo,
    criado_em: '2026-01-01T00:00:00.000Z',
    atualizado_em: '2026-01-01T00:00:00.000Z',
    arquivado_em: ativo ? null : '2026-01-01T00:00:00.000Z',
    preco_base: /** @type {string | null} */ (null),
    precos: /** @type {Array<{minimum_quantity: string, unit_price: string}>} */ ([]),
    preco_minimo: /** @type {string | null} */ (null),
    pricing_available: false,
  };
}

function detail(row) {
  return {
    produto: {
      ...row,
      imagem: null,
      modificado_em: row.atualizado_em,
    },
    preco_base: row.preco_base ?? null,
    precos: row.precos || [],
    pricing_available: row.pricing_available === true,
  };
}

async function mockProductApi(page, initialRows) {
  const rows = initialRows.map((row) => ({ ...row }));
  const requests = [];
  const updates = [];

  await page.route('**/api/products**', async (route) => {
    const request = route.request();
    const method = request.method();
    requests.push({
      method,
      url: request.url(),
      body: method === 'POST' ? request.postDataJSON() : undefined,
    });

    if (method === 'GET') {
      const url = new globalThis.URL(request.url());
      const status = url.searchParams.get('status') || 'active';
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const pageNumber = Number(url.searchParams.get('page') || '1');
      const limit = Number(url.searchParams.get('limit') || '10');
      const filtered = rows.filter((row) => {
        const statusMatches = status === 'all' || (status === 'archived' ? !row.ativo : row.ativo);
        const searchMatches =
          !search ||
          row.sku.toLowerCase().includes(search) ||
          row.nome.toLowerCase().includes(search);
        return statusMatches && searchMatches;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: filtered.slice((pageNumber - 1) * limit, pageNumber * limit),
          pagination: {
            page: pageNumber,
            limit,
            total: filtered.length,
            total_pages: Math.ceil(filtered.length / limit) || 0,
          },
        }),
      });
      return;
    }

    if (method === 'POST') {
      const body = request.postDataJSON();
      const sku = String(body.sku || '').trim();
      if (rows.some((item) => item.sku === sku)) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'SKU já cadastrado.' }),
        });
        return;
      }
      const row = product(body.sku, body.nome, true);
      row.descricao = body.descricao || '';
      row.categoria = body.categoria || null;
      row.marca = body.marca || null;
      row.unidade = body.unidade || 'Und';
      row.preco_base = body.preco_base ?? null;
      row.precos = Array.isArray(body.precos) ? body.precos : [];
      row.pricing_available = Boolean(row.preco_base || row.precos.length > 0);
      rows.push(row);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          created: row.sku,
          produto: row,
        }),
      });
      return;
    }

    if (method === 'DELETE') {
      const url = new globalThis.URL(request.url());
      const sku = url.searchParams.get('id');
      const row = rows.find((item) => item.sku === sku);
      if (!row) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Produto não encontrado.' }),
        });
        return;
      }
      row.ativo = false;
      row.arquivado_em = '2026-01-02T00:00:00.000Z';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          deleted: sku,
          archived: true,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 405,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Método não permitido.' }),
    });
  });

  await page.route('**/api/product-detail**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    const row = rows.find((item) => item.sku === url.searchParams.get('sku'));
    if (!row) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Produto não encontrado.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail(row)),
    });
  });

  await page.route('**/api/product-update**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    const sku = url.searchParams.get('sku');
    const row = rows.find((item) => item.sku === sku);
    if (!row) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Produto não encontrado.' }),
      });
      return;
    }
    const body = request.postDataJSON();
    updates.push({ sku, body });
    Object.assign(row, body);
    if (body.precos) row.pricing_available = Boolean(body.preco_base || body.precos.length > 0);
    if (body.ativo === true) row.arquivado_em = null;
    if (body.ativo === false) row.arquivado_em = '2026-01-02T00:00:00.000Z';
    row.atualizado_em = '2026-01-03T00:00:00.000Z';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        sku,
        produto: row,
      }),
    });
  });

  return { rows, requests, updates };
}

test.describe('Produtos — catálogo principal @products @smoke', () => {
  test('cria produto core com preços no POST atômico sem segundo update de pricing', async ({
    page,
  }) => {
    const { requests, updates, rows } = await mockProductApi(page, []);
    await page.goto('/#/products/new');
    await page.getByPlaceholder('LNC-SED-70').fill('CORE-ATOMIC');
    await page.getByPlaceholder('Nome do produto').fill('Produto atômico');
    await page.getByLabel('Preço base').fill('10.00');
    await page.getByRole('button', { name: 'Adicionar faixa de preço' }).click();
    await page.getByLabel('Quantidade mínima da faixa 1').fill('30');
    await page.getByLabel('Preço unitário da faixa 1').fill('8.50');
    await page.getByRole('button', { name: 'Criar produto' }).click();

    await expect(page).toHaveURL(/#\/products\/CORE-ATOMIC$/);
    const post = requests.find((request) => request.method === 'POST');
    expect(post?.body?.preco_base).toBe('10.00');
    expect(post?.body?.precos).toEqual([{ minimum_quantity: '30', unit_price: '8.50' }]);
    expect(updates).toHaveLength(0);
    expect(rows[0].preco_base).toBe('10.00');
    expect(rows[0].precos).toEqual([{ minimum_quantity: '30', unit_price: '8.50' }]);
  });

  test('duplica produto em rascunho sem copiar o SKU e reaproveita preços', async ({ page }) => {
    const source = product('CORE-SOURCE', 'Produto base');
    source.preco_base = '10.00';
    source.precos = [{ minimum_quantity: '30', unit_price: '8.50' }];
    source.pricing_available = true;
    const { requests, rows } = await mockProductApi(page, [source]);

    await page.goto('/#/products/CORE-SOURCE');
    await expect(page.getByRole('button', { name: 'Duplicar produto' })).toBeVisible();
    await page.getByRole('button', { name: 'Duplicar produto' }).click();

    await expect(page).toHaveURL(/#\/products\/new\?duplicate=CORE-SOURCE$/);
    await expect(page.getByText('Rascunho de duplicação.', { exact: false })).toBeVisible();
    await expect(page.getByPlaceholder('LNC-SED-70')).toHaveValue('');
    await expect(page.getByPlaceholder('Nome do produto')).toHaveValue('Produto base');
    await expect(page.getByLabel('Preço base')).toHaveValue('10.00');
    await expect(page.getByLabel('Quantidade mínima da faixa 1')).toHaveValue('30');
    await expect(page.getByLabel('Preço unitário da faixa 1')).toHaveValue('8.50');

    await page.getByRole('button', { name: 'Criar produto' }).click();
    await expect(page.getByText('SKU é obrigatório.', { exact: true })).toBeVisible();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);

    await page.getByPlaceholder('LNC-SED-70').fill('CORE-COPY');
    await page.getByRole('button', { name: 'Criar produto' }).click();
    await expect(page).toHaveURL(/#\/products\/CORE-COPY$/);

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.body?.sku).toBe('CORE-COPY');
    expect(post?.body?.nome).toBe('Produto base');
    expect(post?.body?.preco_base).toBe('10.00');
    expect(post?.body?.precos).toEqual([{ minimum_quantity: '30', unit_price: '8.50' }]);
    expect(rows.map((row) => row.sku)).toEqual(['CORE-SOURCE', 'CORE-COPY']);
  });

  test('edita preço base/faixas dinâmicas e resolve limites no orçamento sem mutar cadastro', async ({
    page,
  }) => {
    const priced = product('CORE-PRICED', 'Produto com preço');
    priced.preco_base = '10.00';
    priced.precos = [];
    priced.preco_minimo = '7.25';
    priced.pricing_available = true;
    const { updates } = await mockProductApi(page, [priced]);

    await page.goto('/#/products/CORE-PRICED');
    await expect(page.getByText(/10,00/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeVisible();
    await page.getByLabel('Preço base').fill('11.00');
    await page.getByRole('button', { name: 'Adicionar faixa de preço' }).click();
    await page.getByLabel('Quantidade mínima da faixa 1').fill('30');
    await page.getByLabel('Preço unitário da faixa 1').fill('8.50');
    await page.getByRole('button', { name: 'Adicionar faixa de preço' }).click();
    await page.getByLabel('Quantidade mínima da faixa 2').fill('100');
    await page.getByLabel('Preço unitário da faixa 2').fill('7.25');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Produto atualizado com sucesso!', { exact: true })).toBeVisible();
    await expect(page.getByText(/11,00/).first()).toBeVisible();
    const pricingUpdate = updates.at(-1)?.body;
    expect(pricingUpdate?.preco_base).toBe('11.00');
    expect(pricingUpdate?.precos).toEqual([
      { minimum_quantity: '30', unit_price: '8.50' },
      { minimum_quantity: '100', unit_price: '7.25' },
    ]);

    await page.route('**/api/pricing-lookup**', async (route) => {
      const request = route.request();
      const qty = Number(request.postDataJSON()?.items?.[0]?.qty);
      const rate = qty >= 100 ? '7.25' : '8.50';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ item_code: 'CORE-PRICED', qty, rate }] }),
      });
    });

    const updateCountBeforeManual = updates.length;
    await page.goto('/#/manual');
    await page
      .getByPlaceholder('Buscar SKU ou nome…')
      .fill('CORE-PRICED');
    await page.getByRole('button', { name: 'Adicionar CORE-PRICED ao orçamento' }).click();
    const quantity = page.getByLabel('Quantidade de CORE-PRICED').first();
    const unitPrice = page.getByLabel('Preço unitário de CORE-PRICED').first();
    await expect(unitPrice).toHaveValue('8.5');
    await quantity.fill('100');
    await expect(unitPrice).toHaveValue('7.25');
    await unitPrice.fill('9.99');
    await expect(unitPrice).toHaveValue('9.99');
    expect(updates).toHaveLength(updateCountBeforeManual);
  });

  test('cria, pesquisa e edita produto no PostgreSQL sem metadados de rollout', async ({
    page,
  }) => {
    const { rows } = await mockProductApi(page, [product('CORE-SEED', 'Produto inicial')]);

    await page.goto('/#/products');
    await expect(page.getByRole('heading', { name: 'Produtos' })).toBeVisible();
    await page.getByRole('button', { name: 'Novo produto' }).click();
    await expect(page.getByRole('button', { name: 'Criar produto' })).toBeVisible();
    await expect(
      page.getByText('Preço indisponível para este produto.', { exact: true })
    ).toBeVisible();
    await expect(page.locator('input[aria-label^="Preço da faixa"]')).toHaveCount(0);

    await page.getByPlaceholder('LNC-SED-70').fill('CORE-SEED');
    await page.getByPlaceholder('Nome do produto').fill('Tentativa duplicada');
    await page.getByRole('button', { name: 'Criar produto' }).click();
    await expect(page.getByText('SKU já cadastrado.', { exact: true })).toBeVisible();
    expect(rows).toHaveLength(1);
    expect(rows.find((row) => row.sku === 'CORE-SEED')?.nome).toBe('Produto inicial');

    await page.getByPlaceholder('LNC-SED-70').fill('CORE-NEW');
    await page.getByPlaceholder('Nome do produto').fill('Produto novo');
    await page.getByRole('button', { name: 'Criar produto' }).click();
    await expect(page).toHaveURL(/#\/products\/CORE-NEW$/);
    await expect(page.getByText('Produto novo', { exact: true }).first()).toBeVisible();

    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeVisible();
    await page.getByPlaceholder('Nome do produto').fill('Produto editado');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Produto atualizado com sucesso!', { exact: true })).toBeVisible();
    expect(rows.find((row) => row.sku === 'CORE-NEW')?.nome).toBe('Produto editado');

    await page.goto('/#/products');
    await expect(page.getByText('Produto editado', { exact: true }).first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar produtos' }).fill('CORE-NEW');
    await expect(page.getByText('Produto editado', { exact: true }).first()).toBeVisible();
  });

  test('impede selecionar produto do core sem preço e não cria linha R$ 0,00', async ({ page }) => {
    const { requests } = await mockProductApi(page, [
      product('CORE-UNPRICED', 'Produto sem preço'),
    ]);
    let pricingCalls = 0;
    await page.route('**/api/pricing-lookup**', async (route) => {
      pricingCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ rate: 0 }] }),
      });
    });

    await page.goto('/#/manual');
    await page
      .getByPlaceholder('Buscar SKU ou nome…')
      .fill('CORE-UNPRICED');
    const addButton = page.getByRole('button', { name: 'Adicionar CORE-UNPRICED ao orçamento' });
    await expect(addButton).toBeVisible();
    await expect(addButton).toBeDisabled();
    await expect(page.getByText('Preço indisponível', { exact: true })).toBeVisible();
    await expect(page.getByText('Nenhum produto na tabela', { exact: true })).toBeVisible();
    expect(pricingCalls).toBe(0);
    expect(
      requests.some(
        (request) => request.method === 'GET' && request.url.includes('search=CORE-UNPRICED')
      )
    ).toBe(true);
  });

  test('consulta atividade local para produto do catálogo sem metadados de rollout', async ({
    page,
  }) => {
    const priced = product('CORE-ACTIVITY', 'Produto com atividade local');
    priced.preco_base = '10.00';
    priced.pricing_available = true;
    await mockProductApi(page, [priced]);
    let activityRequests = 0;
    await page.route('**/api/product-activity**', async (route) => {
      activityRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sku: 'CORE-ACTIVITY',
          atividades: [
            { tipo: 'produto', texto: 'Produto criado', data: '2026-01-01', id: 'activity-1' },
          ],
        }),
      });
    });

    await page.goto('/#/products/CORE-ACTIVITY');
    await expect(
      page.getByText('Produto com atividade local', { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Produto com atividade local', exact: true })
    ).toHaveCount(1);
    const productHeader = page.locator('header').filter({
      has: page.getByRole('heading', { name: 'Produto com atividade local', exact: true }),
    });
    await expect(productHeader.getByText('Ativo', { exact: true })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: 'Arquivar produto' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Produto com atividade local');
    await expect(page.getByText('Produto criado', { exact: true })).toBeVisible();
    await expect(page.getByText(/10,00/).first()).toBeVisible();
    await expect.poll(() => activityRequests).toBe(1);

    await expect(page.getByRole('banner').getByRole('button', { name: 'Salvar produto' })).toBeVisible();
    await expect(page.getByPlaceholder('Nome do produto')).toHaveValue(
      'Produto com atividade local'
    );
  });

  test('consulta atividade local uma única vez após salvar um produto existente', async ({
    page,
  }) => {
    await mockProductApi(page, [product('CORE-ACTIVITY-SAVE', 'Produto local')]);
    let activityRequests = 0;
    await page.route('**/api/product-activity**', async (route) => {
      activityRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ atividades: [] }),
      });
    });

    await page.goto('/#/products/CORE-ACTIVITY-SAVE');
    await expect(page.getByText('Produto local', { exact: true }).first()).toBeVisible();
    await expect.poll(() => activityRequests).toBe(1);

    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeVisible();
    await page.getByPlaceholder('Nome do produto').fill('Produto local atualizado');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Produto atualizado com sucesso!', { exact: true })).toBeVisible();
    await expect.poll(() => activityRequests).toBe(2);
    await page.waitForTimeout(100);
    expect(activityRequests).toBe(2);
  });

  test('ignora respostas atrasadas de produto e atividade de SKU antigo', async ({ page }) => {
    const oldProduct = product('OLD-SKU', 'Produto antigo');
    const newProduct = product('NEW-SKU', 'Produto atual');
    await mockProductApi(page, [oldProduct, newProduct]);
    /** @type {(value?: unknown) => void} */
    let releaseOldProduct = () => {};
    /** @type {(value?: unknown) => void} */
    let releaseOldActivity = () => {};
    const oldProductReady = new Promise((resolve) => {
      releaseOldProduct = resolve;
    });
    const oldActivityReady = new Promise((resolve) => {
      releaseOldActivity = resolve;
    });
    let oldProductStarted = 0;
    let oldActivityStarted = 0;
    const lifecycleErrors = [];
    page.on('console', (message) => {
      if (/unmount|state update|cannot perform|warning/i.test(message.text())) {
        lifecycleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => lifecycleErrors.push(error.message));

    await page.route('**/api/product-detail**', async (route) => {
      const requestSku = new globalThis.URL(route.request().url()).searchParams.get('sku');
      if (requestSku === 'OLD-SKU') {
        oldProductStarted += 1;
        await oldProductReady;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Falha antiga' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail(newProduct)),
      });
    });
    await page.route('**/api/product-activity**', async (route) => {
      const requestSku = new globalThis.URL(route.request().url()).searchParams.get('sku');
      if (requestSku === 'OLD-SKU') {
        oldActivityStarted += 1;
        await oldActivityReady;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Falha antiga' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          atividades: [
            {
              tipo: 'produto',
              texto: 'Atividade atual',
              data: '2026-01-02T00:00:00.000Z',
              id: 'new-activity',
            },
          ],
        }),
      });
    });

    await page.goto('/#/products/OLD-SKU');
    await expect.poll(() => oldProductStarted).toBe(1);
    await expect.poll(() => oldActivityStarted).toBe(1);
    await page.goto('/#/products/NEW-SKU');
    await expect(page.getByText('Produto atual', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Atividade atual', { exact: true })).toBeVisible();
    releaseOldProduct();
    releaseOldActivity();
    await page.waitForTimeout(100);
    await expect(page.getByText('Produto atual', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Atividade atual', { exact: true })).toBeVisible();
    await expect(page.getByText('Falha antiga', { exact: true })).toHaveCount(0);
    expect(lifecycleErrors).toEqual([]);
  });

  test('limpa atividade ao trocar SKU e exibe carregamento até a nova resposta', async ({
    page,
  }) => {
    const oldProduct = product('ACTIVITY-OLD', 'Produto com atividade antiga');
    const newProduct = product('ACTIVITY-NEW', 'Produto com atividade nova');
    await mockProductApi(page, [oldProduct, newProduct]);
    /** @type {(value?: unknown) => void} */
    let releaseNewActivity = () => {};
    const newActivityReady = new Promise((resolve) => {
      releaseNewActivity = resolve;
    });
    let newActivityStarted = 0;

    await page.route('**/api/product-detail**', async (route) => {
      const requestSku = new globalThis.URL(route.request().url()).searchParams.get('sku');
      const row = requestSku === 'ACTIVITY-OLD' ? oldProduct : newProduct;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail(row)),
      });
    });
    await page.route('**/api/product-activity**', async (route) => {
      const requestSku = new globalThis.URL(route.request().url()).searchParams.get('sku');
      if (requestSku === 'ACTIVITY-NEW') {
        newActivityStarted += 1;
        await newActivityReady;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            atividades: [
              {
                tipo: 'produto',
                texto: 'Atividade nova',
                data: '2026-01-02T00:00:00.000Z',
                id: 'new-activity',
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          atividades: [
            {
              tipo: 'produto',
              texto: 'Atividade antiga',
              data: '2026-01-01T00:00:00.000Z',
              id: 'old-activity',
            },
          ],
        }),
      });
    });

    await page.goto('/#/products/ACTIVITY-OLD');
    await expect(page.getByText('Atividade antiga', { exact: true })).toBeVisible();
    await page.goto('/#/products/ACTIVITY-NEW');
    await expect.poll(() => newActivityStarted).toBe(1);
    await expect(page.getByText('Carregando atividade…', { exact: true })).toHaveText('Carregando atividade…');
    await expect(page.getByText('Atividade antiga', { exact: true })).toHaveCount(0);
    releaseNewActivity();
    await expect(page.getByText('Atividade nova', { exact: true })).toBeVisible();
  });

  test('não vaza estado de salvar ou arquivar para outro SKU', async ({ page }) => {
    const first = product('STATE-FIRST', 'Produto primeiro');
    const second = product('STATE-SECOND', 'Produto segundo');
    await mockProductApi(page, [first, second]);
    /** @type {(value?: unknown) => void} */
    let releaseSave = () => {};
    /** @type {(value?: unknown) => void} */
    let releaseDelete = () => {};
    const saveReady = new Promise((resolve) => {
      releaseSave = resolve;
    });
    const deleteReady = new Promise((resolve) => {
      releaseDelete = resolve;
    });
    let saveStarted = 0;
    let deleteStarted = 0;

    await page.route('**/api/product-update**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'PUT' && url.searchParams.get('sku') === 'STATE-FIRST') {
        saveStarted += 1;
        await saveReady;
        await route.fallback();
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/products**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'DELETE' && url.searchParams.get('id') === 'STATE-FIRST') {
        deleteStarted += 1;
        await deleteReady;
        await route.fallback();
        return;
      }
      await route.fallback();
    });

    await page.goto('/#/products/STATE-FIRST');
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeVisible();
    await page.getByPlaceholder('Nome do produto').fill('Produto primeiro salvo');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect.poll(() => saveStarted).toBe(1);
    await page.goto('/#/products/STATE-SECOND');
    await expect(page.getByText('Produto segundo', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeEnabled();
    const saveResponse = page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === 'PUT' && response.url().includes('/api/product-update?sku=STATE-FIRST')
      );
    });
    await releaseSave();
    await saveResponse;
    await expect(page.getByText('Produto segundo', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Arquivar produto' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Salvando|Atualizando/ })).toHaveCount(0);
    await expect(page.getByText('Produto primeiro salvo', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Produto atualizado com sucesso!', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Erro ao salvar produto.', { exact: true })).toHaveCount(0);

    await page.goto('/#/products/STATE-FIRST');
    await page.getByRole('button', { name: 'Arquivar produto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect.poll(() => deleteStarted).toBe(1);
    await page.goto('/#/products/STATE-SECOND');
    await expect(page.getByText('Produto segundo', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeEnabled();
    const deleteResponse = page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === 'DELETE' && response.url().includes('/api/products?id=STATE-FIRST')
      );
    });
    await releaseDelete();
    await deleteResponse;
    await expect(page.getByText('Produto segundo', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Arquivar produto' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Salvando|Atualizando/ })).toHaveCount(0);
    await expect(page.getByText('Produto primeiro salvo', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Produto atualizado com sucesso!', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Erro ao arquivar produto.', { exact: true })).toHaveCount(0);
  });

  test('faz refresh de atividade após salvar e mantém a resposta mais nova', async ({ page }) => {
    await mockProductApi(page, [product('SAVE-SKU', 'Produto antes')]);
    let activityRequests = 0;
    /** @type {(value?: unknown) => void} */
    let releaseInitialActivity = () => {};
    const initialActivityReady = new Promise((resolve) => {
      releaseInitialActivity = resolve;
    });
    await page.route('**/api/product-activity**', async (route) => {
      activityRequests += 1;
      if (activityRequests === 1) {
        await initialActivityReady;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            atividades: [
              {
                tipo: 'produto',
                texto: 'Histórico antigo',
                data: '2026-01-01T00:00:00.000Z',
                id: 'old-activity',
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          atividades: [
            {
              tipo: 'produto',
              texto: 'Histórico atualizado',
              data: '2026-01-02T00:00:00.000Z',
              id: 'fresh-activity',
            },
          ],
        }),
      });
    });

    await page.goto('/#/products/SAVE-SKU');
    await expect.poll(() => activityRequests).toBe(1);
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeVisible();
    await page.getByPlaceholder('Nome do produto').fill('Produto depois');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Produto atualizado com sucesso!', { exact: true })).toBeVisible();
    await expect.poll(() => activityRequests).toBe(2);
    await expect(page.getByText('Histórico atualizado', { exact: true })).toBeVisible();
    releaseInitialActivity();
    await page.waitForTimeout(100);
    await expect(page.getByText('Histórico atualizado', { exact: true })).toBeVisible();
    await expect(page.getByText('Histórico antigo', { exact: true })).toHaveCount(0);
  });

  test('expõe erro de atividade com retry e formata data em pt-BR', async ({ page }) => {
    await mockProductApi(page, [product('ERROR-SKU', 'Produto com erro')]);
    let activityRequests = 0;
    /** @type {(value?: unknown) => void} */
    let releaseRetryActivity = () => {};
    const retryActivityReady = new Promise((resolve) => {
      releaseRetryActivity = resolve;
    });
    await page.route('**/api/product-activity**', async (route) => {
      activityRequests += 1;
      if (activityRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Falha temporária' }),
        });
        return;
      }
      await retryActivityReady;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          atividades: [
            {
              tipo: 'preco',
              texto: 'Preço atualizado',
              data: '2026-01-01T15:04:05.000Z',
              id: 'readable-date',
            },
          ],
        }),
      });
    });

    await page.goto('/#/products/ERROR-SKU');
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a atividade.');
    await expect(
      page.getByText('Sem atividade recente para este produto.', { exact: true })
    ).toHaveCount(0);
    await page.getByRole('alert').getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByText('Carregando atividade…', { exact: true })).toHaveText('Carregando atividade…');
    await expect(
      page.getByText('Sem atividade recente para este produto.', { exact: true })
    ).toHaveCount(0);
    releaseRetryActivity();
    await expect(page.getByText('Preço atualizado', { exact: true })).toBeVisible();
    await expect(page.getByText(/01\/01\/2026/).first()).toBeVisible();
    await expect(page.getByText('2026-01-01T15:04:05.000Z', { exact: true })).toHaveCount(0);
    await expect.poll(() => activityRequests).toBe(2);
  });

  test('mostra mensagem correta ao falhar ao restaurar ou arquivar', async ({ page }) => {
    const archived = product('RESTORE-SKU', 'Produto arquivado', false);
    const active = product('ARCHIVE-SKU', 'Produto ativo');
    await mockProductApi(page, [archived, active]);

    await page.route('**/api/product-update**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'PATCH' && url.searchParams.get('sku') === 'RESTORE-SKU') {
        await route.fulfill({ status: 503, body: '' });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/products**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'DELETE' && url.searchParams.get('id') === 'ARCHIVE-SKU') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/#/products/RESTORE-SKU');
    await page.getByRole('button', { name: 'Restaurar produto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect(page.getByText(/Erro ao restaurar/i)).toBeVisible();

    await page.goto('/#/products/ARCHIVE-SKU');
    await page.getByRole('button', { name: 'Arquivar produto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect(page.getByText(/Erro ao arquivar/i)).toBeVisible();
  });

  test('cria novo produto sem consultar modo externo', async ({ page }) => {
    const { requests } = await mockProductApi(page, []);
    await page.goto('/#/products/new');
    await expect(page.getByRole('button', { name: 'Criar produto' })).toBeVisible();
    await page.getByPlaceholder('LNC-SED-70').fill('LOCAL-NEW');
    await page.getByPlaceholder('Nome do produto').fill('Produto local novo');
    await page.getByLabel('Preço base').fill('12.50');
    await page.getByRole('button', { name: 'Criar produto' }).click();

    await expect(page).toHaveURL(/#\/products\/LOCAL-NEW$/);
    const post = requests.find((request) => request.method === 'POST');
    expect(post?.body?.preco_base).toBe('12.50');
    expect(post?.body?.precos).toEqual([]);
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(0);
  });

  test('separa seleção, arquivamento e abertura do card ao operar por teclado', async ({
    page,
  }) => {
    const longName = 'Camiseta algodão premium coleção primavera azul-marinho';
    const row = product('A11Y-SKU', longName);
    row.preco_minimo = '19.90';
    row.pricing_available = true;
    const { requests } = await mockProductApi(page, [row]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/products');

    // Cada produto é uma linha da tabela; o link da linha abre o produto.
    const productCard = page.getByRole('row').filter({ has: page.getByRole('link', { name: /Abrir produto A11Y-SKU/ }) });
    const openButton = productCard.getByRole('link', { name: /Abrir produto A11Y-SKU/ });
    const checkbox = page.getByRole('checkbox', { name: 'Selecionar produto A11Y-SKU' });
    const archiveButton = page.getByRole('button', { name: 'Arquivar produto A11Y-SKU' });
    const displayedName = page.getByText(longName, { exact: true }).first();

    await expect(productCard).toBeVisible();
    await page.getByRole('button', { name: 'Selecionar', exact: true }).click();
    await checkbox.focus();
    await checkbox.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(page).toHaveURL(/#\/products$/);

    await archiveButton.focus();
    await archiveButton.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('Arquivar produto');
    await expect(page).toHaveURL(/#\/products$/);
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

    await expect(displayedName).toBeVisible();
    await expect(displayedName).toHaveAttribute('title', longName);
    await expect(productCard.getByText('A11Y-SKU', { exact: true })).toBeVisible();
    await expect(productCard.getByText('R$ 19,90', { exact: true })).toBeVisible();
    await expect(archiveButton).toBeVisible();

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(productCard).toBeVisible();
    await expect(productCard.getByText('A11Y-SKU', { exact: true })).toBeVisible();
    await expect(archiveButton).toBeVisible();

    await openButton.focus();
    await expect(openButton).toBeFocused();
    await openButton.press('Enter');
    await expect(page).toHaveURL(/#\/products\/A11Y-SKU$/);
  });

  test('preserva busca e ações dos cards mobile por mouse', async ({ page }) => {
    await mockProductApi(page, [product('MOBILE-SKU', 'Produto acessível no celular')]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/products');

    const checkbox = page.getByRole('checkbox', { name: 'Selecionar produto MOBILE-SKU' });
    await page.getByRole('button', { name: 'Selecionar', exact: true }).click();
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await page.getByRole('button', { name: 'Arquivar produto MOBILE-SKU' }).click();
    await expect(page.getByRole('dialog')).toContainText('Arquivar produto');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

    await page.getByRole('searchbox', { name: 'Buscar produtos' }).fill('SEM-RESULTADO');
    await expect(
      page.getByText('Nenhum produto encontrado para estes filtros', { exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Limpar filtros' }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Limpar filtros' }).last().click();
    await expect(
      page.getByRole('list', { name: 'Produtos do catálogo' }).getByText('Produto acessível no celular', { exact: true })
    ).toBeVisible();

    await page.getByRole('link', { name: /Abrir produto MOBILE-SKU/ }).click();
    await expect(page).toHaveURL(/#\/products\/MOBILE-SKU$/);
  });
});
