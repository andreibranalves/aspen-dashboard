// @ts-check
/* global URLSearchParams */
import { test, expect } from '@playwright/test';

// These E2E tests verify operational navigation and the Auto UI contract.
// Backend OpenRouter/PostgreSQL behavior is covered by direct unit and database tests.
// They mock CRM_OPERATIONAL_MODE=true through /api/settings.

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Operational mode navigation gating', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/settings**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ operational_mode: true }),
      });
    });
    await page.route('**/api/quotation-templates**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ templates: [], default_key: 'padrao' }),
      });
    });
    await page.route('**/api/order-templates**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });
  });

  test.describe('sidebar shows only operational items', () => {
    test('hides deferred nav items in operational mode', async ({ page }) => {
      // Navigate to the app
      await page.goto(`${BASE_URL}/#/manual`);
      await page.waitForTimeout(1000);

      // Check that deferred items are NOT visible while Auto remains available.
      const sidebar = page.locator('aside');

      // AI quotation flow remains available on the PostgreSQL operational core.
      await expect(sidebar.getByText('Auto', { exact: true })).toBeVisible();
      await expect(sidebar.getByText('Pré-orçamentos')).not.toBeVisible();
      await expect(sidebar.getByText('Dashboard')).not.toBeVisible();
      await expect(sidebar.getByText('Pedidos')).not.toBeVisible();
      await expect(sidebar.getByText('CRM')).not.toBeVisible();
      await expect(sidebar.getByText('Comunicação')).not.toBeVisible();
      await expect(sidebar.getByText('WhatsApp', { exact: true })).not.toBeVisible();
    });

    test('shows operational nav items', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/manual`);
      await page.waitForTimeout(1000);

      const sidebar = page.locator('aside');

      // These should be visible
      await expect(sidebar.getByText('Auto', { exact: true })).toBeVisible();
      await expect(sidebar.getByText('Novo Orçamento')).toBeVisible();
      await expect(sidebar.getByText('Orçamentos')).toBeVisible();
      await expect(sidebar.getByText('Produtos')).toBeVisible();
      await expect(sidebar.getByText('Clientes')).toBeVisible();
      await expect(sidebar.getByText('Configurações')).toBeVisible();
    });
  });

  test.describe('route redirects', () => {
    test('root route redirects to /manual', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/`);
      await page.waitForTimeout(2000);

      // Should be redirected to /manual
      expect(page.url()).toContain('#/manual');
    });

    test('/auto remains available in operational mode', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/auto`);
      await page.waitForTimeout(2000);

      expect(page.url()).toContain('#/auto');
      await expect(page.getByRole('heading', { name: 'Pedido do cliente' })).toBeVisible();
    });

    test('/dashboard redirects to /manual', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/dashboard`);
      await page.waitForTimeout(2000);

      expect(page.url()).toContain('#/manual');
    });

    test('Auto preserves the extraction-to-quotation PostgreSQL UI contract', async ({ page }) => {
      /** @type {any} */
      let quoteRequest = null;
      /** @type {any} */
      let previewPayload = null;
      await page.route('**/api/quotations**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/quote-leads**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/communication-flows**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ flows: [] }),
        });
      });
      await page.route('**/api/extract', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            orders: [{ nome: 'Cliente Core', items: [{ item_code: 'CORE-001', qty: 10 }] }],
          }),
        });
      });
      await page.route('**/api/pricing-lookup', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: [{ item_code: 'CORE-001', rate: 12, item_name: 'Produto Core' }],
            core_mode: true,
            source: 'postgres',
          }),
        });
      });
      await page.context().route('**/api/quotation-preview', async (route) => {
        const form = new URLSearchParams(route.request().postData() || '');
        previewPayload = JSON.parse(form.get('payload') || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body>Cliente Core - Produto Core</body></html>',
        });
      });
      await page.route('**/api/orcamento', async (route) => {
        quoteRequest = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            quotation_id: 'ORC-PG-0001',
            quotation_uuid: '00000000-0000-4000-8000-000000000001',
            revision_id: '00000000-0000-4000-8000-000000000002',
            cliente: 'Cliente Core',
            items: [{ item_code: 'CORE-001', qty: 10, rate: 12 }],
            core_mode: true,
            source: 'postgres',
          }),
        });
      });

      await page.goto(`${BASE_URL}/#/auto`);
      const textarea = page.locator('textarea').first();
      await textarea.fill('Cliente Core precisa de 10 produtos.');
      await page.getByRole('button', { name: /Extrair/i }).click();
      await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible();
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('button', { name: 'Visualizar' }).click();
      const popup = await popupPromise;
      await expect(popup.getByText('Cliente Core - Produto Core')).toBeVisible();
      expect(previewPayload?.extracted).toMatchObject({
        nome: 'Cliente Core',
        template_key: 'padrao',
        items: [
          {
            item_code: 'CORE-001',
            item_name: 'Produto Core',
            qty: 10,
            rate: 12,
            manual_rate: false,
          },
        ],
      });
      expect(quoteRequest).toBeNull();
      await popup.close();
      await page.getByRole('button', { name: 'Criar orçamento' }).click();
      await expect(page.getByText('Orçamento criado', { exact: false })).toBeVisible();
      expect(quoteRequest?.extracted?.items?.[0]).toMatchObject({
        item_code: 'CORE-001',
        qty: 10,
        rate: 12,
        manual_rate: false,
      });
    });

    test('disables preview and creation when Auto draft has no valid items', async ({ page }) => {
      await page.route('**/api/quotations**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/quote-leads**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/communication-flows**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ flows: [] }),
        });
      });
      await page.route('**/api/extract', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            orders: [{ nome: 'Cliente sem item', items: [] }],
          }),
        });
      });

      await page.goto(`${BASE_URL}/#/auto`);
      await page.locator('textarea').first().fill('Cliente sem item');
      await page.getByRole('button', { name: /Extrair/i }).click();
      await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Visualizar' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Criar orçamento' })).toBeDisabled();
    });

    test('selects an order template and sends its id with extraction', async ({ page }) => {
      /** @type {any} */
      let extractRequest = null;
      await page.route('**/api/order-templates', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'pack-id',
                name: 'Pack de produtos',
                archived: false,
                items: [
                  { sku: 'SKU-A', name: 'Produto A', position: 0 },
                  { sku: 'SKU-B', name: 'Produto B', position: 1 },
                ],
                created_at: '2026-08-11T00:00:00.000Z',
                updated_at: '2026-08-11T00:00:00.000Z',
              },
            ],
          }),
        });
      });
      await page.route('**/api/quotations**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/quote-leads**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/communication-flows**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ flows: [] }),
        });
      });
      await page.route('**/api/extract', async (route) => {
        extractRequest = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            orders: [
              {
                nome: 'Andrei B.',
                email: 'andrei@gmail.com',
                telefone: '21999999999',
                items: [
                  { item_code: 'SKU-A', qty: 300 },
                  { item_code: 'SKU-B', qty: 300 },
                  { item_code: 'SKU-A', qty: 500 },
                  { item_code: 'SKU-B', qty: 500 },
                ],
              },
            ],
          }),
        });
      });
      await page.route('**/api/pricing-lookup', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: [
              { item_code: 'SKU-A', rate: 10, item_name: 'Produto A' },
              { item_code: 'SKU-B', rate: 12, item_name: 'Produto B' },
              { item_code: 'SKU-A', rate: 10, item_name: 'Produto A' },
              { item_code: 'SKU-B', rate: 12, item_name: 'Produto B' },
            ],
          }),
        });
      });

      await page.goto(`${BASE_URL}/#/auto`);
      const templateSelect = page.getByLabel('Template de pedido');
      await expect(templateSelect).toHaveValue('');
      await templateSelect.selectOption('pack-id');
      await page
        .locator('textarea')
        .first()
        .fill('Andrei B. andrei@gmail.com 21999999999 300 e 500 unidades');
      await page.getByRole('button', { name: /Extrair/i }).click();
      await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible();
      const itemRows = page.locator('table tbody tr');
      await expect(itemRows).toHaveCount(4);
      await expect(itemRows.nth(0)).toContainText('Produto A');
      await expect(itemRows.nth(0)).toContainText('300');
      await expect(itemRows.nth(1)).toContainText('Produto B');
      await expect(itemRows.nth(1)).toContainText('300');
      await expect(itemRows.nth(2)).toContainText('Produto A');
      await expect(itemRows.nth(2)).toContainText('500');
      await expect(itemRows.nth(3)).toContainText('Produto B');
      await expect(itemRows.nth(3)).toContainText('500');
      expect(extractRequest?.orderTemplateId).toBe('pack-id');
      expect(extractRequest?.text).toContain('300 e 500 unidades');
      expect(extractRequest).not.toHaveProperty('skus');
      expect(extractRequest).not.toHaveProperty('templateSkus');
      await page.getByRole('button', { name: 'Limpar', exact: true }).click();
      await expect(templateSelect).toHaveValue('');
    });

    test('creates an order template from the manager catalog search', async ({ page }) => {
      /** @type {any} */
      let createRequest = null;
      /** @type {any} */
      let createdTemplate = null;
      await page.route('**/api/order-templates', async (route) => {
        if (route.request().method() === 'POST') {
          createRequest = route.request().postDataJSON();
          createdTemplate = {
            id: 'new-pack-id',
            name: createRequest.name,
            archived: false,
            items: createRequest.skus.map((sku, position) => ({
              sku,
              name: sku === 'LNC-A' ? 'Lenço A' : 'Lenço B',
              position,
            })),
            created_at: '2026-08-11T00:00:00.000Z',
            updated_at: '2026-08-11T00:00:00.000Z',
          };
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ id: 'new-pack-id' }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: createdTemplate ? [createdTemplate] : [] }),
        });
      });
      await page.route('**/api/products**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              { sku: 'LNC-A', nome: 'Lenço A', pricing_available: true },
              { sku: 'LNC-B', nome: 'Lenço B', pricing_available: true },
              { sku: 'LNC-SEM-PRECO', nome: 'Sem preço', pricing_available: false },
            ],
          }),
        });
      });

      await page.goto(`${BASE_URL}/#/auto`);
      await page.getByRole('button', { name: 'Gerenciar' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Novo template' }).click();
      await dialog.getByLabel('Nome').fill('Todos os lenços');
      await dialog.getByLabel('Buscar produto').fill('LNC');
      await expect(dialog.getByRole('button', { name: /LNC-A/ })).toBeVisible();
      await expect(dialog.getByRole('button', { name: /LNC-SEM-PRECO/ })).not.toBeVisible();
      await dialog.getByRole('button', { name: 'Adicionar produto LNC-A' }).click();
      await dialog.getByLabel('Buscar produto').fill('LNC');
      await dialog.getByRole('button', { name: 'Adicionar produto LNC-A' }).click();
      await expect(dialog.getByLabel('SKU selecionado LNC-A')).toHaveCount(1);
      await dialog.getByLabel('Buscar produto').fill('LNC');
      await dialog.getByRole('button', { name: 'Adicionar produto LNC-B' }).click();
      await dialog.getByRole('button', { name: 'Salvar' }).click();
      await expect
        .poll(() => createRequest)
        .toEqual({ name: 'Todos os lenços', skus: ['LNC-A', 'LNC-B'] });
      await expect(dialog.getByRole('button', { name: 'Novo template' })).toBeVisible();
      await expect(dialog.getByText('Todos os lenços')).toBeVisible();
    });

    test('preserves manager form after a save failure', async ({ page }) => {
      await page.route('**/api/order-templates', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Nome duplicado.' }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/products**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [{ sku: 'SKU-A', nome: 'Produto A', pricing_available: true }],
          }),
        });
      });

      await page.goto(`${BASE_URL}/#/auto`);
      await page.getByRole('button', { name: 'Gerenciar' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Novo template' }).click();
      await dialog.getByLabel('Nome').fill('Template preservado');
      await dialog.getByLabel('Buscar produto').fill('SKU');
      await dialog.getByRole('button', { name: 'Adicionar produto SKU-A' }).click();
      await dialog.getByRole('button', { name: 'Salvar' }).click();
      await expect(dialog.getByText('Nome duplicado.')).toBeVisible();
      await expect(dialog.getByLabel('Nome')).toHaveValue('Template preservado');
      await expect(dialog.getByLabel('SKU selecionado SKU-A')).toHaveCount(1);
      await expect(dialog.getByRole('button', { name: 'Salvar' })).toBeEnabled();
    });

    test('updates, archives, and reloads the manager list after each mutation', async ({
      page,
    }) => {
      /** @type {any} */
      let templates = [
        {
          id: 'pack-id',
          name: 'Pack original',
          archived: false,
          items: [{ sku: 'SKU-A', name: 'Produto A', position: 0 }],
          created_at: '2026-08-11T00:00:00.000Z',
          updated_at: '2026-08-11T00:00:00.000Z',
        },
      ];
      /** @type {any} */
      let updateRequest = null;
      let deleteCount = 0;
      await page.route('**/api/order-templates**', async (route) => {
        const method = route.request().method();
        if (method === 'PUT') {
          updateRequest = route.request().postDataJSON();
          templates = [{ ...templates[0], name: updateRequest.name }];
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: 'pack-id' }),
          });
          return;
        }
        if (method === 'DELETE') {
          deleteCount += 1;
          await page.waitForTimeout(100);
          templates = [];
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ archived: true }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: templates }),
        });
      });

      await page.goto(`${BASE_URL}/#/auto`);
      await page.getByRole('button', { name: 'Gerenciar' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Editar' }).click();
      await dialog.getByLabel('Nome').fill('Pack atualizado');
      await dialog.getByRole('button', { name: 'Salvar' }).click();
      await expect.poll(() => updateRequest).toEqual({ name: 'Pack atualizado', skus: ['SKU-A'] });
      await expect(dialog.getByRole('button', { name: 'Novo template' })).toBeVisible();
      await expect(dialog.getByText('Pack atualizado')).toBeVisible();

      await dialog.getByRole('button', { name: 'Arquivar Pack atualizado' }).click();
      await expect(page.getByText(/Arquivar “Pack atualizado”/)).toBeVisible();
      await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Arquivar', exact: true })).not.toBeVisible();
      await expect.poll(() => deleteCount).toBe(1);
      await expect(dialog.getByText('Nenhum template criado')).toBeVisible();
    });

    test('closes the manager with Escape or backdrop and restores focus', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/auto`);
      const managerButton = page.getByRole('button', { name: 'Gerenciar' });
      await managerButton.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(managerButton).toBeFocused();

      await managerButton.click();
      await expect(dialog).toBeVisible();
      await page.getByTestId('order-template-manager-backdrop').click({ position: { x: 2, y: 2 } });
      await expect(dialog).not.toBeVisible();
      await expect(managerButton).toBeFocused();
    });

    test('clears a stale selected template after reload failure', async ({ page }) => {
      let reloadFailed = false;
      /** @type {any} */
      let extractRequest = null;
      await page.route('**/api/order-templates**', async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: 'pack-id' }),
          });
          return;
        }
        if (reloadFailed) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Falha' }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'pack-id',
                name: 'Pack de produtos',
                archived: false,
                items: [{ sku: 'SKU-A', name: 'Produto A', position: 0 }],
                created_at: '2026-08-11T00:00:00.000Z',
                updated_at: '2026-08-11T00:00:00.000Z',
              },
            ],
          }),
        });
      });
      await page.route('**/api/quotations**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/quote-leads**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/communication-flows**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ flows: [] }),
        });
      });
      await page.route('**/api/extract', async (route) => {
        extractRequest = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            orders: [{ nome: 'Cliente', items: [{ item_code: 'SKU-A', qty: 30 }] }],
          }),
        });
      });
      await page.route('**/api/pricing-lookup', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: [{ item_code: 'SKU-A', rate: 10, item_name: 'Produto A' }],
          }),
        });
      });

      await page.goto(`${BASE_URL}/#/auto`);
      const templateSelect = page.getByLabel('Template de pedido');
      await templateSelect.selectOption('pack-id');
      await page.getByRole('button', { name: 'Gerenciar' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Editar' }).click();
      await dialog.getByLabel('Nome').fill('Pack atualizado');
      reloadFailed = true;
      await dialog.getByRole('button', { name: 'Salvar' }).click();
      await expect(
        page.getByText('Não foi possível carregar os templates de pedido.')
      ).toBeVisible();
      await expect(templateSelect).toHaveValue('');
      await expect(templateSelect.locator('option')).toHaveCount(1);
      await dialog.getByRole('button', { name: 'Fechar' }).click();
      await expect(templateSelect.locator('option')).toHaveCount(1);
      await page.locator('textarea').first().fill('Cliente 30 unidades');
      await page.getByRole('button', { name: /Extrair/i }).click();
      await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible();
      expect(extractRequest).not.toHaveProperty('orderTemplateId');
    });

    test('keeps Auto usable when order-template loading fails', async ({ page }) => {
      await page.route('**/api/order-templates', async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Falha' }),
        });
      });
      await page.route('**/api/quotations**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/quote-leads**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      });
      await page.route('**/api/communication-flows**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ flows: [] }),
        });
      });
      await page.route('**/api/extract', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            orders: [{ nome: 'Sem template', items: [{ item_code: 'SKU-1', qty: 30 }] }],
          }),
        });
      });
      await page.route('**/api/pricing-lookup', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: [{ item_code: 'SKU-1', rate: 10, item_name: 'Produto' }],
          }),
        });
      });

      await page.goto(`${BASE_URL}/#/auto`);
      await expect(
        page.getByText('Não foi possível carregar os templates de pedido.')
      ).toBeVisible();
      await page.locator('textarea').first().fill('Sem template 30 unidades');
      await expect(page.getByRole('button', { name: /Extrair/i })).toBeEnabled();
      await page.getByRole('button', { name: /Extrair/i }).click();
      await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible();
    });
  });

  test.describe('settings page operational section', () => {
    test('shows Modo Operacional section', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/settings`);
      await page.waitForTimeout(1000);

      // Should show the operational mode section
      await expect(page.getByRole('heading', { name: 'Modo Operacional' })).toBeVisible();
    });
  });
});
