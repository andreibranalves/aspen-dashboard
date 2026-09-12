import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const extension = new URL('../extensions/whatsapp-context/', import.meta.url);

test('drawer suggests ninth digit, confirms once, reopens and unlinks', async ({ page }) => {
  await page.route('https://web.whatsapp.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="main" role="main"><header data-testid="conversation-info-header-chat-title">Cliente exemplo</header><div data-id="false_554199701234@c.us_message"></div></div></body></html>' }));
  await page.goto('https://web.whatsapp.com/');
  await page.evaluate(() => {
    globalThis.localStorage.setItem('last-wid-md', JSON.stringify('5511988881234:2@c.us'));
    let saved = false;
    const candidate = { id: '00000000-0000-4000-8000-000000000001', nome: 'Cliente exemplo', telefone: '41999701234', tipo: 'cliente' };
    globalThis.chrome = { runtime: { sendMessage(message, callback) {
      if (message.type === 'aspen-context:link') { saved = true; callback({ ok: true }); return; }
      if (message.type === 'aspen-context:unlink') { saved = false; callback({ ok: true }); return; }
      if (message.type !== 'aspen-context:lookup') return;
      if (message.accountId !== '5511988881234@s.whatsapp.net') throw new Error('Account not resolved');
      const linking = { available: true, version: saved ? '00000000-0000-4000-8000-000000000002' : null };
      callback(saved ? { match: 'matched', contact: candidate, quotations: [], deliveries: [], actions: {}, linking } : { match: 'suggested', reason: 'Possível correspondência: diferença no nono dígito.', candidates: [candidate], linking });
    } } };
  });
  await page.addStyleTag({ content: await readFile(new URL('styles.css', extension), 'utf8') });
  await page.addScriptTag({ content: await readFile(new URL('provider.js', extension), 'utf8') });
  await page.addScriptTag({ content: await readFile(new URL('content.js', extension), 'utf8') });
  const drawer = page.getByRole('complementary', { name: 'Contexto comercial Aspen' });
  await expect(drawer.getByText('Possível correspondência: diferença no nono dígito.')).toBeVisible();
  await expect(drawer.getByText('Nenhum orçamento ainda.')).toHaveCount(0);
  page.on('dialog', dialog => dialog.accept());
  await drawer.getByRole('button', { name: 'Vincular cliente', exact: true }).click();
  await expect(drawer.getByText('Nenhum orçamento ainda.')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await page.locator('.aspen-drawer-toggle').click();
  await expect(drawer.getByRole('button', { name: 'Desvincular cliente' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Desvincular cliente' }).click();
  await expect(drawer.getByRole('button', { name: 'Vincular cliente', exact: true })).toBeVisible();
  const box = await drawer.boundingBox();
  expect(Math.round(box.height)).toBe(page.viewportSize().height);
});
