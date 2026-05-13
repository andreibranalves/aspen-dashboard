import assert from 'node:assert/strict';

// We import the module dynamically to bypass any module resolution issues
const {
  DEFAULT_WA_FLOWS,
  createId,
  normalizeFlow,
  loadWhatsappFlows,
  saveWhatsappFlows,
  getSelectedFlowId,
  saveSelectedFlowId,
  getFlowSummary,
  flowToSequencePayload,
  renderFlowTemplate,
  parseSampleImages,
  LS_WA_FLOWS,
  LS_WA_SELECTED_FLOW,
  STEP_TYPES,
} = await import('../src/lib/whatsappFlows.js?t=' + Date.now());

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err instanceof assert.AssertionError) {
      console.error(`    expected: ${JSON.stringify(err.expected)}`);
      console.error(`    actual:   ${JSON.stringify(err.actual)}`);
    }
  }
}

function assertFlowStructure(flow, index) {
  assert.ok(flow, `flow[${index}] should exist`);
  assert.equal(typeof flow.id, 'string', `flow[${index}].id should be a string`);
  assert.equal(typeof flow.name, 'string', `flow[${index}].name should be a string`);
  assert.equal(typeof flow.description, 'string', `flow[${index}].description should be a string`);
  assert.equal(typeof flow.vendor_name, 'string', `flow[${index}].vendor_name should be a string`);
  assert.equal(typeof flow.delay_min_seconds, 'number', `flow[${index}].delay_min_seconds should be a number`);
  assert.equal(typeof flow.delay_max_seconds, 'number', `flow[${index}].delay_max_seconds should be a number`);
  assert.equal(typeof flow.max_images_per_category, 'number', `flow[${index}].max_images_per_category should be a number`);
  assert.equal(typeof flow.default, 'boolean', `flow[${index}].default should be a boolean`);
  assert.ok(Array.isArray(flow.steps), `flow[${index}].steps should be an array`);
  assert.equal(typeof flow.sample_images_text, 'string', `flow[${index}].sample_images_text should be a string`);
}

console.log('\n=== Test 1: Default flows exist and include required IDs ===\n');

test('DEFAULT_WA_FLOWS is an array with 2 flows', () => {
  assert.ok(Array.isArray(DEFAULT_WA_FLOWS));
  assert.equal(DEFAULT_WA_FLOWS.length, 2);
});

test('email-first-contact flow exists and has correct structure', () => {
  const flow = DEFAULT_WA_FLOWS[0];
  assertFlowStructure(flow, 0);
  assert.equal(flow.id, 'email-first-contact');
  assert.equal(flow.name, 'Primeiro contato — pedido veio por e-mail');
  assert.equal(flow.default, true);
});

test('already-talking flow exists and has correct structure', () => {
  const flow = DEFAULT_WA_FLOWS[1];
  assertFlowStructure(flow, 1);
  assert.equal(flow.id, 'already-talking');
  assert.equal(flow.name, 'Já estou falando com o cliente');
  assert.equal(flow.default, false);
});

test('constants are exported correctly', () => {
  assert.equal(LS_WA_FLOWS, 'aspen_wa_flows');
  assert.equal(LS_WA_SELECTED_FLOW, 'aspen_wa_selected_flow');
  assert.equal(STEP_TYPES.TEXT, 'text');
  assert.equal(STEP_TYPES.IMAGE, 'image');
  assert.equal(STEP_TYPES.DOCUMENT, 'document');
  assert.equal(STEP_TYPES.PRODUCT_IMAGES, 'product_images');
});

console.log('\n=== Test 2: flowToSequencePayload ===\n');

test('flowToSequencePayload on already-talking returns correct delay_ms', () => {
  const flow = DEFAULT_WA_FLOWS[1]; // already-talking
  const payload = flowToSequencePayload(flow);
  assert.equal(payload.delay_min_ms, 1000);
  assert.equal(payload.delay_max_ms, 2000);
});

test('flowToSequencePayload on already-talking returns one text step and no document steps (PDF converted to link)', () => {
  const flow = DEFAULT_WA_FLOWS[1];
  const payload = flowToSequencePayload(flow);
  const textSteps = payload.steps.filter(s => s.type === 'text');
  const docSteps = payload.steps.filter(s => s.type === 'document');
  assert.equal(textSteps.length, 1);
  assert.equal(docSteps.length, 0);
});

test('flowToSequencePayload removes empty text/image/document steps', () => {
  const flow = normalizeFlow({
    vendor_name: 'Test',
    delay_min_seconds: 1,
    delay_max_seconds: 2,
    steps: [
      { id: 's1', type: 'text', template: 'Valid message' },
      { id: 's2', type: 'text', template: '' },
      { id: 's3', type: 'text', template: '   ' },
      { id: 's4', type: 'image', media: '' },
      { id: 's5', type: 'document', source: '' },
      { id: 's6', type: 'image', media: 'https://example.com/img.jpg', caption: 'valid image' },
      { id: 's7', type: 'product_images' },
    ],
  });
  const payload = flowToSequencePayload(flow);
  assert.equal(payload.steps.length, 3);
  assert.equal(payload.steps[0].type, 'text');
  assert.equal(payload.steps[0].template, 'Valid message');
  assert.equal(payload.steps[1].type, 'image');
  assert.equal(payload.steps[1].media, 'https://example.com/img.jpg');
  assert.equal(payload.steps[2].type, 'product_images');
});

test('flowToSequencePayload adds vendor_name, max_images_per_category, sample_images', () => {
  const flow = DEFAULT_WA_FLOWS[0]; // email-first-contact
  const payload = flowToSequencePayload(flow);
  assert.equal(payload.vendor_name, flow.vendor_name);
  assert.equal(payload.max_images_per_category, flow.max_images_per_category);
  assert.ok(payload.sample_images !== undefined);
});

test('flowToSequencePayload converts seconds to milliseconds', () => {
  const flow = normalizeFlow({
    vendor_name: 'Test',
    delay_min_seconds: 3,
    delay_max_seconds: 7,
    steps: [{ id: 's1', type: 'text', template: 'Test' }],
  });
  const payload = flowToSequencePayload(flow);
  assert.equal(payload.delay_min_ms, 3000);
  assert.equal(payload.delay_max_ms, 7000);
});

console.log('\n=== Test 3: getFlowSummary ===\n');

test('getFlowSummary for email-first-contact returns correct Portuguese summary', () => {
  const summary = getFlowSummary(DEFAULT_WA_FLOWS[0]);
  // 4 text steps + product_images = "4 mensagens + fotos por produto"
  assert.match(summary, /mensagens?/i);
  assert.match(summary, /fotos/i);
});

test('getFlowSummary for already-talking returns correct Portuguese summary (1 mensagem, no PDF)', () => {
  const summary = getFlowSummary(DEFAULT_WA_FLOWS[1]);
  // 1 text step = "1 mensagem"
  assert.match(summary, /1 mensagem/i);
  assert.ok(!summary.includes('PDF'), 'already-talking should not mention PDF anymore');
});

test('getFlowSummary handles custom step combinations', () => {
  const flow = normalizeFlow({
    vendor_name: 'Test',
    steps: [
      { id: 's1', type: 'text', template: 'a' },
      { id: 's2', type: 'text', template: 'b' },
      { id: 's3', type: 'text', template: 'c' },
      { id: 's4', type: 'document', source: 'quotation_pdf', caption: 'x' },
      { id: 's5', type: 'image', media: 'http://x.jpg' },
    ],
  });
  const summary = getFlowSummary(flow);
  // 3 text + 1 doc + 1 image = "3 mensagens + PDF + 1 imagem"
  assert.match(summary, /3 mensagens?/i);
  assert.match(summary, /PDF/i);
  assert.match(summary, /imagem/i);
});

console.log('\n=== Test 4: renderFlowTemplate ===\n');

test('renderFlowTemplate replaces basic variables', () => {
  const result = renderFlowTemplate(
    'Olá (primeiro_nome)! Seu pedido (numero_pedido) está pronto. A (vendedora) preparou tudo.',
    { primeiro_nome: 'Maria', numero_pedido: 'ORC-123', vendedora: 'Juliana' }
  );
  assert.equal(result, 'Olá Maria! Seu pedido ORC-123 está pronto. A Juliana preparou tudo.');
});

test('renderFlowTemplate replaces all variables including link and product', () => {
  const result = renderFlowTemplate(
    'Segue o orçamento (numero_pedido): (link_orcamento)',
    { numero_pedido: 'ORC-456', link_orcamento: 'https://example.com/456' }
  );
  assert.equal(result, 'Segue o orçamento ORC-456: https://example.com/456');
});

test('renderFlowTemplate replaces (empresa) and (produto_resumo)', () => {
  const result = renderFlowTemplate(
    'A (empresa) agradece! O (produto_resumo) está sendo produzido.',
    { empresa: 'Aspen Cangas', produto_resumo: 'canga personalizada' }
  );
  assert.equal(result, 'A Aspen Cangas agradece! O canga personalizada está sendo produzido.');
});

test('renderFlowTemplate replaces (nome) same as (primeiro_nome)', () => {
  const result = renderFlowTemplate(
    '(Saudacao) (nome)! Tudo bem?',
    { nome: 'Carlos' }
  );
  assert.match(result, /(Bom dia|Boa tarde|Boa noite) Carlos! Tudo bem?/);
});

test('renderFlowTemplate handles (Saudacao) with time-based greeting', () => {
  // We can't control time easily, just check it returns a valid greeting
  const result = renderFlowTemplate('(Saudacao)', {});
  assert.ok(['Bom dia', 'Boa tarde', 'Boa noite'].some(g => result.startsWith(g)));
});

test('renderFlowTemplate keeps unknown variables as-is', () => {
  const result = renderFlowTemplate(
    'Hello (unknown_var)!',
    {}
  );
  assert.equal(result, 'Hello (unknown_var)!');
});

console.log('\n=== Test 5: parseSampleImages ===\n');

test('parseSampleImages parses text format correctly', () => {
  const text = `canga: https://site/canga-01.jpg, https://site/canga-02.jpg
lenço: https://site/lenco-01.jpg`;
  const result = parseSampleImages(text);
  assert.deepEqual(result, {
    canga: ['https://site/canga-01.jpg', 'https://site/canga-02.jpg'],
    'lenço': ['https://site/lenco-01.jpg'],
  });
});

test('parseSampleImages returns empty object for empty input', () => {
  assert.deepEqual(parseSampleImages(''), {});
  assert.deepEqual(parseSampleImages(null), {});
  assert.deepEqual(parseSampleImages(undefined), {});
});

test('parseSampleImages handles whitespace lines', () => {
  const text = `canga: https://site/canga-01.jpg

bolsa: https://site/bolsa-01.jpg
`;
  const result = parseSampleImages(text);
  assert.ok(result.canga);
  assert.ok(result.bolsa);
  assert.equal(result.canga.length, 1);
  assert.equal(result.bolsa.length, 1);
});

console.log('\n=== Test 6: createId and normalizeFlow ===\n');

test('createId returns a string starting with prefix', () => {
  const id = createId('flow');
  assert.ok(id.startsWith('flow_'));
  assert.ok(id.length > 5);
});

test('createId default prefix is flow', () => {
  const id = createId();
  assert.ok(id.startsWith('flow_'));
});

test('normalizeFlow fills missing fields with defaults', () => {
  const raw = { vendor_name: 'Test', steps: [] };
  const flow = normalizeFlow(raw, 0);
  assert.equal(flow.id, 'flow_0');
  assert.equal(flow.name, 'Sequência 1');
  assert.equal(flow.description, '');
  assert.equal(flow.vendor_name, 'Test');
  assert.equal(flow.delay_min_seconds, 1);
  assert.equal(flow.delay_max_seconds, 3);
  assert.equal(flow.max_images_per_category, 0);
  assert.equal(flow.default, false);
  assert.equal(flow.sample_images_text, '');
  assert.ok(Array.isArray(flow.steps));
});

test('normalizeFlow preserves provided fields', () => {
  const raw = {
    id: 'my-custom-flow',
    name: 'Custom Flow',
    vendor_name: 'Maria',
    delay_min_seconds: 10,
    delay_max_seconds: 20,
    steps: [{ id: 's1', type: 'text', template: 'Hi' }],
  };
  const flow = normalizeFlow(raw, 5);
  assert.equal(flow.id, 'my-custom-flow');
  assert.equal(flow.name, 'Custom Flow');
  assert.equal(flow.delay_min_seconds, 10);
  assert.equal(flow.delay_max_seconds, 20);
});

test('normalizeFlow normalizes each step', () => {
  const raw = { vendor_name: 'Test', steps: [{ type: 'text' }] };
  const flow = normalizeFlow(raw);
  assert.ok(flow.steps[0].id);
  assert.equal(flow.steps[0].type, 'text');
  assert.equal(flow.steps[0].template, '');
});

test('loadWhatsappFlows and saveWhatsappFlows use localStorage with fallback', () => {
  // In Node, localStorage doesn't exist, so it should fall back to DEFAULT_WA_FLOWS
  const flows = loadWhatsappFlows();
  assert.ok(Array.isArray(flows));
  assert.equal(flows.length, 2);
  // Should not mutate the default
  assert.notEqual(flows, DEFAULT_WA_FLOWS);
});

test('getSelectedFlowId returns first flow when nothing is saved', () => {
  const flows = loadWhatsappFlows();
  const id = getSelectedFlowId(flows);
  assert.equal(id, flows[0].id);
});

test('saveSelectedFlowId handles localStorage being unavailable', () => {
  // Should not throw
  saveSelectedFlowId('test-id');
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) process.exit(1);
