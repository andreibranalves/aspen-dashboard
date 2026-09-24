import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createExtractHandler, handler } from '../../api/_modules/extract.js';
import {
  OrderTemplateConflictError,
  OrderTemplateNotFoundError,
} from '../../api/_infrastructure/db/repositories/order-template-repository.js';

function event(method: string, body: unknown) {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
  };
}

const template = {
  id: 'pack-id',
  name: 'Pack',
  archived: false,
  created_at: '2026-08-11T00:00:00.000Z',
  updated_at: '2026-08-11T00:00:00.000Z',
  items: [
    { sku: 'SKU-A', name: 'A', position: 0 },
    { sku: 'SKU-B', name: 'B', position: 1 },
  ],
};

test('extract rejects unsupported methods with a Portuguese JSON error', async () => {
  const result = await handler(event('GET', {}));

  assert.equal(result.statusCode, 405);
  assert.equal(result.headers?.['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(result.body || ''), { error: 'Método não permitido.' });
});

test('extract with a selected template expands quantities and ignores model SKUs', async () => {
  let lookedUpId = '';
  let extractedTemplate: unknown;
  const selectedHandler = createExtractHandler({
    orderTemplates: {
      getForExtraction: async (id: string) => {
        lookedUpId = id;
        return template;
      },
    },
    extractOrders: async (...args: unknown[]) => {
      extractedTemplate = args[5];
      return [
        {
          nome: 'Cliente',
          items: [
            { item_code: 'MODEL-SKU', qty: 300 },
            { item_code: 'ANOTHER-MODEL-SKU', qty: 500 },
          ],
        },
      ];
    },
  });

  const result = await selectedHandler(
    event('POST', {
      text: 'Cliente quer 300 e 500 unidades de produto livre.',
      orderTemplateId: ' pack-id ',
    })
  );

  assert.equal(result.statusCode, 200);
  assert.equal(lookedUpId, 'pack-id');
  assert.deepEqual(extractedTemplate, template);
  assert.deepEqual(JSON.parse(result.body || '').orders[0].items, [
    { item_code: 'SKU-A', qty: 300 },
    { item_code: 'SKU-B', qty: 300 },
    { item_code: 'SKU-A', qty: 500 },
    { item_code: 'SKU-B', qty: 500 },
  ]);
});

test('extract expands multiple inline templates with their own quantities', async () => {
  const templates = {
    cangas: { ...template, id: 'cangas', items: [{ sku: 'CNG-1', name: 'Canga', position: 0 }] },
    lencos: { ...template, id: 'lencos', items: [{ sku: 'LNC-1', name: 'Lenço', position: 0 }] },
  };
  const selectedHandler = createExtractHandler({
    orderTemplates: {
      getForExtraction: async (id: string) => templates[id as keyof typeof templates],
    },
    extractOrders: async () => [{ nome: 'Andrei', items: [] }],
  });

  const result = await selectedHandler(event('POST', {
    text: 'Andrei andrei@gmail.com 30 @cangas e 50 @lencos',
    orderTemplateSelections: [
      { id: 'cangas', quantity: 30 },
      { id: 'lencos', quantity: 50 },
    ],
  }));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '').orders[0].items, [
    { item_code: 'CNG-1', qty: 30 },
    { item_code: 'LNC-1', qty: 50 },
  ]);
});

test('extract validates inline template quantities and prevents mixed modes', async () => {
  const selectedHandler = createExtractHandler({
    orderTemplates: { getForExtraction: async () => template },
    extractOrders: async () => [],
  });

  const invalid = await selectedHandler(event('POST', {
    text: 'Cliente',
    orderTemplateSelections: [{ id: 'pack-id', quantity: 0 }],
  }));
  assert.equal(invalid.statusCode, 400);

  const mixed = await selectedHandler(event('POST', {
    text: 'Cliente',
    orderTemplateId: 'pack-id',
    orderTemplateSelections: [{ id: 'pack-id', quantity: 30 }],
  }));
  assert.equal(mixed.statusCode, 400);
});

test('extract returns 422 instead of inventing a quantity from a boolean', async () => {
  const selectedHandler = createExtractHandler({
    orderTemplates: { getForExtraction: async () => template },
    extractOrders: async () => [
      {
        nome: 'Cliente',
        items: [{ item_code: 'MODEL-SKU', qty: true as unknown as number }],
      },
    ],
  });

  const result = await selectedHandler(
    event('POST', { text: 'Cliente sem quantidade válida.', orderTemplateId: 'pack-id' })
  );

  assert.equal(result.statusCode, 422);
  assert.equal(
    JSON.parse(result.body || '').error,
    'Nenhuma quantidade válida identificada para o template.'
  );
});

test('extract returns public errors for missing or archived templates', async () => {
  const missingHandler = createExtractHandler({
    orderTemplates: {
      getForExtraction: async () => {
        throw new OrderTemplateNotFoundError('Template de pedido não encontrado.');
      },
    },
    extractOrders: async () => [],
  });
  const missing = await missingHandler(
    event('POST', {
      text: 'Cliente quer 300 unidades.',
      orderTemplateId: 'missing',
    })
  );
  assert.equal(missing.statusCode, 404);
  assert.equal(JSON.parse(missing.body || '').error, 'Template de pedido não encontrado.');

  const archivedHandler = createExtractHandler({
    orderTemplates: {
      getForExtraction: async () => {
        throw new OrderTemplateConflictError('O template de pedido selecionado foi arquivado.');
      },
    },
    extractOrders: async () => [],
  });
  const archived = await archivedHandler(
    event('POST', {
      text: 'Cliente quer 300 unidades.',
      orderTemplateId: 'archived',
    })
  );
  assert.equal(archived.statusCode, 409);
  assert.equal(
    JSON.parse(archived.body || '').error,
    'O template de pedido selecionado foi arquivado.'
  );
});

test('extract without a template skips repository lookup and keeps the extractor contract', async () => {
  let lookups = 0;
  let receivedArgs: unknown[] = [];
  const noTemplateHandler = createExtractHandler({
    orderTemplates: {
      getForExtraction: async () => {
        lookups += 1;
        throw new Error('template lookup should not run');
      },
    },
    extractOrders: async (...args: unknown[]) => {
      receivedArgs = args;
      return [{ nome: 'Cliente', items: [{ item_code: 'MODEL-SKU', qty: 30 }] }];
    },
  });

  const result = await noTemplateHandler(event('POST', { text: '30 unidades.' }));

  assert.equal(result.statusCode, 200);
  assert.equal(lookups, 0);
  assert.equal(receivedArgs.length, 5);
  assert.deepEqual(JSON.parse(result.body || '').orders[0].items, [
    { item_code: 'MODEL-SKU', qty: 30 },
  ]);
});

test('extract normalizes provider fields and applies the minimum quantity', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.OPENROUTER_MODEL;
  const previousFetch = globalThis.fetch;

  process.env.OPENROUTER_API_KEY = 'unit-test-key';
  process.env.OPENROUTER_MODEL = 'unit-test/model';
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: '[{"nome":"Cliente","empresa":"  Silva Eventos  ","prazo_pedido":"  preciso para 12/12  ","items":[{"item_code":" SKU-1 ","qty":"10"}]}]',
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;

  try {
    const result = await handler(event('POST', { text: 'Cliente precisa de 10 unidades.' }));

    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body || ''), {
      orders: [{ nome: 'Cliente', empresa: 'Silva Eventos', prazo_pedido: 'preciso para 12/12', items: [{ item_code: 'SKU-1', qty: 30 }] }],
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previousModel;
  }
});

test('extract rejects malformed provider items instead of forwarding them', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.OPENROUTER_MODEL;
  const previousFetch = globalThis.fetch;

  process.env.OPENROUTER_API_KEY = 'unit-test-key';
  process.env.OPENROUTER_MODEL = 'unit-test/model';
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [
        { message: { content: '[{"nome":"Cliente","items":[{"item_code":"SKU-1","qty":true}]}]' } },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;

  try {
    const result = await handler(event('POST', { text: 'Pedido inválido.' }));

    assert.equal(result.statusCode, 502);
    assert.equal(JSON.parse(result.body || '').error, 'Resposta inválida do provedor de IA.');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previousModel;
  }
});

test('extract rejects non-object request payloads with a client error', async () => {
  const result = await handler(event('POST', null));

  assert.equal(result.statusCode, 400);
  assert.equal(JSON.parse(result.body || '').error, 'Envie um payload válido.');
});

test('extract validates the OpenRouter request and normalizes its JSON response', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.OPENROUTER_MODEL;
  const previousSiteUrl = process.env.OPENROUTER_SITE_URL;
  const previousFetch = globalThis.fetch;
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  process.env.OPENROUTER_API_KEY = 'unit-test-key';
  process.env.OPENROUTER_MODEL = 'unit-test/model';
  process.env.OPENROUTER_SITE_URL = 'https://app.example';
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: '[{"nome":"Cliente","items":[{"item_code":"SKU-1","qty":30}]}]' } },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const result = await handler(
      event('POST', { text: 'Cliente precisa de 30 unidades do SKU-1.' })
    );
    const requestBody = JSON.parse(String(requestInit?.body));

    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body || ''), {
      orders: [{ nome: 'Cliente', items: [{ item_code: 'SKU-1', qty: 30 }] }],
    });
    assert.equal(requestUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(
      (requestInit?.headers as Record<string, string>).Authorization,
      'Bearer unit-test-key'
    );
    assert.equal(
      (requestInit?.headers as Record<string, string>)['X-OpenRouter-Title'],
      'Aspen Orcamento App'
    );
    assert.equal(
      (requestInit?.headers as Record<string, string>)['HTTP-Referer'],
      'https://app.example'
    );
    assert.equal(requestBody.model, 'unit-test/model');
    assert.equal(requestBody.messages[0].role, 'system');
    assert.equal(requestBody.messages[1].content, 'Cliente precisa de 30 unidades do SKU-1.');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previousModel;
    if (previousSiteUrl === undefined) delete process.env.OPENROUTER_SITE_URL;
    else process.env.OPENROUTER_SITE_URL = previousSiteUrl;
  }
});
