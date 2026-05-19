// Quick smoke test: freight page with better diagnostics
import { chromium } from 'playwright';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.evaluate(() => { location.hash = '#/freight'; });
  await page.waitForTimeout(1000);

  // Fill CEP Origem
  await page.fill('input[aria-label="CEP de origem"]', '01001000');
  await page.click('button:has-text("Buscar CEP Origem")');
  await page.waitForTimeout(2000);

  // Fill CEP Destino
  await page.fill('input[aria-label="CEP de destino"]', '20040002');
  await page.click('button:has-text("Buscar CEP Destino")');
  await page.waitForTimeout(2000);

  // Set seguro
  await page.fill('input[aria-label="Valor declarado para seguro da carga"]', '500');

  // Check console for errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[browser]', msg.text());
  });

  // Submit
  await page.click('button:has-text("Cotar Frete")');
  console.log('[test] Submitted, waiting...');

  // Wait for results OR error
  let state = 'loading';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const hasResults = await page.locator('h2:has-text("Transportadoras disponíveis")').count();
    const hasError = await page.locator('text=Erro ao cotar frete').count();
    if (hasResults > 0) { state = 'results'; break; }
    if (hasError > 0) { state = 'error'; break; }
  }
  console.log(`[test] Final state: ${state}`);

  if (state === 'error') {
    const errText = await page.locator('.bg-red-50').textContent();
    console.log(`[test] Error message: ${errText}`);
  }

  if (state === 'results') {
    // Check the COUNT of tables — form should NOT have a thead with Transportadora
    const allThs = await page.locator('thead th').all();
    const tableCount = await page.locator('table').count();
    console.log(`[test] Tables on page: ${tableCount}`);

    for (let t = 0; t < tableCount; t++) {
      const ths = await page.locator('table').nth(t).locator('th').allTextContents();
      console.log(`[test] Table ${t} headers: ${JSON.stringify(ths)}`);
    }

    // Check no "Selecionar" button
    const selectBtns = await page.locator('button:has-text("Selecionar")').count();
    console.log(`[test] Selecionar buttons: ${selectBtns} — ${selectBtns === 0 ? '✅' : '❌'}`);

    // Check seguro visible
    const seguroCount = await page.locator('text=Seguro declarado').count();
    console.log(`[test] Seguro declarado: ${seguroCount > 0 ? '✅' : '❌'} (count=${seguroCount})`);

    // Take screenshot
    await page.screenshot({ path: '/tmp/freight-test.png', fullPage: true });
    console.log('[test] Screenshot saved: /tmp/freight-test.png');
  }

} catch (e) {
  console.error('[test] Error:', e.message);
} finally {
  await browser.close();
}
