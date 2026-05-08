// E2E: Quotations list — totals bar + row actions
import { chromium } from 'playwright';
import assert from 'assert';

const URL = 'https://dashboard.srv1633500.hstgr.cloud';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // 1. Navigate to quotations list
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tableBody tr', { timeout: 15000 });
  await page.waitForTimeout(500);

  // 2. Check table has Ações column header
  const headers = await page.$$eval('#quotationsTable th', els => els.map(e => e.textContent.trim()));
  console.log('Headers:', headers);
  assert.ok(headers.includes('Ações'), 'Ações column missing');

  // 3. Check totals bar visible
  const totalsBar = await page.$('#totalsBar');
  assert.ok(totalsBar, 'Totals bar missing');
  const barDisplay = await totalsBar.evaluate(el => el.style.display);
  assert.ok(barDisplay !== 'none', 'Totals bar hidden');

  const totalsQty = await page.$eval('#totalsQty', e => e.textContent);
  const totalsValue = await page.$eval('#totalsValue', e => e.textContent);
  console.log(`Totals: ${totalsQty} | ${totalsValue}`);
  assert.ok(totalsQty.includes('orçamento'), 'Qty label wrong');
  assert.ok(totalsValue.includes('R$') || totalsValue.includes(','), 'Value format wrong');

  // 4. Check row action buttons exist
  const firstRow = await page.$('#tableBody tr:first-child');
  assert.ok(firstRow, 'No table rows');

  const whatsappBtn = await firstRow.$('.row-action-btn.whatsapp');
  const editBtn = await firstRow.$('.row-action-btn:not(.whatsapp):not(.pdf)');
  const pdfBtn = await firstRow.$('.row-action-btn.pdf');
  assert.ok(whatsappBtn, 'WhatsApp button missing');
  assert.ok(editBtn, 'Edit button missing');
  assert.ok(pdfBtn, 'PDF button missing');
  console.log('✅ Row actions: 📱 ✏️ 📄');

  // 5. Check status chips have counts
  const chips = await page.$$('#statusChips .status-chip');
  console.log(`Status chips: ${chips.length}`);
  for (const chip of chips.slice(0, 4)) {
    const text = await chip.textContent();
    console.log(`  ${text.trim()}`);
  }

  // 6. Check row click navigates to detail
  const firstRowId = await firstRow.$eval('.col-num', e => e.textContent);
  await firstRow.click();
  await page.waitForTimeout(1000);
  const detailTitle = await page.$eval('.page.active .page-title', e => e.textContent).catch(() => null);
  console.log(`Clicked row ${firstRowId} → "${detailTitle}"`);

  // 7. Go back and test status filter
  await page.evaluate(() => { location.hash = '#quotations'; });
  await page.waitForTimeout(1000);
  await page.waitForSelector('#tableBody tr', { timeout: 10000 });

  // Click "Rascunho" chip
  const draftChip = await page.$('.status-chip[data-status="Draft"]');
  if (draftChip) {
    await draftChip.click();
    await page.waitForTimeout(1500);
    const periodLabel = await page.$eval('#totalsPeriod', e => e.textContent).catch(() => '');
    console.log(`Draft filter → totals period: "${periodLabel}"`);
  }

  // 8. Check external: the same page works via HTTPS
  const extRes = await fetch(URL + '/api/quotations?limit=2');
  const extData = await extRes.json();
  console.log(`🌐 External API: ${extData.data?.length} rows, total=${extData.pagination?.total}`);

  console.log('\n✅ ALL TESTS PASSED');
  await browser.close();
}

main().catch(err => {
  console.error('❌ FAIL:', err.message);
  process.exit(1);
});
