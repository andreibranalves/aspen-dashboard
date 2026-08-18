import assert from 'node:assert/strict';
import { DEFAULT_WA_FLOWS, flowToSequencePayload } from '../src/lib/api/whatsappFlows.ts';

process.env.EVOLUTION_BASE_URL = 'https://evolution.example.test';
process.env.EVOLUTION_API_KEY = 'test-key';
process.env.EVOLUTION_INSTANCE = 'Ursinho';

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Resposta JSON inválida do handler WhatsApp.', { cause: error });
  }
}

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), body: parseJson(options.body || '{}') });
  return new globalThis.Response(JSON.stringify({ ok: true, id: `msg-${calls.length}` }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { handler } = await import('../api/modules/send-whatsapp.js?test=' + Date.now());

const basePayload = {
  dry_run: true,
  telefone: '(21) 99999-9999',
  nome: 'Labo Buriti',
  quotation_id: 'ORC-20261289',
  link_orcamento: 'https://project-xr5jg.vercel.app/api/view?q=ORC-20261289',
  items: [{ sku: 'CNG-SAL-70', qty: 50 }, { sku: 'CNG-SAL-100', qty: 50 }],
};

// ── Existing test (hardcoded payload) ──────────────────────────────────────

const payload = {
  ...basePayload,
  whatsapp_sequence: {
    delay_min_ms: 10,
    delay_max_ms: 20,
    vendor_name: 'Juliana',
    max_images_per_category: 2,
    sample_images: {
      canga: [
        'https://project-xr5jg.vercel.app/whatsapp-samples/canga-01.jpg',
        'https://project-xr5jg.vercel.app/whatsapp-samples/canga-02.jpg',
      ],
    },
    steps: [
      { type: 'text', template: 'Olá, (primeiro_nome), tudo bem?' },
      { type: 'text', template: 'Meu nome é (vendedora), da (empresa). Estou entrando em contato sobre o seu orçamento de (produto_resumo) personalizado(a).' },
      { type: 'text', template: 'Segue o orçamento (numero_pedido):\n(link_orcamento)' },
      { type: 'product_images' },
    ],
  },
};

const res = await handler({
  httpMethod: 'POST',
  headers: { host: 'project-xr5jg.vercel.app', 'x-forwarded-proto': 'https' },
  body: JSON.stringify(payload),
  queryStringParameters: {},
});

assert.equal(res.statusCode, 200);
const body = parseJson(res.body);
assert.equal(body.success, true);
assert.equal(body.dry_run, true);
assert.equal(calls.length, 0, 'dry_run não deve chamar a Evolution API');
assert.equal(body.number, '5521999999999');
assert.equal(body.steps.length, 5);
assert.deepEqual(body.steps.map(step => step.type), ['text', 'text', 'text', 'image', 'image']);
assert.match(body.steps[1].text, /Juliana/);
assert.match(body.steps[1].text, /canga/i);
assert.equal(body.steps[3].media, 'https://project-xr5jg.vercel.app/whatsapp-samples/canga-01.jpg');
assert.equal(body.delay_min_ms, 10);
assert.equal(body.delay_max_ms, 20);

console.log('whatsapp sequence dry-run ok');

// ── Test A: First-contact flow dry-run ─────────────────────────────────────

calls.length = 0;

const firstContactFlow = DEFAULT_WA_FLOWS.find((flow) => flow.id === 'email-first-contact');
assert.ok(firstContactFlow, 'fluxo email-first-contact ausente');
const firstContactPayload = {
  ...basePayload,
  whatsapp_sequence: flowToSequencePayload(firstContactFlow),
};

const resA = await handler({
  httpMethod: 'POST',
  headers: { host: 'project-xr5jg.vercel.app', 'x-forwarded-proto': 'https' },
  body: JSON.stringify(firstContactPayload),
  queryStringParameters: {},
});

assert.equal(resA.statusCode, 200);
const bodyA = parseJson(resA.body);
assert.equal(bodyA.success, true);
assert.equal(bodyA.dry_run, true);
assert.equal(calls.length, 0, 'dry_run não deve chamar a Evolution API');
assert.equal(bodyA.number, '5521999999999');

// 4 text steps (product_images expands to nothing since sample_images_text is empty)
assert.equal(bodyA.steps.length, 4);
assert.ok(bodyA.steps.every(s => s.type === 'text'), 'fluxo email-first-contact deve gerar apenas steps de texto');
assert.match(bodyA.steps[1].text, /Juliana/);
assert.match(bodyA.steps[1].text, /canga/i);
assert.equal(bodyA.delay_min_ms, 5000);
assert.equal(bodyA.delay_max_ms, 8000);

console.log('whatsapp first-contact flow dry-run ok');

// ── Test B: Already-talking flow dry-run ───────────────────────────────────

calls.length = 0;

const alreadyTalkingFlow = DEFAULT_WA_FLOWS.find((flow) => flow.id === 'already-talking');
assert.ok(alreadyTalkingFlow, 'fluxo already-talking ausente');
const alreadyTalkingPayload = {
  ...basePayload,
  whatsapp_sequence: flowToSequencePayload(alreadyTalkingFlow),
  pdf_url: 'https://example.test/orcamento.pdf',
};

const resB = await handler({
  httpMethod: 'POST',
  headers: { host: 'project-xr5jg.vercel.app', 'x-forwarded-proto': 'https' },
  body: JSON.stringify(alreadyTalkingPayload),
  queryStringParameters: {},
});

assert.equal(resB.statusCode, 200);
const bodyB = parseJson(resB.body);
assert.equal(bodyB.success, true);
assert.equal(bodyB.dry_run, true);
assert.equal(calls.length, 0, 'dry_run não deve chamar a Evolution API');
assert.equal(bodyB.number, '5521999999999');

// Greeting plus the configured quotation PDF document.
assert.equal(bodyB.steps.length, 2);
assert.deepEqual(bodyB.steps.map(s => s.type), ['text', 'document']);
assert.equal(bodyB.delay_min_ms, 1000);
assert.equal(bodyB.delay_max_ms, 2000);

console.log('whatsapp already-talking flow dry-run ok');
