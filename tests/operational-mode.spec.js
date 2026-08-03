// @ts-check
import { test, expect } from '@playwright/test';

// These E2E tests verify navigation gating in operational mode.
// They require CRM_OPERATIONAL_MODE=true to be set in the environment.

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Operational mode navigation gating', () => {
  test.describe('sidebar shows only operational items', () => {
    test('hides deferred nav items in operational mode', async ({ page }) => {
      // Navigate to the app
      await page.goto(`${BASE_URL}/#/manual`);
      await page.waitForTimeout(1000);

      // Check that deferred items are NOT visible
      const sidebar = page.locator('aside');
      
      // These should be hidden/absent
      await expect(sidebar.getByText('Auto', { exact: true })).not.toBeVisible();
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

    test('/auto redirects to /manual', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/auto`);
      await page.waitForTimeout(2000);
      
      expect(page.url()).toContain('#/manual');
    });

    test('/dashboard redirects to /manual', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/dashboard`);
      await page.waitForTimeout(2000);
      
      expect(page.url()).toContain('#/manual');
    });
  });

  test.describe('settings page operational section', () => {
    test('shows Modo Operacional section', async ({ page }) => {
      await page.goto(`${BASE_URL}/#/settings`);
      await page.waitForTimeout(1000);
      
      // Should show the operational mode section
      await expect(page.getByText('Modo Operacional')).toBeVisible();
    });
  });
});
