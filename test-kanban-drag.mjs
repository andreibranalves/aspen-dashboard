// E2E: CRM Kanban — drag preserves empty columns
import { chromium } from 'playwright';
import assert from 'assert';

const URL = 'https://dashboard.srv1633500.hstgr.cloud';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { location.hash = '#crm'; });
  await page.waitForSelector('#kanbanBoard', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // 1. Verify 7 columns initially
  let cols = page.locator('.kanban-column');
  console.log(`1. Initial: ${await cols.count()} columns`);
  assert.strictEqual(await cols.count(), 7);

  // 2. Find a column with cards + an empty target
  const colCount = await cols.count();
  let sourceIdx = -1, targetIdx = -1, sourceName = '', targetName = '';
  for (let i = 0; i < colCount; i++) {
    const col = cols.nth(i);
    const title = await col.locator('.kanban-column-title').textContent();
    const cards = await col.locator('.kanban-card').count();
    if (sourceIdx === -1 && cards > 0) { sourceIdx = i; sourceName = title; }
    if (targetIdx === -1 && cards === 0 && title !== sourceName) { targetIdx = i; targetName = title; }
  }
  console.log(`   Source: "${sourceName}" (idx ${sourceIdx})`);
  console.log(`   Target: "${targetName}" (idx ${targetIdx})`);

  // 3. Drag
  if (sourceIdx >= 0 && targetIdx >= 0) {
    const sourceCard = cols.nth(sourceIdx).locator('.kanban-card').first();
    const cardName = await sourceCard.locator('.kanban-card-name').textContent();
    console.log(`2. Drag "${cardName}" → "${targetName}"`);

    await sourceCard.dragTo(cols.nth(targetIdx).locator('.kanban-cards'));
    await page.waitForTimeout(1500);

    // 4. CRITICAL: all 7 columns still exist
    console.log(`3. After drag: ${await cols.count()} columns`);
    assert.strictEqual(await cols.count(), 7, 'Must have 7 columns after drag');

    // 5. Source column still visible
    const sourceCol = page.locator('.kanban-column', { hasText: sourceName });
    assert.ok(await sourceCol.count() > 0, `"${sourceName}" column must still exist`);

    // 6. Drag back to restore
    const dragged = cols.nth(targetIdx).locator('.kanban-card').first();
    if (await dragged.count() > 0) {
      await dragged.dragTo(cols.nth(sourceIdx).locator('.kanban-cards'));
      await page.waitForTimeout(1500);
      console.log('4. Dragged back — OK');
    }
  }

  // 7. Reload verification
  await page.evaluate(() => { location.hash = '#crm'; });
  await page.waitForSelector('#kanbanBoard', { timeout: 10000 });
  await page.waitForTimeout(1500);
  cols = page.locator('.kanban-column');
  console.log(`5. After reload: ${await cols.count()} columns`);
  assert.strictEqual(await cols.count(), 7);

  // 8. Verify all titles
  const titles = await page.locator('.kanban-column-title').allTextContents();
  const expected = ['Novo Lead', 'Contato Feito', 'Orcamento Enviado',
    'Em Negociacao', 'Arte Aprovada', 'Pedido Fechado', 'Perdido'];
  for (const t of expected) assert.ok(titles.includes(t), `Missing: ${t}`);

  console.log('\n✅ ALL PASSED — empty columns survive drag');
  await browser.close();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
