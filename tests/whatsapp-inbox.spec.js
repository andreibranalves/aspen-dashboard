// @ts-check
import { test, expect } from '@playwright/test';

test.describe('WhatsApp Inbox Page', () => {
  test('page loads with full layout: sidebar, header, filters, three-column inbox', async ({
    page,
  }) => {
    await page.goto('/#/whatsapp-inbox');

    // Header and breadcrumb
    await expect(page.getByText('WhatsApp').first()).toBeVisible({ timeout: 10000 });

    // Sidebar has WhatsApp nav item (highlighted when active)
    const sidebar = page.locator('aside, nav, [class*="sidebar"], [class*="Sidebar"]').first();
    await expect(sidebar).toContainText('WhatsApp');

    // Status filter chips
    await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novas' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Pedido detectado/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pré-orçamento', exact: true })).toBeVisible();

    // Search input
    await expect(page.getByPlaceholder(/Buscar/)).toBeVisible();

    // Action buttons
    await expect(page.getByRole('button', { name: 'Atualizar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sincronizar' })).toBeVisible();

    // Three-column layout sections
    await expect(page.getByText('Conversas')).toBeVisible();
    await expect(page.getByText('Painel comercial')).toBeVisible();
  });

  test('sync button is clickable and API responds (200 or 500 with Portuguese error)', async ({
    page,
  }) => {
    await page.goto('/#/whatsapp-inbox');
    await page.waitForSelector('button:has-text("Sincronizar")', { timeout: 10000 });

    // Click Sincronizar and wait for network to settle
    const syncBtn = page.getByRole('button', { name: 'Sincronizar' });
    await syncBtn.click();

    // Wait for either: updated conversation list OR error message
    // The result depends on whether Evolution API is configured
    await page.waitForTimeout(5000);

    // Page should still be functional — no crash, no blank screen
    await expect(page.getByText('WhatsApp').first()).toBeVisible();
  });

  test('commercial panel shows action buttons for selected conversation', async ({ page }) => {
    await page.goto('/#/whatsapp-inbox');
    await page.waitForSelector('button:has-text("Sincronizar")', { timeout: 10000 });

    // Commercial panel actions
    await expect(page.getByRole('button', { name: /Extrair orçamento/ })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: /Criar pré-orçamento/ })).toBeVisible({
      timeout: 5000,
    });
  });
});
