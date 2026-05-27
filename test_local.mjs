// Test runner for orcamento function — run with: node test_local.mjs
// Two-scenario regression harness: (a) Lead path (b) Customer path
// Verifies CRM-LEAD bug is absent.
import { readFileSync } from 'fs';

// Load .env
const env = readFileSync('.env', 'utf8');
for (const line of env.split('\n')) {
  const [k, ...rest] = line.split('=');
  const v = rest.join('=');
  if (k && v) process.env[k.trim()] = v.trim();
}

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_HEADERS = {
  'Authorization': `token ${process.env.ERPNEXT_TOKEN}`,
  'Content-Type': 'application/json',
};

const { handler: extractHandler } = await import('./api/_functions/extract.js');
const { handler: orcamentoHandler } = await import('./api/_functions/orcamento.js');
const { handler: pricingLookupHandler } = await import('./api/_functions/pricing-lookup.js');

let failures = 0;

function assert(ok, msg) {
  if (ok) { console.log(`  \u2713 ${msg}`); }
  else { console.error(`  \u2717 ASSERT: ${msg}`); failures++; }
}

// Run the full extract -> orcamento pipeline for one order text
async function pipeline(orderText) {
  const extRes = await extractHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ text: orderText }),
  });
  const extBody = JSON.parse(extRes.body);
  if (extBody.error) return { error: `extract: ${extBody.error}` };
  if (!extBody.orders || extBody.orders.length === 0) return { error: 'No orders extracted' };
  // Injeta origem fake para testes — orcamento.js exige origem de lead
  const order = { ...extBody.orders[0], origem: 'Bríndice' };
  const orcRes = await orcamentoHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ extracted: order }),
  });
  return JSON.parse(orcRes.body);
}

async function lookupPricing(items, urgent = false) {
  const res = await pricingLookupHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ items, urgent }),
  });
  return JSON.parse(res.body);
}

// Fetch printview through the view.js handler (/api/view)
async function fetchPrintviewViaViewHandler(quotationId) {
  const { handler: viewHandler } = await import('./api/_functions/view.js');
  const res = await viewHandler({ queryStringParameters: { q: quotationId } });
  if (res.statusCode !== 200) { console.error(`  view handler returned ${res.statusCode}`); return null; }
  return res.body;
}

// ── Scenario 1: Lead path ──
// Guaranteed new Lead: unique email never seen before.
console.log('\n=== Scenario 1: Lead quotation (unique email → new Lead) ===');
{
  const ts = Date.now();
  const email = `crmlead-print-test+${ts}@example.com`;
  const name = 'Lead Print Test';
  const orderText = `Chapeu CH56 30 ${name} 11999999999 ${email}`;

  const body = await pipeline(orderText);
  if (body.error) {
    console.error(`  \u2717 PIPELINE: ${body.error}`);
    failures++;
  } else {
    console.log(`  Quotation: ${body.quotation_id} | customer_id: ${body.customer_id}`);
    assert(body.success === true, 'body.success === true');
    assert(!!body.print_html, 'body.print_html exists');
    assert(body.customer_id.startsWith('CRM-LEAD-'), `customer_id starts with CRM-LEAD- (got: ${body.customer_id})`);
    assert(!body.print_html.includes('CRM-LEAD'), 'print_html has no CRM-LEAD string');

    // Fetch via view.js handler (/api/view) to verify name resolution works
    const viewHtml = await fetchPrintviewViaViewHandler(body.quotation_id);
    if (viewHtml) {
      assert(!viewHtml.includes('CRM-LEAD'), 'viewHtml (/api/view) has no CRM-LEAD string');
      assert(viewHtml.includes(name), `viewHtml contains customer name "${name}"`);
    } else {
      console.error('  \u2717 viewHtml fetch failed');
      failures++;
    }
  }
}

// ── Scenario 2: Customer path ──
// Discover an existing Customer-linked email at runtime, reuse it.
console.log('\n=== Scenario 2: Customer quotation (existing email → existing Customer) ===');
{
  // Query ERPNext for a Contact with an email_id AND a link to Customer doctype
  const contactListRes = await fetch(
    `${ERPNEXT_BASE}/api/resource/Contact?fields=${JSON.stringify(['name'])}&limit_page_length=50`,
    { headers: ERPNEXT_HEADERS }
  );
  const contactListData = await contactListRes.json();
  const contactNames = contactListData.data || [];

  let custEmail = null;
  let custName = null;

  for (const c of contactNames) {
    const fullRes = await fetch(
      `${ERPNEXT_BASE}/api/resource/Contact/${encodeURIComponent(c.name)}`,
      { headers: ERPNEXT_HEADERS }
    );
    const fullData = await fullRes.json();
    const d = fullData.data;
    if (!d) continue;

    const custLink = (d.links || []).find(l => l.link_doctype === 'Customer');
    const emailEntry = (d.email_ids || []).find(e => e.email_id);
    if (custLink && emailEntry) {
      custEmail = emailEntry.email_id;
      // Fetch actual customer_name from Customer doc (not link_name which is doc ID)
      const custRes = await fetch(
        `${ERPNEXT_BASE}/api/resource/Customer/${encodeURIComponent(custLink.link_name)}?fields=["customer_name"]`,
        { headers: ERPNEXT_HEADERS }
      );
      const custData = await custRes.json();
      custName = custData.data?.customer_name || custLink.link_name;
      break;
    }
  }

  if (!custEmail || !custName) {
    console.error('  \u2717 No Customer-linked email found in ERPNext');
    failures++;
  } else {
    console.log(`  Found: "${custName}" <${custEmail}>`);

    const orderText = `Chapeu CH56 30 ${custName} 11999999999 ${custEmail}`;

    const body = await pipeline(orderText);
    if (body.error) {
      console.error(`  \u2717 PIPELINE: ${body.error}`);
      failures++;
    } else {
      console.log(`  Quotation: ${body.quotation_id} | customer_id: ${body.customer_id}`);
      assert(body.success === true, 'body.success === true');
      assert(!!body.print_html, 'body.print_html exists');
      assert(!body.customer_id.startsWith('CRM-LEAD-'), `customer_id does not start with CRM-LEAD- (got: ${body.customer_id})`);
      assert(!body.print_html.includes('CRM-LEAD'), 'print_html has no CRM-LEAD string');
      assert(body.print_html.includes(custName), `print_html contains customer name "${custName}"`);

      const viewHtml = await fetchPrintviewViaViewHandler(body.quotation_id);
      if (viewHtml) {
        assert(!viewHtml.includes('CRM-LEAD'), 'viewHtml (/api/view) has no CRM-LEAD string');
        assert(viewHtml.includes(custName), `viewHtml contains customer name "${custName}"`);
      } else {
        console.error('  \u2717 viewHtml fetch failed');
        failures++;
      }
    }
  }
}

// ── Scenario 3: Draft review — structured edit (SKU swap + quantity change) ──
{
  console.log('\n=== Scenario 3: Draft review — structured edit ===');
  const orderText = 'Cliente Teste Draft test@test.com 11999999999\n100 lenços de seda';
  const body = await pipeline(orderText);
  if (body.error) {
    console.error(`  \u2717 extract: ${body.error}`);
    failures++;
  } else {
    console.log(`  Created: ${body.quotation_id}`);
    // Verify the default extraction created both LNC-SED-70 and LNC-CSD-70
    const skus = (body.items || []).map(i => i.sku);
    assert(skus.includes('LNC-SED-70'), 'extraction includes LNC-SED-70');
    assert(skus.includes('LNC-CSD-70'), 'extraction includes LNC-CSD-70');
  }
}

// ── Scenario 4: Draft review — pricing override ──
{
  console.log('\n=== Scenario 4: Draft review — pricing override ===');
  const orderText = 'Cliente Preco teste2@test.com 11999999998\n100 lenços de seda';
  const extRes = await extractHandler({ httpMethod: 'POST', body: JSON.stringify({ text: orderText }) });
  const extBody = JSON.parse(extRes.body);

  // Simulate draft edit: pre-set a rate on the first item
  const editedOrder = { ...extBody.orders[0], origem: 'Bríndice' };
  editedOrder.items[0].rate = 12.50;
  editedOrder.items[0].manual_rate = true;

  const orcRes = await orcamentoHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ extracted: editedOrder }),
  });
  const body = JSON.parse(orcRes.body);

  if (body.error) {
    console.error(`  \u2717 orcamento: ${body.error}`);
    failures++;
  } else {
    console.log(`  Created: ${body.quotation_id}`);
    const overriddenItem = (body.items || []).find(i => i.sku === editedOrder.items[0].item_code);
    const rate = overriddenItem ? overriddenItem.rate : null;
    assert(overriddenItem, 'overridden item exists in response');
    assert(rate === 12.50, `rate preserved (got: ${rate})`);
  }
}

// ── Scenario 5: Preview pricing parity — 60 cangas ──
{
  console.log('\n=== Scenario 5: Preview pricing parity — 60 cangas ===');
  const orderText = 'Cliente Canga testecanga@test.com 11999999997\n60 cangas';
  const extRes = await extractHandler({ httpMethod: 'POST', body: JSON.stringify({ text: orderText }) });
  const extBody = JSON.parse(extRes.body);

  if (extBody.error || !extBody.orders?.[0]) {
    console.error(`  \\u2717 extract: ${extBody.error || 'No order extracted'}`);
    failures++;
  } else {
    const extracted = { ...extBody.orders[0], origem: 'Bríndice' };
    const preview = await lookupPricing(extracted.items, extracted.urgente || false);
    const orcBody = JSON.parse((await orcamentoHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ extracted }),
    })).body);

    if (preview.error || orcBody.error) {
      console.error(`  \u2717 pricing parity: ${preview.error || orcBody.error}`);
      failures++;
    } else {
      const previewMap = new Map((preview.items || []).map(item => [`${item.item_code}:${item.qty}`, item.rate]));
      const finalMap = new Map((orcBody.items || []).map(item => [`${item.sku}:${item.qty}`, item.rate]));
      for (const [key, previewRate] of previewMap.entries()) {
        const finalRate = finalMap.get(key);
        assert(finalMap.has(key), `final quotation contains ${key}`);
        assert(finalRate === previewRate, `preview and final rates match for ${key} (preview=${previewRate}, final=${finalRate})`);
      }
    }
  }
}

// ── Scenario 6: Override reset after qty change reprices server-side ──
{
  console.log('\n=== Scenario 6: Override reset after qty change reprices server-side ===');
  const orderText = 'Cliente Auto taxaauto@test.com 11999999997\n100 lenços de seda';
  const extRes = await extractHandler({ httpMethod: 'POST', body: JSON.stringify({ text: orderText }) });
  const extBody = JSON.parse(extRes.body);

  if (extBody.error || !extBody.orders?.[0]) {
    console.error(`  \u2717 extract: ${extBody.error || 'No order extracted'}`);
    failures++;
  } else {
    const extracted = { ...extBody.orders[0], origem: 'Bríndice' };
    const itemCode = extracted.items[0].item_code;
    extracted.items[0].rate = 12.50;
    extracted.items[0].manual_rate = false;
    extracted.items[0].qty = 300;

    const preview = await lookupPricing([{ item_code: itemCode, qty: extracted.items[0].qty }], false);
    const orcBody = JSON.parse((await orcamentoHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ extracted }),
    })).body);

    if (preview.error || orcBody.error) {
      console.error(`  \u2717 stale rate repricing: ${preview.error || orcBody.error}`);
      failures++;
    } else {
      const finalItem = (orcBody.items || []).find(item => item.sku === itemCode);
      assert(!!finalItem, `final quotation contains ${itemCode}`);
      assert(finalItem?.rate === preview.items?.[0]?.rate, `reset override is ignored and repriced for ${itemCode} at qty 300 (preview=${preview.items?.[0]?.rate}, final=${finalItem?.rate})`);
      assert(finalItem?.rate !== 12.5, `stale manual rate 12.5 was not preserved after qty change (got: ${finalItem?.rate})`);
    }
  }
}

// ── Scenario 7: Draft review — empty items guard ──
{
  console.log('\n=== Scenario 7: Draft review — empty items guard ===');
  const evt = {
    httpMethod: 'POST',
    body: JSON.stringify({
      extracted: {
        nome: 'Cliente Vazio',
        email: null,
        telefone: null,
        urgente: false,
        origem: 'Bríndice',
        items: [],
      },
    }),
  };
  const res = await orcamentoHandler(evt);
  const body = JSON.parse(res.body);
  assert(res.statusCode === 400, `empty items returns HTTP 400 (got: ${res.statusCode})`);
  assert(body.error === 'Nenhum item válido informado para criar o orçamento.', `empty items returns PT-BR validation error (got: ${body.error})`);
}

// ── Summary ──
console.log(`\n=== ${failures} failure(s) ===`);
if (failures > 0) {
  process.exit(1);
} else {
  console.log('PASS');
}
