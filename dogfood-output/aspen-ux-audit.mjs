import { chromium } from 'playwright';
import fs from 'fs/promises';

const BASE = process.env.BASE || 'http://localhost:8888';
const OUT = '/opt/data/aspen-orcamento/dogfood-output';
const pages = [
  { route: '/quotations', name: 'quotations' },
  { route: '/auto', name: 'auto' },
  { route: '/freight', name: 'freight' },
  { route: '/crm', name: 'crm' },
  { route: '/products', name: 'products' },
  { route: '/leads', name: 'leads' },
  { route: '/settings', name: 'settings' },
];

async function ensureDirs() { await fs.mkdir(`${OUT}/screenshots`, { recursive: true }); }
function truncate(s, n = 240) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, n); }

async function pageStats(page) {
  return await page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const labels = [...document.querySelectorAll('label')].filter(visible).length;
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter(visible).length;
    const buttons = [...document.querySelectorAll('button, a[href]')].filter(visible).length;
    const tables = [...document.querySelectorAll('table')].filter(visible).length;
    const h1 = document.querySelector('header h1')?.textContent?.trim() || '';
    const headings = [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(h => h.textContent.trim()).slice(0, 8);
    const horizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    const main = document.querySelector('main');
    const mainOverflowX = main ? main.scrollWidth > main.clientWidth + 2 : false;
    const unlabeledInputs = [...document.querySelectorAll('input, textarea, select')].filter(visible).filter(el => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.placeholder) return false;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
      return true;
    }).map(el => ({ tag: el.tagName, type: el.getAttribute('type'), id: el.id, name: el.getAttribute('name') })).slice(0, 10);
    const smallButtons = [...document.querySelectorAll('button')].filter(visible).filter(el => { const r = el.getBoundingClientRect(); return r.width < 36 || r.height < 32; }).map(el => ({ text: el.textContent.trim(), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), aria: el.getAttribute('aria-label') })).slice(0, 20);
    return { h1, headings, labels, inputs, buttons, tables, horizontalOverflow, mainOverflowX, unlabeledInputs, smallButtons };
  });
}

async function auditRoute(browser, viewport, routeInfo) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleMessages = [];
  const failedRequests = [];
  page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) consoleMessages.push({ type: msg.type(), text: msg.text() }); });
  page.on('requestfailed', req => failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }));
  await page.goto(`${BASE}/#${routeInfo.route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const stats = await pageStats(page);
  const shot = `${OUT}/screenshots/${routeInfo.name}-${viewport.width}.png`;
  await page.screenshot({ path: shot, fullPage: true });
  const text = truncate(await page.textContent('body'), 600);
  await context.close();
  return { route: routeInfo.route, name: routeInfo.name, viewport, stats, consoleMessages, failedRequests, screenshot: shot, text };
}

async function interactionAudit(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const events = [];
  page.on('console', msg => { if (['error','warning'].includes(msg.type())) events.push({ kind: 'console', type: msg.type(), text: msg.text() }); });
  page.on('requestfailed', req => events.push({ kind: 'requestfailed', url: req.url(), failure: req.failure()?.errorText }));
  const checks = [];
  const check = async (name, fn) => { try { checks.push({ name, ok: await fn() }); } catch (e) { checks.push({ name, ok: false, error: e.message }); } };

  await page.goto(`${BASE}/#/quotations`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
  await check('quotations row opens detail', async () => { const row = page.locator('table tbody tr').first(); if (await row.count() === 0) return false; await row.click(); await page.waitForTimeout(1200); return (await page.locator('text=Voltar para lista').count()) > 0 && (await page.locator('button:has-text("Editar")').count()) > 0; });
  await check('quotation edit exposes editable inputs', async () => { await page.locator('button:has-text("Editar")').first().click(); await page.waitForTimeout(500); return (await page.locator('input').count()) > 3 && (await page.locator('button:has-text("Cancelar")').count()) > 0; });
  await page.locator('button:has-text("Cancelar")').first().click().catch(() => {});

  await page.goto(`${BASE}/#/products`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
  await check('products row opens detail', async () => { const row = page.locator('table tbody tr').first(); if (await row.count() === 0) return false; await row.click(); await page.waitForTimeout(1200); return (await page.locator('button:has-text("Editar preços")').count()) > 0; });
  await check('product pricing edit cancel works', async () => { await page.locator('button:has-text("Editar preços")').click(); await page.waitForTimeout(300); const inputs = await page.locator('input[type="number"]').count(); await page.locator('button:has-text("Cancelar")').click(); await page.waitForTimeout(300); return inputs === 5 && (await page.locator('input[type="number"]').count()) === 0; });

  await page.goto(`${BASE}/#/auto`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1000);
  await check('auto page supports basic text entry', async () => { const ta = page.locator('textarea').first(); if (await ta.count() === 0) return false; await ta.fill('Cliente teste quer 50 lenços com urgência.'); return (await ta.inputValue()).includes('50 lenços'); });

  await page.goto(`${BASE}/#/freight`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1000);
  await check('freight has primary quote button and package controls', async () => (await page.locator('button:has-text("Cotar Frete")').count()) > 0 && (await page.locator('button:has-text("Adicionar Pacote")').count()) > 0);

  await page.goto(`${BASE}/#/crm`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
  await check('crm shows all seven stages', async () => { const body = await page.textContent('body'); return ['Novo Lead','Contato Feito','Orcamento Enviado','Em Negociacao','Arte Aprovada','Pedido Fechado','Perdido'].every(s => body.includes(s)); });

  const shot = `${OUT}/screenshots/interaction-final.png`;
  await page.screenshot({ path: shot, fullPage: true });
  await context.close();
  return { checks, events, screenshot: shot };
}

await ensureDirs();
const browser = await chromium.launch({ headless: true });
const results = [];
for (const vp of [{ width: 1440, height: 900 }, { width: 375, height: 800 }]) for (const p of pages) results.push(await auditRoute(browser, vp, p));
const interactions = await interactionAudit(browser);
await browser.close();
const report = { base: BASE, generatedAt: new Date().toISOString(), results, interactions };
await fs.writeFile(`${OUT}/ux-audit-raw.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
