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
  check('Sidebar tem 7 links de navegação', sidebarLinks === 7, `encontrados: ${sidebarLinks}`);

  // Wait for table to load
  await page.waitForTimeout(2000);

  // Check status chips
  const chips = await page.locator('aside + div main button[class*="rounded-full"]').count();
  check('Status chips visíveis (>4)', chips >= 4, `encontrados: ${chips}`);

  // Check search input
  const searchInput = await page.locator('input[placeholder*="Buscar por Nº"]').count();
  check('Input de busca renderizado', searchInput > 0);

  // Check table has rows
  const rows = await page.locator('table tbody tr').count();
  check('Tabela tem linhas com dados', rows > 0, `${rows} linha(s)`);

  if (rows > 0) {
    // Check first row has quotation ID (monospaced)
    const firstCell = await page.locator('table tbody tr').first().locator('td').first().textContent();
    check('Primeira célula é um Nº de orçamento (formato ORC-)', /ORC-/.test(firstCell), `valor: "${firstCell}"`);

    // Check BRL format in value column
    const valCell = await page.locator('table tbody tr').first().locator('td').nth(3).textContent();
    check('Valor em formato BRL (R$ X.XXX,XX)', /R\$\s*[\d.]+,\d{2}/.test(valCell), `valor: "${valCell}"`);

    // Check status badge exists
    const badge = await page.locator('table tbody tr').first().locator('td').nth(4).locator('span').first().textContent();
    check('Status badge renderizado', badge && badge.length > 0, `texto: "${badge}"`);

    // Check action buttons (WhatsApp, Edit, PDF, Delete)
    const actionBtns = await page.locator('table tbody tr').first().locator('td').last().locator('a, button').count();
    check('Coluna de ações tem 4 botões', actionBtns === 4, `encontrados: ${actionBtns}`);
  }

  // Check totals bar
  const totalsBar = await page.locator('text=Quantidade').count();
  check('Totals bar com "Quantidade" visível', totalsBar > 0);

  // Check pagination exists (if > 25 records)
  const pageInfo = await page.locator('text=Página').count();
  if (pageInfo > 0) {
    check('Paginação renderizada com "Página X de Y"', true);
  }

  // Status chip click — filter
  const openChip = page.locator('main button', { hasText: 'Aberto' });
  const openChipCount = await openChip.count();
  if (openChipCount > 0) {
    await openChip.first().click();
    await page.waitForTimeout(1500);
    const chipActive = await openChip.first().evaluate(el => el.className);
    check('Status chip "Aberto" ativado ao clicar', chipActive.includes('bg-primary'), `classe: ${chipActive}`);
    // Click "Todos" to reset
    const todosChip = page.locator('main button', { hasText: 'Todos' }).first();
    if (await todosChip.count() > 0) await todosChip.click();
    await page.waitForTimeout(1000);
  }
}

async function testQuotationDetail(page) {
  console.log('\n📄 ── Detalhe do Orçamento ──');

  // Find first quotation ID from the table
  await page.evaluate(() => { location.hash = '#/quotations'; });
  await page.waitForTimeout(2000);

  const firstRow = page.locator('table tbody tr').first();
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
  check('Link "Voltar para lista" visível', backLink > 0);

  // Check client name
  const clienteLabel = await page.locator('text=Cliente').count();
  check('Label "Cliente" no card de detalhe', clienteLabel > 0);

  // Check items table
  const itemRows = await page.locator('table tbody tr').count();
  check('Tabela de itens tem linhas', itemRows > 0, `${itemRows} linha(s)`);

  // Check totals
  const totalsText = await page.textContent('body');
  check('Total com formato BRL no detalhe', /Total:\s*R\$\s*[\d.]+,\d{2}/.test(totalsText));

  // Check action buttons in view mode
  const editBtn = await page.locator('button', { hasText: 'Editar' }).count();
  check('Botão "Editar" visível no modo view', editBtn > 0);

  const pdfBtn = await page.locator('a', { hasText: 'Visualizar' }).count();
  check('Link "Visualizar" (PDF) visível', pdfBtn > 0);

  const deleteBtn = await page.locator('button', { hasText: 'Excluir' }).count();
  check('Botão "Excluir" visível no modo view', deleteBtn > 0);

  // Enter edit mode
  const editButton = page.locator('button', { hasText: 'Editar' }).first();
  if (await editButton.count() > 0) {
    await editButton.click();
    await page.waitForTimeout(500);

    const saveBtn = await page.locator('button', { hasText: 'Salvar' }).count();
    check('Botão "Salvar" visível no modo edit', saveBtn > 0);

    const cancelBtn = await page.locator('button', { hasText: 'Cancelar' }).count();
    check('Botão "Cancelar" visível no modo edit', cancelBtn > 0);

    const addItemBtn = await page.locator('button', { hasText: '+ Item' }).count();
    check('Botão "+ Item" visível no modo edit', addItemBtn > 0);

    // Check inputs are editable
    const skuInputs = await page.locator('input[placeholder="SKU"]').count();
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
  check('Phase indicator "1. Entrada" visível', phaseLabels > 0);

  const phaseSteps = await page.locator('text=5. Concluído').count();
  check('Phase indicator "5. Concluído" visível', phaseSteps > 0);

  // Textarea
  const textarea = await page.locator('textarea').count();
  check('Textarea para input do pedido', textarea > 0);

  // Image upload area
  const imageArea = await page.locator('text=Arraste uma imagem aqui').count();
  check('Área de upload de imagem renderizada', imageArea > 0);

  // Prazo input
  const prazoInput = await page.locator('input[placeholder*="Ex: 10 a 15"]').count();
  check('Input de prazo de produção', prazoInput > 0);

  // Config toggle
  const configBtn = await page.locator('text=Config').count();
  check('Botão "Config" (settings toggle) visível', configBtn > 0);

  // Open Config
  if (configBtn > 0) {
    await page.locator('text=Config').first().click();
    await page.waitForTimeout(400);

    const rulesLabel = await page.locator('text=Regras de extração').count();
    check('Painel Config: "Regras de extração" visível', rulesLabel > 0);

    const waLabel = await page.locator('text=Template WhatsApp').count();
    check('Painel Config: "Template WhatsApp" visível', waLabel > 0);

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
  const cepOrigem = await page.locator('input[placeholder="00000-000"]').count();
  check('Inputs de CEP renderizados (origem + destino)', cepOrigem >= 2, `${cepOrigem} input(s)`);

  // Buscar CEP buttons
  const searchBtns = await page.locator('button', { hasText: 'Buscar CEP' }).count();
  check('Botões "Buscar CEP" renderizados', searchBtns >= 2, `${searchBtns} botões`);

  // Package table
  const pkgHeaders = await page.locator('text=Peso (kg)').count();
  check('Tabela de pacotes com "Peso (kg)"', pkgHeaders > 0);

  const addPkgBtn = await page.locator('button', { hasText: 'Adicionar Pacote' }).count();
  check('Botão "Adicionar Pacote"', addPkgBtn > 0);

  // Seguro
  const seguroInput = await page.locator('input[placeholder*="Valor declarado"]').count();
  check('Input de seguro da carga', seguroInput > 0);

  // Carrier radios
  const carrierRadios = await page.locator('input[type="radio"]').count();
  check('Radio buttons de transportadora', carrierRadios >= 3, `${carrierRadios} radios`);

  // Cotar button
  const cotarBtn = await page.locator('button', { hasText: 'Cotar Frete' }).count();
  check('Botão "Cotar Frete"', cotarBtn > 0);
}

async function testCrmKanban(page) {
  console.log('\n📊 ── CRM Kanban ──');

  await page.evaluate(() => { location.hash = '#/crm'; });
  await page.waitForTimeout(2000);

  // Check loading resolved
  const kanbanHeaders = await page.locator('text=Novo Lead').count();
  if (kanbanHeaders > 0) {
    check('Coluna "Novo Lead" visível no kanban', true);
  } else {
    // Maybe no deals — check empty state
    const emptyState = await page.locator('text=Nenhum deal').count();
    check('State: kanban carregou (com deals ou estado vazio)', kanbanHeaders > 0 || emptyState > 0, 'sem deals ou estado vazio');
  }

  // Check search input
  const searchInput = await page.locator('input[placeholder*="Buscar por nome"]').count();
  check('Input de busca no CRM', searchInput > 0);

  // Check column count (7 pipeline stages expected when there are deals)
  if (kanbanHeaders > 0) {
    const pipelineStages = ['Novo Lead', 'Contato Feito', 'Orcamento Enviado', 'Em Negociacao', 'Arte Aprovada', 'Pedido Fechado', 'Perdido'];
    for (const stage of pipelineStages) {
      const visible = await page.locator('text=' + stage).count();
      check(`Estágio "${stage}" presente no kanban`, visible > 0);
    }
  }
}

async function testProductsPage(page) {
  console.log('\n📦 ── Produtos ──');

  await page.evaluate(() => { location.hash = '#/products'; });
  await page.waitForTimeout(1500);

  // Search input
  const searchInput = await page.locator('input[placeholder*="Buscar por SKU"]').count();
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
  const searchInput = await page.locator('input[placeholder*="Buscar por nome"]').count();
  check('Input de busca de leads', searchInput > 0);

  // Table or empty
  const tableHeaders = await page.locator('text=Email').count();
  const emptyState = await page.locator('text=Nenhum lead').count();
  check('Página de leads carregou', tableHeaders > 0 || emptyState > 0);
}

async function testSettingsPage(page) {
  console.log('\n⚙️ ── Config ──');

  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForTimeout(800);

  // Rules section
  const rulesLabel = await page.locator('text=Regras de Extração').count();
  check('Seção "Regras de Extração"', rulesLabel > 0);

  // WA template section
  const waLabel = await page.locator('text=Template WhatsApp').count();
  check('Seção "Template WhatsApp"', waLabel > 0);

  // Save buttons
  const saveBtns = await page.locator('button', { hasText: 'Salvar' }).count();
  check('Botões "Salvar" (2: regras + template)', saveBtns >= 2, `${saveBtns} botões`);

  // Type in rules and save
  const textareas = await page.locator('textarea');
  const taCount = await textareas.count();
  if (taCount > 0) {
    await textareas.first().fill('Regra de teste: sempre incluir SKU-XYZ');
    await page.locator('button', { hasText: 'Salvar Regras' }).first().click();
    await page.waitForTimeout(500);

    // Check toast
    const toast = await page.locator('text=Salvo com sucesso').count();
    check('Toast "Salvo com sucesso!" após salvar regras', toast > 0);
  }
}

async function main() {
  console.log('🎭 Playwright E2E — React Frontend (aspen-orcamento)');
  console.log(`   URL: ${BASE}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
  });
  const page = await context.newPage();

  try {
    // Load the app
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Check app loaded
    const title = await page.title();
    check('Página carregou com título "Aspen Orçamento"', title === 'Aspen Orçamento', `título: "${title}"`);

    // Check sidebar brand
    const brand = await page.locator('text=Aspen Orçamento').first().textContent();
    check('Sidebar mostra "Aspen Orçamento"', brand && brand.includes('Aspen'), `texto: "${brand}"`);

    // Run all page tests
    await testQuotationsPage(page);
    await testQuotationDetail(page);
    await testAutoPage(page);
    await testFreightPage(page);
    await testCrmKanban(page);
    await testProductsPage(page);
    await testLeadsPage(page);
    await testSettingsPage(page);

    // Browser console check
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

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
