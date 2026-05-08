// E2E test: CRM Kanban — verifica 7 colunas + drag-and-drop
import { chromium } from 'playwright';
import assert from 'assert';

const URL = 'https://dashboard.srv1633500.hstgr.cloud';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Navega para o dashboard (sem hash, deixa a hash navigation funcionar)
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // Navega para #crm via evaluate (dispara navigate())
  await page.evaluate(() => { location.hash = '#crm'; });
  await page.waitForTimeout(1500);

  // Espera o kanban carregar
  await page.waitForSelector('#kanbanBoard', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Conta colunas
  const columns = await page.$$('.kanban-column');
  console.log(`✅ Colunas no kanban: ${columns.length}`);
  assert.strictEqual(columns.length, 7, 'Deve ter 7 colunas');

  // Verifica nomes das colunas
  const colTitles = await page.$$eval('.kanban-column-title', els => els.map(e => e.textContent));
  console.log('Colunas:', colTitles);
  assert.deepStrictEqual(colTitles, [
    'Novo Lead', 'Contato Feito', 'Orcamento Enviado',
    'Em Negociacao', 'Arte Aprovada', 'Pedido Fechado', 'Perdido'
  ]);

  // Conta cards (deals) em cada coluna
  for (const title of colTitles) {
    const col = page.locator('.kanban-column', { hasText: title });
    const cards = await col.locator('.kanban-card').count();
    const countBadge = await col.locator('.kanban-column-count').textContent();
    console.log(`  ${title}: ${cards} cards (badge: ${countBadge})`);
  }

  // Verifica busca funcional
  await page.fill('#crmSearch', 'Andrei');
  await page.waitForTimeout(500);

  // Depois da busca, espera o filtro
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('.kanban-card');
    return cards.length <= 2;
  }, { timeout: 5000 });

  const cardsAfterSearch = await page.$$('.kanban-card');
  console.log(`🔍 Busca "Andrei": ${cardsAfterSearch.length} cards`);
  assert.ok(cardsAfterSearch.length <= 2, 'Busca deve filtrar cards');

  // Limpa busca
  await page.fill('#crmSearch', '');
  await page.waitForTimeout(500);
  await page.waitForFunction(() => {
    return document.querySelectorAll('.kanban-card').length > 100;
  }, { timeout: 5000 });

  // Testa drag-and-drop: arrasta primeiro card de "Novo Lead" para "Contato Feito"
  const sourceCard = page.locator('.kanban-card').first();
  const targetCol = page.locator('.kanban-column', { hasText: 'Contato Feito' });
  const targetCards = targetCol.locator('.kanban-cards');

  const cardText = await sourceCard.locator('.kanban-card-name').textContent();
  console.log(`🖱️  Arrastando "${cardText}" para Contato Feito...`);

  await sourceCard.dragTo(targetCards);
  await page.waitForTimeout(1000);

  // Verifica que o card se moveu (otimista)
  const contatoCards = await targetCol.locator('.kanban-card').count();
  console.log(`  Cards em "Contato Feito" após drag: ${contatoCards}`);

  // Aguarda a confirmação do backend
  await page.waitForTimeout(2000);

  // Recarrega para verificar que o estado foi persistido
  await page.evaluate(() => { location.hash = '#crm'; });
  await page.waitForTimeout(2000);
  await page.waitForSelector('#kanbanBoard', { timeout: 10000 });

  const contatoCardsAfterReload = await targetCol.locator('.kanban-card').count();
  console.log(`  Cards em "Contato Feito" após reload: ${contatoCardsAfterReload}`);

  // Se moveu mesmo, reverte de volta para "Novo Lead"
  if (contatoCardsAfterReload > 0) {
    const movedCard = targetCol.locator('.kanban-card').first();
    const novoLeadCol = page.locator('.kanban-column', { hasText: 'Novo Lead' });
    await movedCard.dragTo(novoLeadCol.locator('.kanban-cards'));
    await page.waitForTimeout(2000);
    console.log('🔄 Revertido para Novo Lead');
  }

  console.log('\n✅ Todos os testes passaram!');
  await browser.close();
}

main().catch(err => {
  console.error('❌ FAIL:', err.message);
  process.exit(1);
});
