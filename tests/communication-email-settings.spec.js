// @ts-check
import { expect, test } from '@playwright/test';

test('comunicação não expõe editor runtime de e-mail de orçamento', async ({ page }) => {
  await page.route('**/api/communication-flows**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flows: [], selectedFlowId: '' }),
    });
  });

  await page.goto('/#/comunicacao');

  await expect(page.getByRole('button', { name: 'E-mail de orçamento' })).toHaveCount(0);
});
