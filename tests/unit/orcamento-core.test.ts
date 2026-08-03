import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHandler } from '../../api/_functions/orcamento.js';
import { createCoreHandler } from '../../api/_functions/orcamento-core.js';
import { createLegacyHandler } from '../../api/_functions/orcamento-legacy.js';
import { QuoteDraftInputError } from '../../api/_db/quote-repository.js';

function event(body: unknown) {
  return {
    httpMethod: 'POST',
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
  } as const;
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, unknown>;
}

const draft = {
  success: true as const,
  quotation_id: 'ORC-20260001',
  quotation_name: 'ORC-20260001',
  quote_id: '11111111-1111-4111-8111-111111111111',
  revision_id: '22222222-2222-4222-8222-222222222222',
  revision_number: 1,
  status: 'rascunho' as const,
  cliente: 'Cliente Teste',
  items: [],
  subtotal: '0.00',
  frete: '0.00',
  total: '0.00',
};

test('quote core validates the envelope and annotates successful drafts', async () => {
  let received: Record<string, unknown> | undefined;
  const handler = createCoreHandler({
    repository: {
      createDraft: async (input) => {
        received = input as Record<string, unknown>;
        return draft;
      },
    },
  });

  const invalidJson = await handler({ ...event({}), body: '{' });
  assert.equal(invalidJson.statusCode, 400);
  assert.deepEqual(parse(invalidJson), {
    error: 'JSON inválido.',
    core_mode: true,
    source: 'postgres',
  });

  const missing = await handler(event({}));
  assert.equal(missing.statusCode, 400);
  assert.equal(parse(missing).core_mode, true);

  const result = await handler(event({
    extracted: {
      client_id: '33333333-3333-4333-8333-333333333333',
      items: [{ item_code: 'SKU-1', qty: '30.000', rate: '9.00', manual_rate: false }],
    },
  }));
  assert.equal(result.statusCode, 201);
  assert.equal(parse(result).quotation_name, 'ORC-20260001');
  assert.equal(parse(result).source, 'postgres');
  assert.equal(received?.client_id, '33333333-3333-4333-8333-333333333333');
  const receivedItems = received?.items as Array<Record<string, unknown>>;
  assert.equal(receivedItems[0]?.rate, '9.00');
  assert.equal(receivedItems[0]?.manual_rate, false);
});

test('quote core maps safe validation errors without exposing driver details', async () => {
  const handler = createCoreHandler({
    repository: {
      createDraft: async () => {
        throw new QuoteDraftInputError('Quantidade do item 1 deve ser maior que zero.');
      },
    },
  });
  const result = await handler(event({ extracted: { items: [] } }));
  assert.equal(result.statusCode, 400);
  assert.equal(parse(result).error, 'Quantidade do item 1 deve ser maior que zero.');
  assert.equal(parse(result).core_mode, true);
  assert.equal(String(result.body).includes('SQL'), false);
});

test('quote core does not trust structural status codes from unknown errors', async () => {
  const driverError = Object.assign(
    new Error('SQL connection failed for postgres://user:secret@db.internal/quotes'),
    { statusCode: 400 },
  );
  const handler = createCoreHandler({
    repository: {
      createDraft: async () => {
        throw driverError;
      },
    },
  });
  const result = await handler(event({ extracted: { items: [] } }));
  const body = parse(result);
  assert.equal(result.statusCode, 503);
  assert.equal(body.error, 'Não foi possível salvar o rascunho do orçamento. Tente novamente.');
  assert.equal(String(result.body).includes('SQL'), false);
  assert.equal(String(result.body).includes('secret'), false);
});

test('legacy boundary promotes displayed rates without mutating the request', async () => {
  let receivedItems: Array<Record<string, unknown>> | undefined;
  const originalItems = [
    { item_code: 'AUTO-1', qty: 30, rate: '9.00', manual_rate: false },
    { item_code: 'AUTO-DECIMAL', qty: 30, rate: 9.25, manual_rate: false },
    { item_code: 'NO-RATE', qty: 30, manual_rate: false },
    { item_code: 'ZERO-RATE', qty: 30, rate: '0.00', manual_rate: false },
    { item_code: 'NEGATIVE-RATE', qty: 30, rate: -1.5, manual_rate: false },
    { item_code: 'INVALID-QTY', qty: 0, rate: '3.00', manual_rate: false },
  ];
  const handler = createLegacyHandler({
    runQuotePipeline: async (_event, extracted) => {
      receivedItems = extracted.items as Array<Record<string, unknown>>;
      return {
        success: true,
        quotation_id: 'QUO-0001',
        deal_id: 'DEAL-0001',
        cliente: 'Cliente legado',
        pdf_url: 'https://example.test/quote.pdf',
      };
    },
  });

  const result = await handler(event({
    extracted: { nome: 'Cliente legado', items: originalItems },
  }));

  assert.equal(result.statusCode, 200);
  assert.equal(parse(result).source, 'frappe');
  assert.deepEqual(receivedItems, [
    { item_code: 'AUTO-1', qty: 30, rate: '9.00', manual_rate: true },
    { item_code: 'AUTO-DECIMAL', qty: 30, rate: 9.25, manual_rate: true },
    { item_code: 'NO-RATE', qty: 30, manual_rate: false },
    { item_code: 'ZERO-RATE', qty: 30, rate: '0.00', manual_rate: false },
    { item_code: 'NEGATIVE-RATE', qty: 30, rate: -1.5, manual_rate: false },
    { item_code: 'INVALID-QTY', qty: 0, rate: '3.00', manual_rate: false },
  ]);
  assert.equal(originalItems[0].manual_rate, false);
});

test('quote rollout uses exact flag and never falls back after a core failure', async () => {
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  const calls: string[] = [];
  const core = async () => {
    calls.push('core');
    return { statusCode: 503, body: JSON.stringify({ error: 'falha core' }) };
  };
  const legacy = async () => {
    calls.push('legacy');
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  };
  const handler = createHandler({ core, legacy });

  try {
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    assert.equal((await handler(event({ extracted: {} }))).statusCode, 503);
    assert.deepEqual(calls, ['core']);
    calls.length = 0;

    process.env.CRM_CORE_QUOTES_ENABLED = 'TRUE';
    assert.equal((await handler(event({ extracted: {} }))).statusCode, 200);
    assert.deepEqual(calls, ['legacy']);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
  }
});
