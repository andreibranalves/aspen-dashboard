import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHandler } from '../../api/modules/settings.js';
import type { Settings, SettingsRepository } from '../../api/_db/settings-repository.js';

const DEFAULT_SETTINGS: Settings = {
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  template_padrao: 'padrao',
  secoes: {
    schema_version: 1,
    prazo_producao: { enabled: true, title: 'Prazo de produção' },
    pagamento: { enabled: true, title: 'Pagamento', body: '' },
    condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' },
  },
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
      const normalized: Settings = {
        ...(saved || DEFAULT_SETTINGS),
        ...settings,
        entrega: settings.entrega ?? saved?.entrega ?? '',
        template_padrao: settings.template_padrao ?? saved?.template_padrao ?? 'padrao',
      };
      saved = normalized;
      return normalized;
    },
  };
}

describe('settings handler', () => {

  it('returns documented defaults when the singleton row does not exist', async () => {
    const handler = createHandler({ repository: createMemoryRepository() });

    const result = await handler(event('GET'));

    assert.equal(result.statusCode, 200);
    const parsed = parse(result);
    assert.deepEqual(parsed, DEFAULT_SETTINGS);
  });

  it('validates, canonicalizes, saves and reloads settings through the repository seam', async () => {
    const handler = createHandler({ repository: createMemoryRepository() });
    const payload = {
      validade_dias: 30,
      pagamento: '50% na aprovação e 50% na entrega',
      entrega: 'Até 10 dias úteis',
      frete_padrao: '00012.5',
      observacoes: 'Confirmar a arte antes da produção.',
      template_padrao: '  corporativo  ',
      secoes: {
        schema_version: 1,
        prazo_producao: { enabled: true, title: 'Produção' },
        pagamento: { enabled: true, title: 'Pagamento', body: '50% na aprovação' },
        condicoes_gerais: { enabled: false, title: 'Condições', body: '' },
      },
    };

    const saved = await handler(event('PUT', payload));

    assert.equal(saved.statusCode, 200);
    assert.deepEqual(parse(saved), {
      validade_dias: 30,
      pagamento: '50% na aprovação',
      entrega: 'Até 10 dias úteis',
      frete_padrao: '12.50',
      observacoes: '',
      template_padrao: 'corporativo',
      secoes: payload.secoes,
    });

    const reloaded = await handler(event('GET'));
    assert.equal(reloaded.statusCode, 200);
    const reloadedParsed = parse(reloaded);
    const savedParsed = parse(saved);
    assert.deepEqual(reloadedParsed, savedParsed);
  });

  it('reports field validation errors in Portuguese without writing invalid data', async () => {
    let writes = 0;
    const handler = createHandler({
      repository: {
        get: async () => null,
        save: async (settings) => {
          writes += 1;
          return { ...DEFAULT_SETTINGS, ...settings, entrega: settings.entrega ?? '' };
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
        secoes: {
          schema_version: 1,
          prazo_producao: { enabled: true, title: '' },
          pagamento: { enabled: true, title: 'Pagamento', body: 'x'.repeat(4001) },
          condicoes_gerais: { enabled: true, title: 'Condições', body: '' },
        },
      })
    );
    const body = parse(result);

    assert.equal(result.statusCode, 400);
    assert.equal(body.error, 'Dados de configuração inválidos.');
    assert.match(body.fields.validade_dias, /entre 1 e 365/);
    assert.match(body.fields['secoes.prazo_producao.title'], /não pode ser vazio/);
    const oversized = await handler(
      event('PUT', {
        validade_dias: 30,
        frete_padrao: '1.00',
        secoes: {
          schema_version: 1,
          prazo_producao: { enabled: true, title: 'Prazo' },
          pagamento: { enabled: true, title: 'Pagamento', body: 'x'.repeat(4001) },
          condicoes_gerais: { enabled: true, title: 'Condições', body: '' },
        },
      })
    );
    assert.match(parse(oversized).fields['secoes.pagamento.body'], /excede 4000 caracteres/);
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
        save: async (settings) => ({ ...DEFAULT_SETTINGS, ...settings, entrega: settings.entrega ?? '' }),
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
