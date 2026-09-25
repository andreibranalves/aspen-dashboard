// @ts-check
import { expect, test } from '@playwright/test';
import { conversations, respond, respondReadOnlyPost } from './fixtures.js';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TALL = { width: 1440, height: 1600 };

const SCREENS = [
  { name: 'atendimento', route: '/atendimento', heading: 'Atendimento', mobile: true },
  // Abrir a conversa marca como lida (PATCH simulado em `writes`).
  { name: 'atendimento-conversa', route: '/atendimento?conversationId=c1000000-0000-4000-8000-000000000001', mobile: true, writes: { 'PATCH /api/whatsapp-conversations': { conversation: { ...conversations.items[0], unreadCount: 0, readRevision: 1 } } } },
  { name: 'clientes', route: '/leads', heading: 'Clientes', mobile: true },
  { name: 'orcamentos', route: '/quotations', heading: 'Orçamentos', mobile: true, dark: true },
  { name: 'pedidos', route: '/sales-orders', heading: 'Pedidos', mobile: true },
  { name: 'produtos', route: '/products', heading: 'Produtos', mobile: true },
  { name: 'painel', route: '/dashboard', mobile: true },
  { name: 'crm', route: '/crm', mobile: true },
  { name: 'negocios', route: '/crm?tab=deals', heading: 'Comercial', mobile: true },
  { name: 'orcamento-detalhe', route: '/quotations/ORC-20260101', viewport: TALL, mobile: true },
  { name: 'novo-orcamento', route: '/novo-orcamento', viewport: TALL, mobile: true },
  { name: 'novo-orcamento-manual', route: '/manual', heading: 'Novo orçamento', viewport: TALL, mobile: true },
  {
    name: 'novo-orcamento-resultado',
    route: '/novo-orcamento',
    heading: 'Novo orçamento',
    viewport: TALL,
    mobile: true,
    region: 'Resultado da conversa',
    // Rascunho já extraído: o card de resultado com itens.
    session: {
      aspen_drafts: JSON.stringify({
        version: 1,
        drafts: [{
          index: 0,
          original: {},
          approved: false,
          discarded: false,
          edited: {
            nome: 'Confecções Horizonte Ltda',
            email: 'compras@horizonte.example',
            telefone: '11999990001',
            origem: 'WhatsApp',
            cnpj: '',
            endereco: {},
            items: [
              { item_code: 'CAN-100', item_name: 'Canga estampada 100x160', qty: 100, rate: 9.5 },
              { item_code: 'LEN-040', item_name: 'Lenço de seda 40x40', qty: 30, rate: 10 },
            ],
          },
        }],
      }),
    },
  },
];

/** @param {import('@playwright/test').Page} page */
async function install(page, unmocked, writes = {}) {
  await page.clock.setFixedTime(new Date('2026-09-15T12:00:00-03:00'));
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const url = new globalThis.URL(route.request().url());
    // Consultas POST só de leitura também têm fixture; escritas nunca.
    const response = route.request().method() === 'GET' ? respond(url)
      : `${route.request().method()} ${url.pathname}` in writes ? writes[`${route.request().method()} ${url.pathname}`]
      : route.request().method() === 'POST' ? respondReadOnlyPost(url) : null;
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
    if (variant.session) {
      await page.addInitScript((entries) => {
        for (const [key, value] of Object.entries(entries)) globalThis.sessionStorage.setItem(key, value);
      }, variant.session);
    }
    await page.setViewportSize(variant.viewport);
    await install(page, unmocked, variant.writes);
    await page.goto(`/#${variant.route}`);
    await settle(page, variant.heading);
    const target = variant.region ? page.getByRole('region', { name: variant.region }) : page;
    await expect(target).toHaveScreenshot(`${variant.name}-${variant.suffix}.png`, variant.region ? {} : { fullPage: true });
    expect(unmocked, 'toda chamada GET da tela precisa de fixture').toEqual([]);
  });
}
