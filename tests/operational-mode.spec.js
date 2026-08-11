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
        items: [{
          item_code: 'CORE-001',
          item_name: 'Produto Core',
          qty: 10,
          rate: 12,
          manual_rate: false,
        }],
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
