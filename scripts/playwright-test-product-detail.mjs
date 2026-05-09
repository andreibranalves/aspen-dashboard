// E2E test: Product detail page — list → detail → edit pricing → save/cancel
import { chromium } from 'playwright';

const BASE = 'http://localhost:8888';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let passed = 0;
  let failed = 0;
  const assert = (cond, msg) => {
    if (cond) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.error(`  ❌ ${msg}`); }
  };

  // ── Mock API routes ──
  await page.route('**/api/products?**', (route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/pricing')) {
      // Product list
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { sku: 'LNC-SED-70', nome: 'Lenço Sublimado 70x70', categoria: 'Lenços', unidade: 'und' },
            { sku: 'CHP-PAN', nome: 'Chapéu Panamá', categoria: 'Chapéus', unidade: 'und' },
          ],
          pagination: { page: 1, limit: 50, total: 2, total_pages: 1 },
        }),
      });
    } else {
      route.continue();
    }
  });

  // Product detail mock
  await page.route('**/api/products/LNC-SED-70?sku=LNC-SED-70', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        produto: {
          sku: 'LNC-SED-70',
          nome: 'Lenço Sublimado 70x70',
          categoria: 'Lenços',
          unidade: 'und',
          ativo: true,
          imagem: null,
          descricao: '<p>Lenço sublimado de alta qualidade, 70x70cm.</p>',
          marca: 'Aspen',
          modificado_em: '2026-05-09T18:00:00',
        },
        precos: [
          { faixa: 30, rate: 8.50 },
          { faixa: 100, rate: 7.20 },
          { faixa: 300, rate: 6.10 },
          { faixa: 500, rate: 5.40 },
          { faixa: 1000, rate: 4.80 },
        ],
      }),
    });
  });

  // Pricing update mock
  await page.route('**/api/products/LNC-SED-70/pricing', (route) => {
    if (route.request().method() === 'PUT') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sku: 'LNC-SED-70',
          atualizados: 5,
          erros: 0,
          resultados: [
            { faixa: 30, rate: 9.00, status: 'atualizado', rule_name: 'rule1' },
            { faixa: 100, rate: 7.20, status: 'atualizado', rule_name: 'rule2' },
            { faixa: 300, rate: 6.10, status: 'atualizado', rule_name: 'rule3' },
            { faixa: 500, rate: 5.40, status: 'atualizado', rule_name: 'rule4' },
            { faixa: 1000, rate: 4.80, status: 'atualizado', rule_name: 'rule5' },
          ],
        }),
      });
    } else {
      route.continue();
    }
  });

  try {
    // ── 1. Navigate to products list ──
    console.log('\n📋 Products list');
    await page.goto(BASE + '/#/products', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Should show products table
    const rows = await page.locator('table tbody tr').count();
    assert(rows >= 2, `Products table has ${rows} rows (expected >= 2)`);

    // Should show SKU
    const firstSku = await page.locator('table tbody tr').first().textContent();
    assert(firstSku.includes('LNC-SED-70'), `First row contains LNC-SED-70 (got: "${firstSku}")`);

    // Rows should have cursor-pointer
    const firstRowClass = await page.locator('table tbody tr').first().getAttribute('class');
    assert(firstRowClass?.includes('cursor-pointer'), 'Row has cursor-pointer class');

    // ── 2. Click product row → navigate to detail ──
    console.log('\n🔍 Product detail');
    await page.locator('table tbody tr').first().click();
    await page.waitForTimeout(500);

    // Should be on product detail page
    const hash = await page.evaluate(() => window.location.hash);
    assert(hash === '#/products/LNC-SED-70', `Hash is #/products/LNC-SED-70 (got: ${hash})`);

    // Should show product name
    const heading = await page.locator('h2').first().textContent();
    assert(heading.includes('Lenço Sublimado'), `Heading shows product name (got: "${heading}")`);

    // Should show SKU
    const pageContent = await page.locator('.font-mono').first().textContent();
    assert(pageContent.includes('LNC-SED-70'), `Page shows SKU (got: "${pageContent}")`);

    // Should show breadcrumb
    const breadcrumb = await page.locator('button:has-text("Voltar para produtos")').count();
    assert(breadcrumb > 0, 'Breadcrumb "Voltar para produtos" is visible');

    // ── 3. Pricing table ──
    console.log('\n💰 Pricing table');
    const pricingRows = await page.locator('table').last().locator('tbody tr').count();
    assert(pricingRows === 5, `Pricing table has 5 bracket rows (got: ${pricingRows})`);

    // Should show BRL formatted prices
    const priceText = await page.locator('table').last().textContent();
    assert(priceText.includes('8,50'), 'Table shows R$ 8,50');
    assert(priceText.includes('7,20'), 'Table shows R$ 7,20');

    // Should have "Editar preços" button
    const editBtn = await page.locator('button:has-text("Editar preços")').count();
    assert(editBtn > 0, '"Editar preços" button is visible');

    // ── 4. Enter edit mode ──
    console.log('\n✏️ Edit mode');
    await page.locator('button:has-text("Editar preços")').click();
    await page.waitForTimeout(300);

    // Should show number inputs
    const inputs = await page.locator('table').last().locator('input[type="number"]').count();
    assert(inputs === 5, `Edit mode shows 5 number inputs (got: ${inputs})`);

    // Should show Save/Cancel buttons
    const saveBtn = await page.locator('button:has-text("Salvar")').count();
    assert(saveBtn > 0, '"Salvar" button is visible in edit mode');
    const cancelBtn = await page.locator('button:has-text("Cancelar")').count();
    assert(cancelBtn > 0, '"Cancelar" button is visible in edit mode');

    // ── 5. Cancel edit ──
    console.log('\n❌ Cancel edit');
    // Change a value first
    const firstInput = await page.locator('table').last().locator('input[type="number"]').first();
    await firstInput.fill('9.99');
    await page.locator('button:has-text("Cancelar")').click();
    await page.waitForTimeout(300);

    // Should be back in view mode
    const editBtnAfterCancel = await page.locator('button:has-text("Editar preços")').count();
    assert(editBtnAfterCancel > 0, '"Editar preços" button is back after cancel');

    // Original value should be restored
    const priceTextAfterCancel = await page.locator('table').last().textContent();
    assert(priceTextAfterCancel.includes('8,50'), 'Original price R$ 8,50 is restored after cancel');

    // ── 6. Save edit ──
    console.log('\n💾 Save edit');
    await page.locator('button:has-text("Editar preços")').click();
    await page.waitForTimeout(200);

    const inputToEdit = await page.locator('table').last().locator('input[type="number"]').first();
    await inputToEdit.fill('9.00');
    await page.locator('button:has-text("Salvar")').click();
    await page.waitForTimeout(800);

    // Should show success toast
    const toast = await page.locator('text=atualizado').count();
    assert(toast > 0 || (await page.textContent('body')).includes('sucesso'), 'Success toast appears after save');

    // Should exit edit mode
    const editBtnAfterSave = await page.locator('button:has-text("Editar preços")').count();
    assert(editBtnAfterSave > 0, '"Editar preços" button is back after save');

    // ── 7. Back navigation ──
    console.log('\n⬅️ Back navigation');
    await page.locator('button:has-text("Voltar para produtos")').click();
    await page.waitForTimeout(300);

    const hashAfterBack = await page.evaluate(() => window.location.hash);
    assert(hashAfterBack === '#/products', `Back navigates to #/products (got: ${hashAfterBack})`);

    // ── 8. Responsive: mobile layout ──
    console.log('\n📱 Mobile layout');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(BASE + '/#/products/LNC-SED-70', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Content should be visible (stacked, not column layout)
    const mobileContent = await page.locator('h2').first().textContent();
    assert(mobileContent.includes('Lenço Sublimado'), 'Mobile view shows product name');

    // Breadcrumb should be visible on mobile too
    const mobileBreadcrumb = await page.locator('button:has-text("Voltar para produtos")').count();
    assert(mobileBreadcrumb > 0, 'Breadcrumb visible on mobile');

  } catch (err) {
    console.error(`\n  ❌ UNCAUGHT ERROR: ${err.message}`);
    failed++;
  } finally {
    console.log(`\n${'='.repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
