import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  type QuotationEmailTemplate,
} from '../../api/_shared/quotation-email-template.js';
import { createHandler } from '../../api/_modules/quotation-email-template.js';

function event(method: string, body?: unknown) {
  return {
    httpMethod: method,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
  };
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, unknown>;
}

function repository(overrides: Partial<{
  get: () => Promise<QuotationEmailTemplate>;
  save: (value: QuotationEmailTemplate) => Promise<QuotationEmailTemplate>;
}> = {}) {
  return {
    get: async () => ({ ...DEFAULT_QUOTATION_EMAIL_TEMPLATE }),
    save: async (value: QuotationEmailTemplate) => value,
    ...overrides,
  };
}

test('GET returns the effective template', async () => {
  const handler = createHandler({ repository: repository() });
  const result = await handler(event('GET'));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(parse(result), DEFAULT_QUOTATION_EMAIL_TEMPLATE);
});

test('PUT returns the normalized saved template', async () => {
  let saved: QuotationEmailTemplate | undefined;
  const handler = createHandler({
    repository: repository({
      save: async value => {
        saved = value;
        return value;
      },
    }),
  });
  const result = await handler(event('PUT', {
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    subject: '  Proposta {{numero_orcamento}}  ',
    message: 'Linha 1\r\nLinha 2',
  }));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(saved, {
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    subject: 'Proposta {{numero_orcamento}}',
    message: 'Linha 1\nLinha 2',
  });
  assert.deepEqual(parse(result), saved);
});

test('PUT rejects invalid JSON before saving', async () => {
  let saves = 0;
  const handler = createHandler({
    repository: repository({
      save: async value => {
        saves += 1;
        return value;
      },
    }),
  });
  const result = await handler({
    ...event('PUT'),
    body: '{invalid',
  });

  assert.equal(result.statusCode, 400);
  assert.deepEqual(parse(result), { error: 'JSON inválido.' });
  assert.equal(saves, 0);
});

test('PUT returns field errors and does not save invalid templates', async () => {
  let saves = 0;
  const handler = createHandler({
    repository: repository({
      save: async value => {
        saves += 1;
        return value;
      },
    }),
  });
  const result = await handler(event('PUT', {
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    message: 'Olá, {{cliente_nome}}',
    unsupported: 'não permitido',
  }));
  const body = parse(result);
  const fields = body.fields as Record<string, string>;

  assert.equal(result.statusCode, 400);
  assert.equal(body.error, 'Revise os campos destacados.');
  assert.match(fields.message, /cliente_nome/);
  assert.match(fields._form, /unsupported/);
  assert.equal(saves, 0);
});

test('repository load failures return a safe response', async () => {
  const handler = createHandler({
    repository: repository({
      get: async () => {
        throw new Error('database details must not be returned');
      },
    }),
  });
  const result = await handler(event('GET'));

  assert.equal(result.statusCode, 500);
  assert.deepEqual(parse(result), {
    error: 'Não foi possível carregar o modelo de e-mail. Tente novamente.',
  });
});

test('repository save failures return a safe response', async () => {
  const handler = createHandler({
    repository: repository({
      save: async () => {
        throw new Error('database details must not be returned');
      },
    }),
  });
  const result = await handler(event('PUT', DEFAULT_QUOTATION_EMAIL_TEMPLATE));

  assert.equal(result.statusCode, 500);
  assert.deepEqual(parse(result), {
    error: 'Não foi possível salvar o modelo de e-mail. Tente novamente.',
  });
});

test('unsupported methods return 405 with the allowed methods', async () => {
  const handler = createHandler({ repository: repository() });
  const result = await handler(event('POST'));

  assert.equal(result.statusCode, 405);
  assert.equal(result.headers?.Allow, 'GET, PUT');
  assert.deepEqual(parse(result), { error: 'Método não permitido.' });
});
