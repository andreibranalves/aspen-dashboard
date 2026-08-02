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
    preco_minimo: null,
    pricing_available: false,
  };
}

function detail(row, coreMode) {
  return {
    core_mode: coreMode,
    source: coreMode ? 'postgres' : 'frappe',
    produto: {
      ...row,
      imagem: null,
      modificado_em: row.atualizado_em,
    },
    precos: [],
    pricing_available: false,
  };
}

async function mockProductApi(
  page,
  initialRows,
  { coreMode = true, postIgnoresBrand = false } = {}
) {
  const rows = initialRows.map((row) => ({ ...row }));
  const requests = [];
  const updates = [];

  await page.route('**/api/products**', async (route) => {
    const request = route.request();
    const method = request.method();
    requests.push({ method, url: request.url() });

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
          core_mode: coreMode,
          source: coreMode ? 'postgres' : 'frappe',
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
      row.marca = postIgnoresBrand ? null : body.marca || null;
      row.unidade = body.unidade || 'Und';
      rows.push(row);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          created: row.sku,
          produto: row,
          core_mode: coreMode,
          source: coreMode ? 'postgres' : 'frappe',
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
          core_mode: coreMode,
          source: coreMode ? 'postgres' : 'frappe',
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
      body: JSON.stringify(detail(row, coreMode)),
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
        core_mode: coreMode,
        source: coreMode ? 'postgres' : 'frappe',
      }),
    });
  });

  return { rows, requests, updates };
}

test.describe('Produtos — catálogo principal', () => {
  test('cria, pesquisa, edita, arquiva e restaura produto no PostgreSQL', async ({ page }) => {
    const { rows } = await mockProductApi(page, [product('CORE-SEED', 'Produto inicial')]);

    await page.goto('/#/products');
    await expect(page.getByRole('heading', { name: 'Produtos' })).toBeVisible();
    await page.getByRole('button', { name: 'Criar Produto' }).click();
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

    await page.getByRole('button', { name: 'Editar produto' }).click();
    await page.getByPlaceholder('Nome do produto').fill('Produto editado');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Produto atualizado com sucesso!', { exact: true })).toBeVisible();
    expect(rows.find((row) => row.sku === 'CORE-NEW')?.nome).toBe('Produto editado');

    await page.goto('/#/products');
    await expect(page.getByText('Produto editado', { exact: true }).first()).toBeVisible();
    await page.getByPlaceholder('Buscar por SKU ou nome…').fill('CORE-NEW');
    await expect(page.getByText('Produto editado', { exact: true }).first()).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Arquivar produto CORE-NEW' }).click();
    await expect(page.getByText('Produto editado', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Arquivados' }).click();
    await expect(page.getByText('Produto editado', { exact: true }).first()).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Restaurar produto CORE-NEW' }).click();
    await expect(page.getByText('Produto editado', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ativos' }).click();
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
      .getByPlaceholder('Digite SKU ou nome para adicionar um produto…')
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

  test('não consulta atividade Frappe ao abrir um produto do catálogo principal', async ({
    page,
  }) => {
    await mockProductApi(page, [product('CORE-ACTIVITY', 'Produto sem atividade Frappe')]);
    let activityRequests = 0;
    await page.route('**/api/product-activity**', async (route) => {
      activityRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ atividades: [] }),
      });
    });

    await page.goto('/#/products/CORE-ACTIVITY');
    await expect(
      page.getByText('Produto sem atividade Frappe', { exact: true }).first()
    ).toBeVisible();
    await page.waitForTimeout(100);

    expect(activityRequests).toBe(0);
  });

  test('consulta atividade legada uma única vez após salvar um produto existente', async ({
    page,
  }) => {
    await mockProductApi(page, [product('LEGACY-ACTIVITY', 'Produto legado')], { coreMode: false });
    let activityRequests = 0;
    await page.route('**/api/product-activity**', async (route) => {
      activityRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ atividades: [] }),
      });
    });

    await page.goto('/#/products/LEGACY-ACTIVITY');
    await expect(page.getByText('Produto legado', { exact: true }).first()).toBeVisible();
    await expect.poll(() => activityRequests).toBe(1);

    await page.getByRole('button', { name: 'Editar produto' }).click();
    await page.getByPlaceholder('Nome do produto').fill('Produto legado atualizado');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Produto atualizado com sucesso!', { exact: true })).toBeVisible();
    await expect.poll(() => activityRequests).toBe(2);
    await page.waitForTimeout(100);
    expect(activityRequests).toBe(2);
  });

  test('persiste Marca pela atualização ao criar produto legado quando o POST a ignora', async ({
    page,
  }) => {
    const { rows, updates } = await mockProductApi(page, [], {
      coreMode: false,
      postIgnoresBrand: true,
    });
    await page.route('**/api/product-activity**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ atividades: [] }),
      });
    });

    await page.goto('/#/products/new');
    await expect(page.getByRole('button', { name: 'Criar produto' })).toBeVisible();
    await page.getByPlaceholder('LNC-SED-70').fill('LEGACY-BRAND');
    await page.getByPlaceholder('Nome do produto').fill('Produto legado');
    await page.getByPlaceholder('Marca').fill('Marca preservada');
    await page.getByRole('button', { name: 'Criar produto' }).click();

    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]).toEqual({ sku: 'LEGACY-BRAND', body: { marca: 'Marca preservada' } });
    await expect(page.getByText('Marca preservada', { exact: true }).first()).toBeVisible();
    expect(rows.find((row) => row.sku === 'LEGACY-BRAND')?.marca).toBe('Marca preservada');
  });
});
