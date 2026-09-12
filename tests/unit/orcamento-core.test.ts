import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHandler } from '../../api/_modules/orcamento.js';
import { createCoreHandler } from '../../api/_modules/orcamento-core.js';
import {
  QuoteDraftInputError,
  readSelectedTemplate,
  type TemplateSelectionLookup,
} from '../../api/_infrastructure/db/repositories/quote-repository.js';
import { HISTORICAL_QUOTATION_TEMPLATES } from '../../api/_modules/quotation-template-catalog.js';

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
  quotation_uuid: '11111111-1111-4111-8111-111111111111',
  revision_id: '22222222-2222-4222-8222-222222222222',
  quote_revision_id: '22222222-2222-4222-8222-222222222222',
  revision: 1,
  revision_number: 1,
  status: 'rascunho' as const,
  cliente: 'Cliente Teste',
  cliente_id: '33333333-3333-4333-8333-333333333333',
  cliente_snapshot: {
    id: '33333333-3333-4333-8333-333333333333',
    nome: 'Cliente Teste',
    documento: null,
    email: null,
    telefone: null,
    notes: null,
    address: null,
  },
  items: [],
  subtotal: '0.00',
  frete: '0.00',
  total: '0.00',
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  observacoes: '',
  prazo_producao: '',
  template_padrao: 'padrao',
  template_key: 'padrao',
  template_hash: '0'.repeat(64),
  template_version_id: '44444444-4444-4444-8444-444444444444',
  secoes: {
    schema_version: 1 as const,
    prazo_producao: {
      base: { enabled: true, title: 'Prazo de produção' },
      current: { enabled: true, title: 'Prazo de produção' },
    },
    pagamento: {
      base: { enabled: true, title: 'Pagamento', body: '' },
      current: { enabled: true, title: 'Pagamento', body: '' },
    },
    condicoes_gerais: {
      base: { enabled: true, title: 'Condições Gerais', body: '' },
      current: { enabled: true, title: 'Condições Gerais', body: '' },
    },
  },
  created_at: '2026-07-01T12:00:00.000Z',
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
  assert.deepEqual(parse(invalidJson), { error: 'JSON inválido.' });

  const missing = await handler(event({}));
  assert.equal(missing.statusCode, 400);
  assert.equal(Object.keys(parse(missing)).some((key) => key.endsWith('_mode')), false);

  const result = await handler(event({
    extracted: {
      client_id: '33333333-3333-4333-8333-333333333333',
      template_key: 'minimalista',
      template_version_id: '44444444-4444-4444-8444-444444444444',
      secoes: {
        schema_version: 1,
        pagamento: { enabled: true, title: 'Pagamento', body: 'PIX' },
      },
      items: [{ item_code: 'SKU-1', item_name: 'Lenço 100 x 100 cm', qty: '30.000', rate: '9.00', manual_rate: false }],
    },
  }));
  assert.equal(result.statusCode, 201);
  assert.equal(parse(result).quotation_id, 'ORC-20260001');
  assert.equal(parse(result).quotation_uuid, '11111111-1111-4111-8111-111111111111');
  assert.equal(parse(result).revision_id, '22222222-2222-4222-8222-222222222222');
  // #126: nomes duplicados não são emitidos na resposta.
  for (const alias of ['quote_id', 'quote_revision_id', 'revision_number', 'quotation_name']) {
    assert.equal(Object.prototype.hasOwnProperty.call(parse(result), alias), false, `alias ${alias} removido da resposta`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(parse(result), 'source'), false);
  assert.equal(received?.client_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(received?.template_key, 'minimalista');
  assert.equal(received?.template_version_id, '44444444-4444-4444-8444-444444444444');
  assert.equal((received?.secoes as Record<string, unknown>).pagamento !== undefined, true);
  const receivedItems = received?.items as Array<Record<string, unknown>>;
  assert.equal(receivedItems[0]?.rate, '9.00');
  assert.equal(receivedItems[0]?.manual_rate, false);
  assert.equal(receivedItems[0]?.item_name, 'Lenço 100 x 100 cm');
});

const settings = {
  validade_dias: 15,
  pagamento: 'Pagamento padrão',
  entrega: 'Entrega padrão',
  frete_padrao: '0.00',
  observacoes: 'Observações padrão',
  template_padrao: 'padrao',
  secoes: {} as never,
};

function selectionLookup(overrides: Partial<TemplateSelectionLookup> = {}) {
  const templates = new Map([
    ['padrao', { model: { id: 'model-default', key: 'padrao', name: 'Padrão', archived: false }, version: { id: '11111111-1111-4111-8111-111111111111', version: 1, source: 'default', sourceHash: 'a'.repeat(64) } }],
    ['minimalista', { model: { id: 'model-min', key: 'minimalista', name: 'Minimalista', archived: false }, version: { id: '22222222-2222-4222-8222-222222222222', version: 1, source: 'minimal', sourceHash: 'b'.repeat(64) } }],
    ['arquivado', { model: { id: 'model-archived', key: 'arquivado', name: 'Arquivado', archived: true }, version: { id: '33333333-3333-4333-8333-333333333333', version: 1, source: 'archived', sourceHash: 'c'.repeat(64) } }],
  ]);
  const versions = new Map([...templates.values()].map((value) => [value.version.id, value]));
  return {
    byVersion: async (id: string) => versions.get(id) || null,
    current: async (selection: string | { id: string }) => typeof selection === 'string' ? templates.get(selection) || null : [...templates.values()].find((value) => value.model.id === selection.id) || null,
    seedLegacy: async () => null,
    ...overrides,
  } satisfies TemplateSelectionLookup;
}

test('repository template selection rejects inconsistent, archived and missing choices', async () => {
  const lookup = selectionLookup();
  assert.equal((await readSelectedTemplate({} as never, settings, { template_version_id: '22222222-2222-4222-8222-222222222222', template_key: 'padrao' }, lookup)), null);
  assert.equal((await readSelectedTemplate({} as never, settings, { template_version_id: '33333333-3333-4333-8333-333333333333' }, lookup)), null);
  assert.equal((await readSelectedTemplate({} as never, settings, { template_key: 'missing' }, lookup)), null);
  assert.equal((await readSelectedTemplate({} as never, settings, { template_key: 'minimalista' }, lookup))?.version.id, '22222222-2222-4222-8222-222222222222');
  assert.equal((await readSelectedTemplate({} as never, settings, {}, lookup))?.model.key, 'padrao');
});

test('repository template selection seeds a missing static template', async () => {
  let seeded: string | undefined;
  const lookup = selectionLookup({
    current: async () => null,
    seedLegacy: async (legacy) => {
      seeded = legacy.key;
      return { model: { id: 'seed-model', key: legacy.key, name: legacy.name, archived: false }, version: { id: 'seed-version', version: 1, source: legacy.source, sourceHash: legacy.hash } };
    },
  });
  const selected = await readSelectedTemplate({} as never, settings, {}, lookup);
  assert.equal(seeded, 'padrao');
  assert.equal(selected?.version.id, 'seed-version');
  assert.equal(selected?.version.sourceHash.length, 64);
});

test('repository template selection upgrades only the exact official historical source', async () => {
  const historical = HISTORICAL_QUOTATION_TEMPLATES.find((template) => template.key === 'padrao')!;
  let seeded: string | undefined;
  const lookup = selectionLookup({
    current: async () => ({
      model: { id: 'historical-model', key: 'padrao', name: historical.name, archived: false },
      version: {
        id: 'historical-version',
        version: 1,
        source: historical.source,
        sourceHash: historical.hash,
        contractVersion: 1,
      },
    }),
    seedLegacy: async (legacy) => {
      seeded = legacy.key;
      return { model: { id: 'v2-model', key: legacy.key, name: legacy.name, archived: false }, version: { id: 'v2-version', version: 2, source: legacy.source, sourceHash: legacy.hash, contractVersion: 2 } };
    },
  });
  const selected = await readSelectedTemplate({} as never, settings, {}, lookup);
  assert.equal(seeded, 'padrao');
  assert.equal(selected?.version.id, 'v2-version');
});

test('repository template selection preserves custom versions under official keys', async () => {
  const custom = {
    model: { id: 'custom-model', key: 'padrao', name: 'Padrão customizado', archived: false },
    version: {
      id: 'custom-version',
      version: 2,
      source: '<!doctype html><html><body>custom</body></html>',
      sourceHash: 'c'.repeat(64),
      contractVersion: 2,
    },
  };
  const lookup = selectionLookup({
    current: async () => custom,
    seedLegacy: async () => {
      throw new Error('custom version must not be replaced');
    },
  });
  assert.equal((await readSelectedTemplate({} as never, settings, {}, lookup))?.version.id, 'custom-version');
});

test('quote core forwards the demand link or the new-demand intent', async () => {
  const received: Array<Record<string, unknown>> = [];
  const handler = createCoreHandler({
    repository: {
      createDraft: async (input) => {
        received.push(input as Record<string, unknown>);
        return draft;
      },
    },
  });

  const opportunityId = '55555555-5555-4555-8555-555555555555';
  const linked = await handler(
    event({ extracted: { client_id: draft.cliente_id, opportunity_id: opportunityId, items: [] } })
  );
  assert.equal(linked.statusCode, 201);
  assert.equal(received[0].opportunity_id, opportunityId);

  const created = await handler(
    event({ extracted: { client_id: draft.cliente_id, new_demand: true, demand_summary: 'Cangas 100', items: [] } })
  );
  assert.equal(created.statusCode, 201);
  assert.equal(received[1].new_demand, true);
  assert.equal(received[1].demand_summary, 'Cangas 100');
});

test('quote core maps invalid template selection to 400', async () => {
  const handler = createCoreHandler({
    repository: {
      createDraft: async () => {
        throw new QuoteDraftInputError('Template do orçamento inválido.');
      },
    },
  });
  const result = await handler(event({ extracted: { template_key: 'arquivado' } }));
  assert.equal(result.statusCode, 400);
  assert.equal(parse(result).error, 'Template do orçamento inválido.');
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
  assert.equal(Object.keys(parse(result)).some((key) => key.endsWith('_mode')), false);
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

test('quote boundary always invokes the PostgreSQL core', async () => {
  let calls = 0;
  const handler = createHandler({
    core: async () => {
      calls += 1;
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    },
  });
  const result = await handler(event({ extracted: {} }));
  assert.equal(result.statusCode, 200);
  assert.equal(calls, 1);
});
