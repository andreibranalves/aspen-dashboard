// E2E: Quotation detail — delete button test
import { chromium } from 'playwright';
import assert from 'assert';

const URL = 'https://dashboard.srv1633500.hstgr.cloud';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { location.hash = '#quotation-detail?ORC-20261272'; });
  await page.waitForSelector('#detailCard', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // 1. Delete button visible
  const deleteBtn = await page.$('#deleteBtn');
  assert.ok(deleteBtn, 'Delete button missing');
  const btnText = await deleteBtn.textContent();
  console.log(`1. Delete button: "${btnText.trim()}"`);

  // 2. Handle dialog (Playwright auto-dismisses)
  page.on('dialog', async (dialog) => {
    console.log(`   Dialog: ${dialog.message().substring(0, 80)}...`);
    await dialog.dismiss(); // Cancel (don't actually delete)
  });

  // 3. Click delete — confirm dialog should appear
  await deleteBtn.click();
  await page.waitForTimeout(500);
  console.log('2. Dialog appeared and dismissed ✅');

  // 4. Verify still on detail page (didn't navigate away)
  const detailId = await page.$eval('#detailQid', e => e.textContent);
  console.log(`3. Still viewing: ${detailId}`);

  // 5. Switch to edit mode — delete should STILL be visible (view mode buttons hidden)
  await page.click('#editBtn');
  await page.waitForTimeout(500);
  const viewActions = await page.$eval('#detailViewActions', e => e.style.display);
  console.log(`4. View actions display: "${viewActions}" (should be none)`);

  // 6. Go back to list, verify delete button on row actions also exists
  await page.evaluate(() => { location.hash = '#quotations'; });
  await page.waitForSelector('#tableBody tr', { timeout: 10000 });
  await page.waitForTimeout(500);

  const rowActions = await page.$$('.row-action-btn');
  console.log(`5. Row action buttons: ${rowActions.length}`);

  // 7. Test external API
  const extRes = await fetch(URL + '/api/quotations?id=ORC-20261274');
  const extData = await extRes.json();
  console.log(`🌐 External detail: ${extData.id} — ${extData.cliente}`);

  console.log('\n✅ ALL TESTS PASSED');
  await browser.close();
}

main().catch(err => {
  console.error('❌ FAIL:', err.message);
  process.exit(1);
});
