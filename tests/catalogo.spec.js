// @ts-check
import { expect, test } from '@playwright/test';

const rows = [
  {
    sku: 'CAT-001',
    nome: 'Lenço demonstrativo',
    descricao: 'Produto usado na jornada do catálogo.',
    unidade: 'Und',
    categoria: 'Lenços',
    marca: 'Aspen',
    ativo: true,
    preco_base: '12.50',
    precos: [{ minimum_quantity: '30', unit_price: '10.00' }],
    preco_minimo: '10.00',
    pricing_available: true,
  },
];

const media = {
  success: true,
  items: [
    {
      id: 'media-1',
      title: 'Campanha de inverno',
      description: '',
      product_group: 'lenços',
      product_code: null,
      kind: 'image',
      blob_url: 'https://example.com/media.png',
      pathname: 'media.png',
      content_type: 'image/png',
      size_bytes: 1200,
      caption: '',
      active: true,
      sort_order: 0,
      created_at: '2026-08-01T09:00:00.000Z',
      updated_at: '2026-08-01T09:00:00.000Z',
      created_by: 'test',
    },
  ],
};

async function mockCatalogApi(page, { templates = [], templateStatus = 200 } = {}) {
  await page.route('**/api/products**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.get('view') === 'categories') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ categories: ['Lenços'] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: rows,
        pagination: { page: 1, limit: 10, total: rows.length, total_pages: 1 },
      }),
    });
  });
  await page.route('**/api/order-templates**', async (route) => {
    await route.fulfill({
      status: templateStatus,
      contentType: 'application/json',
      body: JSON.stringify(
        templateStatus === 200 ? { data: templates } : { error: 'Erro controlado' }
      ),
    });
  });
  await page.route('**/api/communication-media**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(media),
    });
  });
}

test.describe('Catálogo — abas e superfícies @catalog @smoke', () => {
  test('preserva Produtos, Conjuntos e Mídias na mesma jornada', async ({ page }) => {
    await mockCatalogApi(page, {
      templates: [
        {
          id: 'set-1',
          name: 'Kit inverno',
          archived: false,
          items: [{ sku: 'CAT-001', name: 'Lenço demonstrativo', position: 0 }],
          created_at: '2026-08-01T09:00:00.000Z',
          updated_at: '2026-08-01T09:00:00.000Z',
        },
      ],
    });

    await page.goto('/#/catalog');
    await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible();
    await expect(page.getByText('CAT-001').first()).toBeVisible();

    const setsTab = page.getByRole('tab', { name: 'Conjuntos de produtos' });
    await setsTab.focus();
    await setsTab.press('Enter');
    await expect(page).toHaveURL(/#\/catalog\?tab=sets$/);
    await expect(page.getByText('Kit inverno')).toBeVisible();
    await page.getByRole('button', { name: 'Novo conjunto' }).click();
    await expect(page.getByRole('dialog', { name: 'Modelos de pedido' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Modelos de pedido' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Editar conjunto' }).click();
    await expect(page.getByRole('heading', { name: 'Editar modelo' })).toBeVisible();
    await expect(page.getByLabel('Nome')).toHaveValue('Kit inverno');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Mídias' }).click();
    await expect(page.getByRole('heading', { name: 'Biblioteca de mídias' })).toBeVisible();
    await expect(page.getByText('Campanha de inverno')).toBeVisible();
    await page.getByRole('button', { name: 'Adicionar mídia' }).click();
    await expect(page.getByRole('heading', { name: 'Adicionar mídia' })).toBeVisible();
  });

  test('mantém erro de conjuntos no contexto com tentativa explícita', async ({ page }) => {
    await mockCatalogApi(page, { templateStatus: 500 });
    await page.goto('/#/catalog?tab=sets');
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar os conjuntos');
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  });
});
