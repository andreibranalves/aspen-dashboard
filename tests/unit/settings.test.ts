import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHandler } from '../../api/_functions/settings.js';
import type { Settings, SettingsRepository } from '../../api/_db/settings-repository.js';

const DEFAULT_SETTINGS: Settings = {
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  template_padrao: 'padrao',
};

function event(method: string, body?: unknown) {
  return {
    httpMethod: method,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
  } as any;
}

function parse(result: { body?: string }): any {
  return JSON.parse(result.body || '{}');
}

function createMemoryRepository(initial: Settings | null = null): SettingsRepository {
  let saved = initial;
  return {
    get: async () => saved,
    save: async (settings) => {
      saved = settings;
      return settings;
    },
  };
}

describe('settings handler', () => {
  const prevOperational = process.env.CRM_OPERATIONAL_MODE;

  it('returns documented defaults when the singleton row does not exist', async () => {
    delete process.env.CRM_OPERATIONAL_MODE;
    const handler = createHandler({ repository: createMemoryRepository() });

    const result = await handler(event('GET'));

    assert.equal(result.statusCode, 200);
    const parsed = parse(result);
    assert.deepEqual({ ...parsed, operational_mode: undefined }, { ...DEFAULT_SETTINGS, operational_mode: undefined });
  });

  it('validates, canonicalizes, saves and reloads settings through the repository seam', async () => {
    delete process.env.CRM_OPERATIONAL_MODE;
    const handler = createHandler({ repository: createMemoryRepository() });
    const payload = {
      validade_dias: 30,
      pagamento: '50% na aprovação e 50% na entrega',
      entrega: 'Até 10 dias úteis',
      frete_padrao: '00012.5',
      observacoes: 'Confirmar a arte antes da produção.',
      template_padrao: '  corporativo  ',
    };

    const saved = await handler(event('PUT', payload));

    assert.equal(saved.statusCode, 200);
    assert.deepEqual(parse(saved), {
      ...payload,
      frete_padrao: '12.50',
      template_padrao: 'corporativo',
    });

    const reloaded = await handler(event('GET'));
    assert.equal(reloaded.statusCode, 200);
    const reloadedParsed = parse(reloaded);
    const savedParsed = parse(saved);
    // GET response includes operational_mode; PUT does not. Compare core fields.
    const { operational_mode: _rm, ...reloadedCore } = reloadedParsed;
    const { operational_mode: _sm, ...savedCore } = savedParsed;
    assert.deepEqual(reloadedCore, savedCore);
  });

  it('reports field validation errors in Portuguese without writing invalid data', async () => {
    let writes = 0;
    const handler = createHandler({
      repository: {
        get: async () => null,
        save: async (settings) => {
          writes += 1;
          return settings;
        },
      },
    });

    const result = await handler(
      event('PUT', {
        validade_dias: 0,
        pagamento: 42,
        entrega: '',
        frete_padrao: '-1.000',
        observacoes: '',
        template_padrao: '   ',
      })
    );
    const body = parse(result);

    assert.equal(result.statusCode, 400);
    assert.equal(body.error, 'Dados de configuração inválidos.');
    assert.match(body.fields.validade_dias, /entre 1 e 365/);
    assert.match(body.fields.pagamento, /texto válido/);
    assert.match(body.fields.frete_padrao, /não negativo/);
    assert.match(body.fields.template_padrao, /template padrão/);
    assert.equal(writes, 0);
  });

  it('handles invalid JSON, unsupported methods and persistence errors safely', async () => {
    const handler = createHandler({
      repository: {
        get: async () => {
          throw new Error('postgres://usuario:segredo@host/banco');
        },
        save: async (settings) => settings,
      },
    });

    const invalidJson = await handler({
      httpMethod: 'PUT',
      body: '{',
      headers: {},
      queryStringParameters: {},
    });
    assert.equal(invalidJson.statusCode, 400);
    assert.equal(parse(invalidJson).error, 'JSON inválido.');

    const unsupported = await handler(event('POST'));
    assert.equal(unsupported.statusCode, 405);
    assert.equal(unsupported.headers?.Allow, 'GET, PUT');
    assert.equal(parse(unsupported).error, 'Método não permitido.');

    const unavailable = await handler(event('GET'));
    assert.equal(unavailable.statusCode, 500);
    assert.equal(
      parse(unavailable).error,
      'Não foi possível carregar as configurações. Tente novamente.'
    );
    assert.doesNotMatch(unavailable.body || '', /segredo|postgres:/);
  });
});
