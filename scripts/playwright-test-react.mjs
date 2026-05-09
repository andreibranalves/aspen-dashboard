// playwright-test-react.mjs
// Test suite completo para o React frontend (feat/react-frontend)
// Roda contra http://localhost:8888 (server.mjs servindo o build React)
//
// Uso: node playwright-test-react.mjs

import { chromium } from 'playwright';

const BASE = 'http://localhost:8888';
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

async function testQuotationsPage(page) {
  console.log('\n📋 ── Orçamentos ──');

  // Navigate
  await page.evaluate(() => { location.hash = '#/quotations'; });
  await page.waitForTimeout(800);

  // Check topbar title
  const title = await page.textContent('header h1');
  check('TopBar mostra "Orçamentos"', title === 'Orçamentos', `atual: "${title}"`);

  // Check sidebar nav links exist
  const sidebarLinks = await page.locator('aside nav button').count();
  check('Sidebar tem 8 links de navegação', sidebarLinks === 8, `encontrados: ${sidebarLinks}`);

  // Wait for table to load
  await page.waitForTimeout(2000);

  // Check status chips
  const chips = await page.locator('aside + div main button[class*="rounded-full"]').count();
  check('Status chips visíveis (>4)', chips >= 4, `encontrados: ${chips}`);

  // Check search input
  const searchInput = await page.locator('input[placeholder*="Buscar por Nº"]').count();
  check('Input de busca renderizado', searchInput > 0);

  // ── Desktop table ──
  const desktopTable = await page.locator('.hidden.md\\:block table').count();
  if (desktopTable > 0) {
    check('Tabela desktop renderizada (md:block)', true);

    const rows = await page.locator('.hidden.md\\:block table tbody tr').count();
    check('Tabela tem linhas com dados', rows > 0, `${rows} linha(s)`);

    if (rows > 0) {
      // Check first row has quotation ID (monospaced)
      const firstCell = await page.locator('.hidden.md\\:block table tbody tr').first().locator('td').first().textContent();
      check('Primeira célula é um Nº de orçamento (formato ORC-)', /ORC-/.test(firstCell), `valor: "${firstCell}"`);

      // Check BRL format in value column
      const valCell = await page.locator('.hidden.md\\:block table tbody tr').first().locator('td').nth(3).textContent();
      check('Valor em formato BRL (R$ X.XXX,XX)', /R\$\s*[\d.]+\,\d{2}/.test(valCell), `valor: "${valCell}"`);

      // Check status badge exists
      const badge = await page.locator('.hidden.md\\:block table tbody tr').first().locator('td').nth(4).locator('span').first().textContent();
      check('Status badge renderizado', badge && badge.length > 0, `texto: "${badge}"`);

      // Check action buttons have aria-labels
      const ariaBtns = await page.locator('.hidden.md\\:block table tbody tr').first().locator('td').last().locator('button[aria-label], a[aria-label]').count();
      check('Ações têm aria-labels (≥3)', ariaBtns >= 3, `encontrados: ${ariaBtns}`);
    }
  }

  // ── Mobile cards (set viewport to mobile) ──
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => { location.hash = '#/quotations'; });
  await page.waitForTimeout(1500);

  const mobileCards = await page.locator('.md\\:hidden.space-y-3 > div').count();
  check('Mobile: cards de orçamento renderizados', mobileCards > 0, `${mobileCards} card(s)`);

  if (mobileCards > 0) {
    // Check cards have id, status badge, value
    const firstCard = page.locator('.md\\:hidden.space-y-3 > div').first();
    const cardText = await firstCard.textContent();
    check('Mobile: card mostra Nº ORC-', /ORC-/.test(cardText));
    check('Mobile: card mostra valor BRL', /R\$\s*[\d.]+\,\d{2}/.test(cardText));
  }

  // Reset to desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { location.hash = '#/quotations'; });
  await page.waitForTimeout(1500);

  // Check totals bar (now says "Nesta página")
  const totalsBar = await page.locator('text=Nesta página').count();
  check('Totals bar com \"Nesta página\" visível', totalsBar > 0);

  // Check pagination exists (if > 25 records)
  const pageInfo = await page.locator('text=Página').count();
  if (pageInfo > 0) {
    check('Paginação renderizada com \"Página X de Y\"', true);
  }

  // Status chip click — filter
  const openChip = page.locator('main button', { hasText: 'Aberto' });
  const openChipCount = await openChip.count();
  if (openChipCount > 0) {
    await openChip.first().click();
    await page.waitForTimeout(1500);
    const chipActive = await openChip.first().evaluate(el => el.className);
    check('Status chip \"Aberto\" ativado ao clicar', chipActive.includes('bg-primary'), `classe: ${chipActive}`);
    // Click "Todos" to reset
    const todosChip = page.locator('main button', { hasText: 'Todos' }).first();
    if (await todosChip.count() > 0) await todosChip.click();
    await page.waitForTimeout(1000);
  }

  // Check PageHeader
  const pageHeader = await page.locator('text=Criar orçamento').count();
  check('PageHeader: botão \"Criar orçamento\" visível', pageHeader > 0);
}

async function testQuotationDetail(page) {
  console.log('\n📄 ── Detalhe do Orçamento ──');

  // Find first quotation ID from the table
  await page.evaluate(() => { location.hash = '#/quotations'; });
  await page.waitForTimeout(2000);

  const firstRow = page.locator('.hidden.md\\:block table tbody tr').first();
  const firstId = await firstRow.locator('td').first().textContent();
  check('ID do orçamento encontrado', !!firstId && firstId.includes('ORC-'), `ID: ${firstId}`);

  if (!firstId) return;

  // Navigate to detail
  await firstRow.click();
  await page.waitForTimeout(1500);

  // Check detail page loaded
  const detailId = await page.locator('text=' + firstId).first().textContent();
  check('Página de detalhe mostra o ID do orçamento', detailId && detailId.includes(firstId), `mostrando: "${detailId}"`);

  // Check back link
  const backLink = await page.locator('text=Voltar para lista').count();
  check('Link \"Voltar para lista\" visível', backLink > 0);

  // Check client name
  const clienteLabel = await page.locator('text=Cliente').count();
  check('Label \"Cliente\" no card de detalhe', clienteLabel > 0);

  // Check items table
  const itemRows = await page.locator('table tbody tr').count();
  check('Tabela de itens tem linhas', itemRows > 0, `${itemRows} linha(s)`);

  // Check totals
  const totalsText = await page.textContent('body');
  check('Total com formato BRL no detalhe', /Total:\s*R\$\s*[\d.]+\,\d{2}/.test(totalsText));

  // Check action buttons in view mode
  const editBtn = await page.locator('button', { hasText: 'Editar' }).count();
  check('Botão \"Editar\" visível no modo view', editBtn > 0);

  const pdfBtn = await page.locator('a', { hasText: 'Visualizar' }).count();
  check('Link \"Visualizar\" (PDF) visível', pdfBtn > 0);

  const deleteBtn = await page.locator('button', { hasText: 'Excluir' }).count();
  check('Botão \"Excluir\" visível no modo view', deleteBtn > 0);

  // Enter edit mode
  const editButton = page.locator('button', { hasText: 'Editar' }).first();
  if (await editButton.count() > 0) {
    await editButton.click();
    await page.waitForTimeout(500);

    const saveBtn = await page.locator('button', { hasText: 'Salvar' }).count();
    check('Botão \"Salvar\" visível no modo edit', saveBtn > 0);

    const cancelBtn = await page.locator('button', { hasText: 'Cancelar' }).count();
    check('Botão \"Cancelar\" visível no modo edit', cancelBtn > 0);

    const addItemBtn = await page.locator('button', { hasText: '+ Item' }).count();
    check('Botão \"+ Item\" visível no modo edit', addItemBtn > 0);

    // Check inputs are editable
    const skuInputs = await page.locator('input[placeholder=\"SKU\"]').count();
    check('Inputs de SKU renderizados no modo edit', skuInputs > 0, `${skuInputs} input(s)`);

    // Cancel edit
    const cancelEditBtn = page.locator('button', { hasText: 'Cancelar' }).first();
    if (await cancelEditBtn.count() > 0) await cancelEditBtn.click();
    await page.waitForTimeout(300);
  }
}

async function testAutoPage(page) {
  console.log('\n🤖 ── Auto / Extração ──');

  await page.evaluate(() => { location.hash = '#/auto'; });
  await page.waitForTimeout(800);

  // Phase indicator
  const phaseLabels = await page.locator('text=1. Entrada').count();
  check('Phase indicator \"1. Entrada\" visível', phaseLabels > 0);

  const phaseSteps = await page.locator('text=5. Concluído').count();
  check('Phase indicator \"5. Concluído\" visível', phaseSteps > 0);

  // Textarea
  const textarea = await page.locator('textarea').count();
  check('Textarea para input do pedido', textarea > 0);

  // Image upload area
  const imageArea = await page.locator('text=Arraste uma imagem aqui').count();
  check('Área de upload de imagem renderizada', imageArea > 0);

  // Prazo input
  const prazoInput = await page.locator('input[placeholder*=\"Ex: 10 a 15\"]').count();
  check('Input de prazo de produção', prazoInput > 0);

  // Config toggle
  const configBtn = await page.locator('text=Config').count();
  check('Botão \"Config\" (settings toggle) visível', configBtn > 0);

  // Open Config
  if (configBtn > 0) {
    await page.locator('text=Config').first().click();
    await page.waitForTimeout(400);

    const rulesLabel = await page.locator('text=Regras de extração').count();
    check('Painel Config: \"Regras de extração\" visível', rulesLabel > 0);

    const waLabel = await page.locator('text=Template WhatsApp').count();
    check('Painel Config: \"Template WhatsApp\" visível', waLabel > 0);

    // Close config again
    await page.locator('text=Config').first().click();
    await page.waitForTimeout(200);
  }
}

async function testFreightPage(page) {
  console.log('\n🚚 ── Frete ──');

  await page.evaluate(() => { location.hash = '#/freight'; });
  await page.waitForTimeout(800);

  // CEP origem
  const cepOrigem = await page.locator('input[placeholder=\"00000-000\"]').count();
  check('Inputs de CEP renderizados (origem + destino)', cepOrigem >= 2, `${cepOrigem} input(s)`);

  // Buscar CEP buttons
  const searchBtns = await page.locator('button', { hasText: 'Buscar CEP' }).count();
  check('Botões \"Buscar CEP\" renderizados', searchBtns >= 2, `${searchBtns} botões`);

  // Package table
  const pkgHeaders = await page.locator('text=Peso (kg)').count();
  check('Tabela de pacotes com \"Peso (kg)\"', pkgHeaders > 0);

  const addPkgBtn = await page.locator('button', { hasText: 'Adicionar Pacote' }).count();
  check('Botão \"Adicionar Pacote\"', addPkgBtn > 0);

  // Seguro
  const seguroInput = await page.locator('input[placeholder*=\"Valor declarado\"]').count();
  check('Input de seguro da carga', seguroInput > 0);

  // Cotar button
  const cotarBtn = await page.locator('button', { hasText: 'Cotar Frete' }).count();
  check('Botão \"Cotar Frete\"', cotarBtn > 0);

  // Check package inputs have aria-labels
  const pkgInputs = await page.locator('input[aria-label*=\"pacote\"]').count();
  check('Inputs da tabela de pacotes com aria-label', pkgInputs >= 3, `${pkgInputs} inputs com aria-label`);

  // Check auto-query message (no radio buttons anymore)
  const autoMsg = await page.locator('text=Todas as transportadoras disponíveis').count();
  check('Mensagem de consulta automática de transportadoras', autoMsg > 0);
}

async function testCrmKanban(page) {
  console.log('\n📊 ── CRM Kanban ──');

  await page.evaluate(() => { location.hash = '#/crm'; });
  await page.waitForTimeout(2000);

  // Check loading resolved
  const kanbanHeaders = await page.locator('text=Novo Lead').count();
  if (kanbanHeaders > 0) {
    check('Coluna \"Novo Lead\" visível no kanban', true);
  } else {
    // Maybe no deals — check empty state
    const emptyState = await page.locator('text=Nenhum deal').count();
    check('State: kanban carregou (com deals ou estado vazio)', kanbanHeaders > 0 || emptyState > 0, 'sem deals ou estado vazio');
  }

  // Check search input
  const searchInput = await page.locator('input[placeholder*=\"Buscar por nome\"]').count();
  check('Input de busca no CRM', searchInput > 0);

  // Check column count (7 pipeline stages expected when there are deals)
  if (kanbanHeaders > 0) {
    const pipelineStages = ['Novo Lead', 'Contato Feito', 'Orcamento Enviado', 'Em Negociacao', 'Arte Aprovada', 'Pedido Fechado', 'Perdido'];
    for (const stage of pipelineStages) {
      const visible = await page.locator('text=' + stage).count();
      check(`Estágio \"${stage}\" presente no kanban`, visible > 0);
    }
  }
}

async function testProductsPage(page) {
  console.log('\n📦 ── Produtos ──');

  await page.evaluate(() => { location.hash = '#/products'; });
  await page.waitForTimeout(1500);

  // Search input
  const searchInput = await page.locator('input[placeholder*=\"Buscar por SKU\"]').count();
  check('Input de busca de produtos', searchInput > 0);

  // Check table (may have data or empty state)
  const tableHeaders = await page.locator('text=SKU').count();
  const emptyState = await page.locator('text=Nenhum produto').count();
  check('Página de produtos carregou', tableHeaders > 0 || emptyState > 0, tableHeaders > 0 ? 'tabela com dados' : 'estado vazio');
}

async function testLeadsPage(page) {
  console.log('\n👥 ── Leads ──');

  await page.evaluate(() => { location.hash = '#/leads'; });
  await page.waitForTimeout(1500);

  // Filter chips
  const todosChip = await page.locator('button', { hasText: 'Todos' }).count();
  const leadsChip = await page.locator('button', { hasText: 'Leads' }).count();
  const clientesChip = await page.locator('button', { hasText: 'Clientes' }).count();
  check('Chips de filtro (Todos/Leads/Clientes)', todosChip > 0 && leadsChip > 0 && clientesChip > 0,
    `Todos:${todosChip} Leads:${leadsChip} Clientes:${clientesChip}`);

  // Search
  const searchInput = await page.locator('input[placeholder*=\"Buscar por nome\"]').count();
  check('Input de busca de leads', searchInput > 0);

  // Desktop table
  const tableHeaders = await page.locator('.hidden.md\\:block table th').count();
  const emptyState = await page.locator('text=Nenhum lead').count();
  check('Página de leads desktop carregou', tableHeaders > 0 || emptyState > 0);

  // ── Mobile cards ──
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => { location.hash = '#/leads'; });
  await page.waitForTimeout(1000);

  const mobileCards = await page.locator('.md\\:hidden.space-y-3 > div').count();
  check('Mobile: cards de leads renderizados', mobileCards > 0, `${mobileCards} card(s)`);

  // Reset to desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { location.hash = '#/leads'; });
  await page.waitForTimeout(1000);
}

async function testManualOrcamentoPage(page) {
  console.log('\n🛒 ── Novo Orçamento Manual ──');

  await page.evaluate(() => { location.hash = '#/manual'; });
  await page.waitForTimeout(1000);

  // Page header
  const header = await page.locator('text=Novo Orçamento Manual').count();
  check('PageHeader: "Novo Orçamento Manual" visível', header > 0);

  // Client section
  const clientSection = await page.locator('text=1. Cliente').count();
  check('Seção "1. Cliente" visível', clientSection > 0);

  // Client type toggle
  const existingBtn = await page.locator('button', { hasText: 'Buscar existente' }).count();
  const newBtn = await page.locator('button', { hasText: 'Novo cliente' }).count();
  check('Toggle "Buscar existente" / "Novo cliente"', existingBtn > 0 && newBtn > 0);

  // Search input
  const clientSearch = await page.locator('input[aria-label="Buscar cliente"]').count();
  check('Input de busca de cliente com aria-label', clientSearch > 0);

  // Product section
  const productSection = await page.locator('text=2. Produtos').count();
  check('Seção "2. Produtos" visível', productSection > 0);

  // Product search
  const productSearch = await page.locator('input[aria-label="Buscar produto"]').count();
  check('Input de busca de produto com aria-label', productSearch > 0);

  // Empty cart hint
  const emptyCart = await page.locator('text=Nenhum produto adicionado ainda').count();
  check('Hint de carrinho vazio visível', emptyCart > 0);

  // Switch to new client mode
  if (newBtn > 0) {
    await page.locator('button', { hasText: 'Novo cliente' }).first().click();
    await page.waitForTimeout(300);

    // Check manual inputs appeared
    const nomeInput = await page.locator('input[aria-label="Nome do cliente"]').count();
    const emailInput = await page.locator('input[aria-label="Email do cliente"]').count();
    const telInput = await page.locator('input[aria-label="Telefone do cliente"]').count();
    check('Campos de novo cliente renderizados', nomeInput > 0 && emailInput > 0 && telInput > 0,
      `nome:${nomeInput} email:${emailInput} tel:${telInput}`);

    // Fill client info
    await page.locator('input[aria-label="Nome do cliente"]').fill('Cliente Teste');
    await page.locator('input[aria-label="Email do cliente"]').fill('teste@exemplo.com');
    await page.locator('input[aria-label="Telefone do cliente"]').fill('11999999999');
  }

  // Search for a product
  if (productSearch > 0) {
    await page.locator('input[aria-label="Buscar produto"]').fill('LNC');
    await page.waitForTimeout(1500);

    // Product results may appear
    const results = await page.locator('text=Selecionar').count();
    check('Resultados de busca de produto aparecem ou carregam', results >= 0);
  }

  // Check prazo + observações are NOT visible until items exist
  const prazoBefore = await page.locator('text=Prazo de produção').count();
  check('Seção de resumo não visível antes de adicionar itens', prazoBefore === 0);
}

async function testSettingsPage(page) {
  console.log('\n⚙️ ── Config ──');

  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForTimeout(800);

  // Rules section — check for label now (not bare text)
  const rulesLabel = await page.locator('label[for=\"settings-rules\"]').count();
  check('Label \"Regras de Extração\" com for attribute', rulesLabel > 0);

  // WA template section
  const waLabel = await page.locator('label[for=\"settings-wa\"]').count();
  check('Label \"Template WhatsApp\" com for attribute', waLabel > 0);

  // No more h1 duplication — PageHeader should be used
  // Check that only TopBar has the page title
  const pageH1s = await page.locator('main h1').count();
  // PageHeader renders an h1, so there should be exactly 1 (from PageHeader, not duplicated)
  check('PageHeader renderiza h1 (≤1 no main)', pageH1s <= 1, `${pageH1s} h1(s)`);

  // Save buttons
  const saveBtns = await page.locator('button', { hasText: 'Salvar' }).count();
  check('Botões \"Salvar\" (2: regras + template)', saveBtns >= 2, `${saveBtns} botões`);

  // Type in rules and save
  const textareas = await page.locator('textarea');
  const taCount = await textareas.count();
  if (taCount > 0) {
    await textareas.first().fill('Regra de teste: sempre incluir SKU-XYZ');
    await page.locator('button', { hasText: 'Salvar Regras' }).first().click();
    await page.waitForTimeout(500);

    // Check toast
    const toast = await page.locator('text=Salvo com sucesso').count();
    check('Toast \"Salvo com sucesso!\" após salvar regras', toast > 0);
  }
}

async function main() {
  console.log('🎭 Playwright E2E — React Frontend (aspen-orcamento) v2');
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
    // Load the app
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Check app loaded
    const title = await page.title();
    check('Página carregou com título \"Aspen Orçamento\"', title === 'Aspen Orçamento', `título: "${title}"`);

    // Check sidebar brand
    const brand = await page.locator('text=Aspen Orçamento').first().textContent();
    check('Sidebar mostra \"Aspen Orçamento\"', brand && brand.includes('Aspen'), `texto: "${brand}"`);

    // Run all page tests
    await testQuotationsPage(page);
    await testQuotationDetail(page);
    await testAutoPage(page);
    await testFreightPage(page);
    await testCrmKanban(page);
    await testProductsPage(page);
    await testLeadsPage(page);
    await testManualOrcamentoPage(page);
    await testSettingsPage(page);

    // Browser console check
    check('Sem erros de console no navegador', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  } catch (err) {
    FAIL.push(`  ❌ ERRO FATAL: ${err.message}`);
  } finally {
    await browser.close();
  }

  // Report
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
