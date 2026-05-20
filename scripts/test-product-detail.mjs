// test-product-detail.mjs
// Playwright E2E para ProductDetailPage + pricing table + edit mode
// Roda contra Vercel Dev em http://localhost:3000

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASS = [];
const FAIL = [];
let total = 0;

function check(desc, ok, detail = '') {
  total++;
  if (ok) {
    PASS.push(`  ✅ ${desc}`);
  } else {
    FAIL.push(`  ❌ ${desc}${detail ? ' — ' + detail : ''}`);
  }
}

async function testProductDetail(page) {
  console.log('\n🔍 ── Detalhe de Produto ──');

  // ── Step 1: Navigate to Products list ──
  await page.evaluate(() => { location.hash = '#/products'; });
  await page.waitForTimeout(1500);

  const title = await page.textContent('header h1');
  check('TopBar mostra página de produtos', title && title.length > 0, `título: "${title}"`);

  // Wait for table rows
  await page.waitForTimeout(1000);
  const rows = await page.locator('table tbody tr').count();
  check('Tabela de produtos tem linhas', rows > 0, `${rows} linha(s)`);

  if (rows === 0) {
    console.log('  ⚠️ Sem produtos para testar — pulando teste de detalhe');
    return;
  }

  // Get the SKU from the first row
  const firstSku = await page.locator('table tbody tr').first().locator('td').first().textContent();
  check('Primeira linha tem SKU', firstSku && firstSku.trim().length > 0, `SKU: "${firstSku}"`);
  if (!firstSku) return;

  // ── Step 2: Click on product row ──
  const rowCursor = await page.locator('table tbody tr').first().evaluate(el => window.getComputedStyle(el).cursor);
  check('Linha de produto tem cursor pointer', rowCursor === 'pointer', `cursor: ${rowCursor}`);

  await page.locator('table tbody tr').first().click();
  await page.locator('button:has-text("Editar preços")').waitFor({ timeout: 20000 });

  // ── Step 3: Verify detail page loaded ──
  const backButton = await page.locator('button[aria-label="Voltar para produtos"], button:has-text("Voltar")').count();
  check('Botão de voltar visível', backButton > 0);

  // Should show SKU label
  const skuLabel = await page.locator('text=SKU:').count();
  check('Label "SKU:" visível no detalhe', skuLabel > 0);

  // Should show product name
  const h1Count = await page.locator('h1').count();
  if (h1Count > 0) {
    const productName = await page.locator('h1').first().textContent();
    check('Nome do produto renderizado', productName && productName.length > 0, `nome: "${productName}"`);
  } else {
    check('Nome do produto renderizado', false, 'nenhum h1 encontrado');
  }

  // ── Step 4: Check pricing table ──
  const pricingHeader = await page.locator('h2:has-text("Tabela de preços")').count();
  check('Seção "Tabela de preços" existe', pricingHeader > 0);

  // Find pricing rows using broader locator — look for tbody inside any table
  const allTables = await page.locator('table').count();
  check('Pelo menos uma tabela renderizada', allTables > 0);

  // Count pricing rows by looking for rows with "un." text (the faixa label)
  const faixaRows = await page.locator('td:has-text("un.")').count();
  check('Tabela de preços tem faixas visíveis', faixaRows === 5, `${faixaRows} faixa(s)`);

  // Check origin badges and urgent visual state
  const originBadges = await page.locator('text=/Pricing Rule|Item Price|Não encontrado/').count();
  check('Origem do preço visível em cada faixa', originBadges >= 5, `${originBadges} badge(s)`);

  const urgentBadges = await page.locator('text=urgente').count();
  const missingBadges = await page.locator('text=sem preço').count();
  check('Validação visual mostra urgente ou sem preço', urgentBadges + missingBadges >= 5, `${urgentBadges} urgente, ${missingBadges} sem preço`);

  // Check edit button exists
  const editBtn = await page.locator('button:has-text("Editar preços")').count();
  check('Botão "Editar preços" visível', editBtn > 0);

  // ── Step 5: Enter edit mode ──
  await page.locator('button:has-text("Editar preços")').click();
  await page.waitForTimeout(300);

  // Should see number inputs
  const inputs = await page.locator('input[type="number"]').count();
  check('Inputs de preço aparecem no modo edição', inputs === 5, `${inputs} input(s)`);

  // Should see Save/Cancel buttons
  const saveBtn = await page.locator('button:has-text("Salvar")').count();
  check('Botão "Salvar" visível no modo edição', saveBtn > 0);

  const cancelBtn = await page.locator('button:has-text("Cancelar")').count();
  check('Botão "Cancelar" visível no modo edição', cancelBtn > 0);

  // ── Step 6: Cancel edit ──
  await page.locator('button:has-text("Cancelar")').click();
  await page.waitForTimeout(300);

  // Inputs should be gone
  const inputsAfterCancel = await page.locator('input[type="number"]').count();
  check('Inputs desaparecem após cancelar', inputsAfterCancel === 0, `${inputsAfterCancel} input(s)`);

  // Edit button should be back
  const editBtnAfterCancel = await page.locator('button:has-text("Editar preços")').count();
  check('Botão "Editar preços" reaparece após cancelar', editBtnAfterCancel > 0);

  // ── Step 7: Navigate back ──
  const voltarButtons = await page.locator('button[aria-label="Voltar para produtos"], button:has-text("Voltar")').all();
  await voltarButtons[0].click();
  await page.waitForTimeout(500);

  const backHasRows = await page.locator('table tbody tr').count();
  check('Navegação de volta para lista de produtos', backHasRows > 0, `${backHasRows} linha(s) na tabela`);

  // ── Step 8: Test 404 for non-existent SKU ──
  await page.evaluate(() => { location.hash = '#/products/SKU-INEXISTENTE-999'; });
  await page.waitForTimeout(1500);

  const notFoundMsg = await page.locator('text=Produto não encontrado').count();
  if (notFoundMsg > 0) {
    check('Mensagem "Produto não encontrado" para SKU inválido', true);

    const voltarBtn = await page.locator('button[aria-label="Voltar para produtos"], button:has-text("Voltar")').count();
    check('Botão de voltar disponível na página 404', voltarBtn > 0);
  } else {
    // Maybe still loading? Check for any error state
    const pageContent = await page.textContent('body');
    check('404 tratado (mensagem ou erro visível)',
      pageContent.includes('não encontrado') || pageContent.includes('Erro'),
      `body excerpt: "${pageContent.substring(0, 100)}"`);
  }
}

// ── Main ──
(async () => {
  console.log('🧪 Teste E2E: Product Detail Page');
  console.log('='.repeat(50));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    await testProductDetail(page);
  } catch (err) {
    console.error('❌ Erro no teste:', err.message);
    check('Execução sem erro fatal', false, err.message);
  } finally {
    await browser.close();
  }

  // ── Report ──
  console.log('\n' + '='.repeat(50));
  if (PASS.length) console.log('\n✅ PASSES:');
  for (const p of PASS) console.log(p);
  if (FAIL.length) console.log('\n❌ FAILS:');
  for (const f of FAIL) console.log(f);
  console.log(`\n📊 Resultado: ${PASS.length}/${total} passaram${FAIL.length ? `, ${FAIL.length} falharam` : ''}`);

  process.exit(FAIL.length ? 1 : 0);
})();
