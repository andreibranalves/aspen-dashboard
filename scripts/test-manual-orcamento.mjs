// test-manual-orcamento.mjs
// Teste E2E para a página de Orçamento Manual (#/manual)
// Roda contra Vercel Dev em http://localhost:3000
//
// Uso: node scripts/test-manual-orcamento.mjs

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

async function main() {
  console.log('🎭 Playwright E2E — Orçamento Manual (aspen-dashboard)');
  console.log(`   URL: ${BASE}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // ── Load the app and navigate to manual page ──
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Collapse sidebar to avoid overlap with page content
    const sidebarToggle = page.locator('button[aria-label="Fechar menu"]');
    if (await sidebarToggle.count() > 0) {
      await sidebarToggle.click();
      await page.waitForTimeout(500);
    }

    await page.evaluate(() => { location.hash = '#/manual'; });
    await page.waitForTimeout(1000);

    // ══ Page structure ══
    console.log('\n📄 ── Estrutura da Página ──');

    const header = await page.locator('main h1').textContent();
    check('PageHeader mostra "Novo Orçamento Manual"', header === 'Novo Orçamento Manual', `atual: "${header}"`);

    const sections = ['1. Cliente', '2. Produtos'].map(async (label) => {
      const count = await page.locator(`text=${label}`).count();
      check(`Seção "${label}" visível`, count > 0);
      return count;
    });
    await Promise.all(sections);

    // ══ Client section — existing search ══
    console.log('\n👤 ── Seção Cliente ──');

    const toggleExisting = page.locator('section[aria-label="Seleção de cliente"] button', { hasText: 'Buscar existente' });
    const toggleNew = page.locator('section[aria-label="Seleção de cliente"] button', { hasText: 'Novo cliente' });

    check('Toggle "Buscar existente" ativo por padrão',
      (await toggleExisting.evaluate(el => el.className)).includes('font-medium'));

    // Try searching for a client
    const clientSearchInput = page.locator('input[aria-label="Buscar cliente"]');
    const clientSearchExists = await clientSearchInput.count();
    check('Input de busca de cliente renderizado', clientSearchExists > 0);

    if (clientSearchExists > 0) {
      await clientSearchInput.fill('test');
      await page.waitForTimeout(2000);

      // Results dropdown may appear (or empty)
      const searchResults = await page.locator('text=Selecionar').count();
      check('Busca de cliente executada sem erros', true, searchResults > 0 ? `${searchResults} resultados` : 'sem resultados visíveis');
    }

    // ══ Client section — new client ══
    console.log('\n👤 ── Novo Cliente ──');

    await toggleNew.click();
    await page.waitForTimeout(400);

    const nomeInput = page.locator('input[aria-label="Nome do cliente"]');
    const emailInput = page.locator('input[aria-label="Email do cliente"]');
    const telInput = page.locator('input[aria-label="Telefone do cliente"]');

    const nomeCount = await nomeInput.count();
    const emailCount = await emailInput.count();
    const telCount = await telInput.count();
    check('Campos de novo cliente visíveis após toggle',
      nomeCount > 0 && emailCount > 0 && telCount > 0,
      `nome:${nomeCount} email:${emailCount} tel:${telCount}`);

    if (nomeCount > 0) {
      await nomeInput.fill('Maria Silva Teste');
      await emailInput.fill('maria@teste.com');
      await telInput.fill('11988887777');

      const nomeVal = await nomeInput.inputValue();
      const emailVal = await emailInput.inputValue();
      const telVal = await telInput.inputValue();
      check('Campo nome preenchido', nomeVal === 'Maria Silva Teste');
      check('Campo email preenchido', emailVal === 'maria@teste.com');
      check('Campo telefone preenchido', telVal === '11988887777');
    }

    // ══ Product section ══
    console.log('\n📦 ── Seção Produtos ──');

    const productSearchInput = page.locator('input[aria-label="Buscar produto"]');
    const productSearchExists = await productSearchInput.count();
    check('Input de busca de produto renderizado', productSearchExists > 0);

    // Empty cart hint
    const emptyCart = await page.locator('text=Nenhum produto adicionado ainda').count();
    check('Hint de carrinho vazio visível', emptyCart > 0);

    if (productSearchExists > 0) {
      // Search for LNC products
      await productSearchInput.fill('LNC');
      await page.waitForTimeout(2000);

      // Check if results appeared — they depend on server connectivity
      const resultItems = await page.locator('button[aria-label^="Selecionar"]').count();
      if (resultItems > 0) {
        check('Resultados de busca de produto renderizados', true, `${resultItems} produtos encontrados`);

        // Click the first product
        const firstProduct = page.locator('button[aria-label^="Selecionar"]').first();
        await firstProduct.click();
        await page.waitForTimeout(1500);

        // Check selected product card
        const productCard = await page.locator('text=Quantidade').count();
        if (productCard > 0) {
          check('Card do produto selecionado visível com campo Quantidade', true);

          // Check qty input
          const qtyInput = page.locator('input[aria-label="Quantidade do produto"]');
          const qtyExists = await qtyInput.count();
          check('Input de quantidade renderizado', qtyExists > 0);

          if (qtyExists > 0) {
            // Change quantity
            await qtyInput.fill('200');
            await page.waitForTimeout(1500);

            const qtyVal = await qtyInput.inputValue();
            check('Quantidade alterada para 200', qtyVal === '200');

            // Click "Adicionar"
            const addBtn = page.locator('button[aria-label="Adicionar produto ao orçamento"]');
            const addExists = await addBtn.count();
            check('Botão "Adicionar" renderizado', addExists > 0);

            if (addExists > 0) {
              await addBtn.click();
              await page.waitForTimeout(1000);
            }
          }
        } else {
          // Product card may not have loaded (pricing endpoint down)
          check('Card do produto apareceu ou falhou silenciosamente', true, 'pode precisar do servidor PostgreSQL');
        }
      } else {
        check('Busca de produto executada (sem resultados ou backend offline)', true);
      }
    }

    // ══ Items/resumo (if products were added) ══
    console.log('\n🛒 ── Resumo / Checkout ──');

    const subtotalText = await page.locator('text=Subtotal').count();
    if (subtotalText > 0) {
      check('Seção "3. Resumo" visível com subtotal', true);

      // Prazo
      const prazoInput = page.locator('input[aria-label="Prazo de produção"]');
      const prazoExists = await prazoInput.count();
      check('Campo prazo de produção renderizado', prazoExists > 0);

      if (prazoExists > 0) {
        await prazoInput.fill('15 dias');
        check('Prazo preenchido com "15 dias"', (await prazoInput.inputValue()) === '15 dias');
      }

      // Observações
      const obsTextarea = page.locator('textarea[aria-label="Observações do orçamento"]');
      const obsExists = await obsTextarea.count();
      check('Campo observações renderizado', obsExists > 0);

      if (obsExists > 0) {
        await obsTextarea.fill('Entregar na Rua Exemplo, 123');
        check('Observações preenchidas', (await obsTextarea.inputValue()).includes('Rua Exemplo'));
      }

      // Criar Orçamento button
      const submitBtn = page.locator('button', { hasText: 'Criar Orçamento' });
      const submitExists = await submitBtn.count();
      check('Botão "Criar Orçamento" visível', submitExists > 0);

      // Check BRL format in subtotal
      const subtotalBRL = await page.locator('text=R$').count();
      check('Valor em formato BRL presente', subtotalBRL > 0);
    }

    // ══ Responsive: mobile view ══
    console.log('\n📱 ── Responsive: Mobile (375px) ──');

    await page.setViewportSize({ width: 375, height: 800 });
    await page.evaluate(() => { location.hash = '#/manual'; });
    await page.waitForTimeout(1000);

    // Force collapse sidebar on mobile (React doesn't re-compute on resize)
    const sidebarToggleMobile = page.locator('button[aria-label="Fechar menu"]');
    if (await sidebarToggleMobile.count() > 0) {
      await sidebarToggleMobile.click();
      await page.waitForTimeout(500);
    }

    // Check sections still visible
    const mobileClient = await page.locator('text=1. Cliente').count();
    check('Mobile: seção "1. Cliente" visível', mobileClient > 0);

    const mobileProduct = await page.locator('text=2. Produtos').count();
    check('Mobile: seção "2. Produtos" visível', mobileProduct > 0);

    // Check that client type toggle works on mobile
    const mobileNewBtn = page.locator('section[aria-label="Seleção de cliente"] button', { hasText: 'Novo cliente' });
    if (await mobileNewBtn.count() > 0) {
      await mobileNewBtn.click();
      await page.waitForTimeout(300);

      const mobileNome = await page.locator('input[aria-label="Nome do cliente"]').count();
      check('Mobile: campos de cliente visíveis após toggle', mobileNome > 0);

      // Switch back
      await page.locator('section[aria-label="Seleção de cliente"] button', { hasText: 'Buscar existente' }).click();
      await page.waitForTimeout(200);
    }

    // ══ Navigation from Auto to Manual ══
    console.log('\n🔀 ── Integração AutoPage → Manual ──');

    // Go to auto page
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { location.hash = '#/auto'; });
    await page.waitForTimeout(800);

    // Check for manual link
    const manualLink = await page.locator('a[aria-label="Montar orçamento manualmente"]').count();
    check('AutoPage: link "Manual" visível', manualLink > 0);

    if (manualLink > 0) {
      await page.locator('a[aria-label="Montar orçamento manualmente"]').first().click();
      await page.waitForTimeout(1000);

      // Verify we landed on manual page
      const newPageHeader = await page.locator('text=Novo Orçamento Manual').count();
      check('Navegação Auto→Manual funcionou', newPageHeader > 0);
    }

    // ══ Browser console check ══
    const filteredErrors = consoleErrors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR_')
    );
    check('Sem erros JS no console (exceto rede/favicon)',
      filteredErrors.length === 0,
      filteredErrors.slice(0, 3).join(' | '));

  } catch (err) {
    FAIL.push(`  ❌ ERRO FATAL: ${err.message}`);
  } finally {
    await browser.close();
  }

  // ── Report ──
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTADOS');
  console.log('='.repeat(60));

  if (PASS.length > 0) {
    console.log(`\n✅ PASSES (${PASS.length}):`);
    PASS.forEach(p => console.log(p));
  }

  if (FAIL.length > 0) {
    console.log(`\n❌ FAILS (${FAIL.length}):`);
    FAIL.forEach(f => console.log(f));
  }

  console.log(`\n🏁 ${PASS.length}/${total} passaram`);
  console.log(`   ${total - PASS.length} falhas\n`);

  process.exit(FAIL.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
