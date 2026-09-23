// @ts-check
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const CLIENT_NAME = 'Cliente com nome longo para consulta comercial';
const LOGO = await readFile(new globalThis.URL('../public/logo_branca.svg', import.meta.url));

const DETAIL = {
  id: CLIENT_ID,
  name: CLIENT_ID,
  nome: CLIENT_NAME,
  display_name: CLIENT_NAME,
  email: 'cliente@example.com',
  telefone: '5511999990000',
  documento: '12345678901',
  tax_id: '12345678901',
  arquivado: false,
  status: 'active',
  address: {
    endereco: 'Rua das Oficinas',
    numero: '123',
    bairro: 'Centro',
    complemento: 'Fundos',
    municipio: 'São Paulo',
    uf: 'SP',
    cep: '01234-567',
  },
  latest_quotation: {
    name: 'ORC-20260001',
    status: 'Aprovado',
    date: '2026-09-01',
    grand_total: '1250.00',
  },
  deal: {
    name: 'Negócio Cliente Longo',
    status: 'Em negociação',
    next_step: 'Confirmar quantidades',
  },
  orders: [
    {
      name: 'PED-2026-0001',
      status: 'Em produção',
      date: '2026-09-02',
      grand_total: '900.00',
    },
  ],
  quality_flags: [],
  notes: 'Prefere contato pela manhã.',
  observacoes: 'Prefere contato pela manhã.',
};

const ROW = {
  id: CLIENT_ID,
  nome: CLIENT_NAME,
  email: DETAIL.email,
  telefone: DETAIL.telefone,
  documento: DETAIL.documento,
  tipo: 'cliente',
  status: 'active',
  arquivado: false,
};

/** @param {import('@playwright/test').Page} page */
async function installApiFixtures(page) {
  await page.route('**/logo_branca.svg', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: LOGO })
  );
  await page.route('**/api/leads-clients**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [ROW],
        pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
      }),
    });
  });
  await page.route('**/api/client-detail**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DETAIL),
    });
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ route: string, viewport: { width: number, height: number }, filename: string, prepare: () => Promise<void> }} options
 */
async function captureSketchV01(page, { route, viewport, filename, prepare }) {
  await page.setViewportSize(viewport);
  await page.goto(route);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await prepare();
  await page.evaluate(() => globalThis.document.fonts.ready);
  if (viewport.width >= 1280) {
    await expect
      .poll(() =>
        page
          .getByAltText('Aspen Estamparia')
          .evaluate((image) => /** @type {HTMLImageElement} */ (image).naturalWidth)
      )
      .toBeGreaterThan(0);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `docs/design/evidence/clientes/${filename}-sketch-v01.png` });
}

test.describe('Evidência visual de Clientes', () => {
  test.skip(
    !process.env.CAPTURE_CLIENTES_EVIDENCE,
    'Captura explícita; não altera artefatos durante o E2E padrão.'
  );

  test('captura a jornada de Clientes nos estados aprovados', async ({ page }) => {
    await installApiFixtures(page);

    await captureSketchV01(page, {
      route: '/#/leads',
      viewport: { width: 1440, height: 900 },
      filename: 'lista-1440x900',
      prepare: async () => {
        await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
      },
    });

    await captureSketchV01(page, {
      route: '/#/leads',
      viewport: { width: 1280, height: 800 },
      filename: 'drawer-1280x800',
      prepare: async () => {
        await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
        await page.getByRole('button', { name: `Visualização rápida ${CLIENT_NAME}` }).click();
        await expect(page.getByRole('dialog', { name: CLIENT_NAME })).toBeVisible();
      },
    });

    await captureSketchV01(page, {
      route: `/#/leads/cliente/${CLIENT_ID}`,
      viewport: { width: 1440, height: 900 },
      filename: 'cadastro-1440x900',
      prepare: async () => {
        await expect(page.getByRole('heading', { name: CLIENT_NAME, exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Atividade recente' })).toBeVisible();
      },
    });

    await captureSketchV01(page, {
      route: `/#/leads/cliente/${CLIENT_ID}`,
      viewport: { width: 1024, height: 800 },
      filename: 'edicao-1024x800',
      prepare: async () => {
        await expect(page.getByRole('heading', { name: CLIENT_NAME, exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Editar cadastro' }).click();
        await expect(page.getByRole('heading', { name: 'Editar cliente' })).toBeVisible();
      },
    });

    await captureSketchV01(page, {
      route: `/#/leads/cliente/${CLIENT_ID}`,
      viewport: { width: 390, height: 844 },
      filename: 'cadastro-mobile-390x844',
      prepare: async () => {
        await expect(page.getByRole('heading', { name: CLIENT_NAME, exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Atividade recente' })).toBeVisible();
      },
    });
  });
});
