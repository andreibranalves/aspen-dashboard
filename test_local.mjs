// Test runner for orcamento function — run with: node test_local.mjs
import { readFileSync } from 'fs';

// Load .env
const env = readFileSync('.env', 'utf8');
for (const line of env.split('\n')) {
  const [k, ...rest] = line.split('=');
  const v = rest.join('=');
  if (k && v) process.env[k.trim()] = v.trim();
}

const { handler: extractHandler } = await import('./netlify/functions/extract.js');
const { handler: orcamentoHandler } = await import('./netlify/functions/orcamento.js');

const text = [
  'Chapeu CH56 30 PAOLA ALVES 14991234767 paola.contatos@gmail.com',
  'Chapeu CH56 30 ADRIANO BONDEZAN ANATOLIO 34996448200 adrianoba99@gmail.com',
  'Chapeu CH44 30 THIAGO 27998139349 tvendas.thiagosouza@gmail.com',
].join('\n');

console.log('=== Phase 1: extract ===');
const t0 = Date.now();

const extractResult = await extractHandler({
  httpMethod: 'POST',
  body: JSON.stringify({ text }),
});

const elapsed1 = ((Date.now() - t0) / 1000).toFixed(2);
const extractBody = JSON.parse(extractResult.body);
console.log(`Status: ${extractResult.statusCode} | Time: ${elapsed1}s`);

if (extractBody.error) {
  console.error('Extract error:', extractBody.error);
  process.exit(1);
}

const orders = extractBody.orders;
console.log(`Orders found: ${orders.length}`);
orders.forEach((o, i) => console.log(`  ${i + 1}. ${o.nome} | ${o.email || '-'} | items: ${o.items.map(x => `${x.qty}x${x.item_code}`).join(', ')}`));

console.log('\n=== Phase 2: process each order ===');
for (let i = 0; i < orders.length; i++) {
  const t1 = Date.now();
  const result = await orcamentoHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ extracted: orders[i] }),
  });
  const elapsed = ((Date.now() - t1) / 1000).toFixed(2);
  const body = JSON.parse(result.body);
  if (body.error) {
    console.log(`  ${i + 1}/${orders.length} ✗ ${orders[i].nome}: ${body.error} (${elapsed}s)`);
  } else {
    console.log(`  ${i + 1}/${orders.length} ✓ ${body.cliente} → ${body.quotation_id} (${elapsed}s)`);
  }
}

const totalElapsed = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`\nTotal: ${totalElapsed}s`);
