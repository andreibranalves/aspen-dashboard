import assert from 'node:assert/strict';

process.env.EVOLUTION_BASE_URL = 'https://evolution.example.test';
process.env.EVOLUTION_API_KEY = 'test-key';
process.env.EVOLUTION_INSTANCE = 'Ursinho';

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), body: JSON.parse(options.body || '{}') });
  return {
    ok: true,
    status: 200,
    async json() {
      return { ok: true, id: `msg-${calls.length}` };
    },
  };
};

const { handler } = await import('../netlify/functions/send-whatsapp.js?test=' + Date.now());

const payload = {
  dry_run: true,
  telefone: '(21) 99999-9999',
  nome: 'Labo Buriti',
  quotation_id: 'ORC-20261289',
  link_orcamento: 'https://aspen-orcamento.netlify.app/api/view?q=ORC-20261289',
  items: [{ sku: 'CNG-SAL-70', qty: 50 }, { sku: 'CNG-SAL-100', qty: 50 }],
  whatsapp_sequence: {
    delay_min_ms: 10,
    delay_max_ms: 20,
    vendor_name: 'Juliana',
    max_images_per_category: 2,
    sample_images: {
      canga: [
        'https://aspen-orcamento.netlify.app/whatsapp-samples/canga-01.jpg',
        'https://aspen-orcamento.netlify.app/whatsapp-samples/canga-02.jpg',
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
  headers: { host: 'aspen-orcamento.netlify.app', 'x-forwarded-proto': 'https' },
  body: JSON.stringify(payload),
  queryStringParameters: {},
});

assert.equal(res.statusCode, 200);
const body = JSON.parse(res.body);
assert.equal(body.success, true);
assert.equal(body.dry_run, true);
assert.equal(calls.length, 0, 'dry_run não deve chamar a Evolution API');
assert.equal(body.number, '5521999999999');
assert.equal(body.steps.length, 5);
assert.deepEqual(body.steps.map(step => step.type), ['text', 'text', 'text', 'image', 'image']);
assert.match(body.steps[1].text, /Juliana/);
assert.match(body.steps[1].text, /canga/i);
assert.equal(body.steps[3].media, 'https://aspen-orcamento.netlify.app/whatsapp-samples/canga-01.jpg');
assert.equal(body.delay_min_ms, 10);
assert.equal(body.delay_max_ms, 20);

console.log('whatsapp sequence dry-run ok');
