// @ts-check
import { expect, test } from '@playwright/test';

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test('/#/follow-ups redireciona para a fila operacional Comercial (#254)', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) =>
    json(route, { data: [], total: 0, page: 1, page_size: 25 })
  );

  await page.goto('/#/follow-ups?view=ready');
  await expect(page).toHaveURL(/#\/crm/);
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Fila' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Follow-ups' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Prontos' })).toHaveCount(0);
});

test('bookmark legado de Retornos cai na Fila Comercial (#254)', async ({ page }) => {
  await page.route('**/api/commercial-queue**', (route) =>
    json(route, { data: [], total: 0, page: 1, page_size: 25 })
  );

  await page.goto('/#/crm?tab=returns&return=sent');
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Fila' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Após envio' })).toHaveCount(0);
});
