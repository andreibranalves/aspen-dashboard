// @ts-check
import { expect, test } from '@playwright/test';
import { respond } from './fixtures.js';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TALL = { width: 1440, height: 1600 };

const SCREENS = [
  { name: 'clientes', route: '/leads', heading: 'Clientes', mobile: true },
  { name: 'orcamentos', route: '/quotations', heading: 'Orçamentos', mobile: true, dark: true },
  { name: 'pedidos', route: '/sales-orders', heading: 'Pedidos', mobile: true },
  { name: 'produtos', route: '/products', heading: 'Produtos', mobile: true },
  { name: 'painel', route: '/dashboard', mobile: true },
  { name: 'crm', route: '/crm', mobile: true },
  { name: 'orcamento-detalhe', route: '/quotations/ORC-20260101', viewport: TALL, mobile: true },
  { name: 'novo-orcamento', route: '/novo-orcamento', viewport: TALL, mobile: true },
];

/** @param {import('@playwright/test').Page} page */
async function install(page, unmocked) {
  await page.clock.setFixedTime(new Date('2026-09-15T12:00:00-03:00'));
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const url = new globalThis.URL(route.request().url());
    const response = route.request().method() === 'GET' ? respond(url) : null;
    if (response === null) unmocked.push(`${route.request().method()} ${url.pathname}`);
    const { status, body } = response === null ? { status: 404, body: {} }
      : 'status' in response && 'body' in response ? response : { status: 200, body: response };
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** @param {import('@playwright/test').Page} page */
async function settle(page, heading) {
  if (heading) await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"], .animate-pulse')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => globalThis.document.fonts.ready);
}

const variants = SCREENS.flatMap((screen) => [
  { ...screen, viewport: screen.viewport ?? DESKTOP, scheme: /** @type {const} */ ('light'), suffix: 'desktop' },
  ...(screen.mobile ? [{ ...screen, viewport: MOBILE, scheme: /** @type {const} */ ('light'), suffix: 'mobile' }] : []),
  ...(screen.dark ? [{ ...screen, viewport: DESKTOP, scheme: /** @type {const} */ ('dark'), suffix: 'desktop-dark' }] : []),
]);

for (const variant of variants) {
  test(`${variant.name} ${variant.suffix}`, async ({ page }) => {
    const unmocked = [];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((theme) => globalThis.localStorage.setItem('aspen-theme', theme), variant.scheme);
    await page.setViewportSize(variant.viewport);
    await install(page, unmocked);
    await page.goto(`/#${variant.route}`);
    await settle(page, variant.heading);
    await expect(page).toHaveScreenshot(`${variant.name}-${variant.suffix}.png`, { fullPage: true });
    expect(unmocked, 'toda chamada GET da tela precisa de fixture').toEqual([]);
  });
}
