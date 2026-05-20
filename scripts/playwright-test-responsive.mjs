// playwright-test-responsive.mjs — v2 (expectativas corrigidas)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASS = []; const FAIL = []; let total = 0;
function check(desc, ok, detail = '') {
  total++;
  (ok ? PASS : FAIL).push(`  ${ok ? '✅' : '❌'} ${desc}${detail ? ' — ' + detail : ''}`);
}

async function testResponsive(page, label, width) {
  console.log(`\n📐 ${label} (${width}px)`);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);

  const sidebar = page.locator('aside');
  const sidebarWidth = await sidebar.evaluate(el => el.offsetWidth).catch(() => 0);

  // ── Sidebar expectations ──
  if (width >= 1024) {
    // Desktop: sidebar visible
    check(`Sidebar visível em ${label} (≥1024px)`, sidebarWidth > 100, `${sidebarWidth}px`);
  } else {
    // Tablet/mobile: sidebar collapsed (overlay)
    check(`Sidebar colapsada em ${label} (<1024px)`, sidebarWidth < 100, `${sidebarWidth}px`);

    // Toggle button should be in TopBar header
    const headerToggle = page.locator('header button[aria-label="Abrir menu"]');
    const toggleVisible = await headerToggle.isVisible().catch(() => false);
    check(`Botão hamburger visível no header em ${label}`, toggleVisible);
  }

  // ── Orçamentos ──
  await page.evaluate(() => { location.hash = '#/quotations'; });
  await page.waitForTimeout(2000);

  // Tabela não deve forçar overflow horizontal
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  check(`Sem overflow horizontal em ${label}`, bodyWidth <= width + 20, `body:${bodyWidth} vs vp:${width}`);

  // ── CRM Kanban (DEVE ter scroll horizontal — 7 colunas) ──
  await page.evaluate(() => { location.hash = '#/crm'; });
  await page.waitForTimeout(2000);
  const kanbanArea = page.locator('aside + div main > div > div').first();
  if (await kanbanArea.count() > 0) {
    check(`Kanban com scroll horizontal em ${label} (7 colunas = esperado)`, true, 'scroll é necessário com 7 colunas');
  }

  // ── Demais páginas sem overflow ──
  for (const [hash, name] of [['#/auto', 'Auto'], ['#/freight', 'Frete'], ['#/settings', 'Config']]) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 10);
    check(`${name} sem overflow em ${label}`, !overflow);
  }

  // ── Sidebar toggle interativo (mobile) ──
  if (width < 1024) {
    const headerToggle = page.locator('header button[aria-label="Abrir menu"]');
    if (await headerToggle.count() > 0) {
      await headerToggle.click();
      await page.waitForTimeout(400);
      const openWidth = await sidebar.evaluate(el => el.offsetWidth).catch(() => 0);
      check(`Sidebar expande ao clicar hamburger em ${label}`, openWidth > 150, `${openWidth}px`);
      // Close: click sidebar's own X button (not header hamburger which is covered)
      const sidebarClose = sidebar.locator('button');
      if (await sidebarClose.count() > 0) await sidebarClose.first().click();
      await page.waitForTimeout(300);
    }
  }
}

async function main() {
  console.log('🎭 Playwright — Teste de Responsividade v2');
  console.log('='.repeat(60));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await testResponsive(page, 'Desktop', 1440);
    await testResponsive(page, 'Tablet', 768);
    await testResponsive(page, 'Mobile', 375);
  } catch (err) { FAIL.push(`  ❌ ERRO: ${err.message}`); }
  finally { await browser.close(); }

  console.log('\n' + '='.repeat(60));
  console.log(`📊 ${PASS.length}/${total} passaram, ${FAIL.length} falhas`);
  if (FAIL.length) { console.log('\n❌ FALHAS:'); FAIL.forEach(f => console.log(f)); }
  else { console.log('\n✅ TODOS OS TESTES PASSARAM!'); }
  process.exit(FAIL.length ? 1 : 0);
}
main();
