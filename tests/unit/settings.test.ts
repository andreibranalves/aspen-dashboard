import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { createHandler } from '../../api/_modules/settings.js';
import type {
  Settings,
  SettingsRepository,
} from '../../api/_infrastructure/db/repositories/settings-repository.js';

const DEFAULT_SETTINGS: Settings = {
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  template_padrao: 'padrao',
  secoes: {
    schema_version: 1,
    show_summary: true,
    rich_text: true,
    prazo_producao: { enabled: true, title: 'Prazo de produção' },
    pagamento: { enabled: true, title: 'Pagamento', body: '' },
    condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' },
  },
  empresa: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
  settings_version: 1,
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
        show_summary: true,
        rich_text: true,
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
      empresa: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
      settings_version: 1,
    });

    const reloaded = await handler(event('GET'));
    assert.equal(reloaded.statusCode, 200);
    const reloadedParsed = parse(reloaded);
    const savedParsed = parse(saved);
    assert.deepEqual(reloadedParsed, savedParsed);
  });

  it('validates and persists the company configuration independently from section defaults', async () => {
    const handler = createHandler({ repository: createMemoryRepository() });
    const result = await handler(
      event('PUT', {
        validade_dias: 15,
        frete_padrao: '0.00',
        empresa: {
          schema_version: 1,
          identity: { legal_name: 'Empresa de teste', document: '12.345.678/0001-95' },
          banking: {
            bank_name: 'Banco teste',
            bank_code: '001',
            branch: '0001',
            account: '123-4',
            pix_key: 'pix@empresa.example',
          },
          contacts: {
            website: 'https://empresa.example',
            phone: '(11) 99999-0000',
            email: 'contato@empresa.example',
            instagram: 'https://instagram.com/empresa',
          },
        },
      })
    );
    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).empresa.identity.legal_name, 'Empresa de teste');
    assert.equal(parse(result).empresa.banking.pix_key, 'pix@empresa.example');
  });

  it('rejects null, empty and partial company payloads without resetting saved data', async () => {
    let writes = 0;
    const customized = {
      ...DEFAULT_SETTINGS,
      empresa: {
        ...DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
        identity: {
          ...DEFAULT_QUOTATION_COMPANY_CONFIGURATION.identity,
          legal_name: 'Empresa já configurada LTDA',
        },
      },
    };
    const handler = createHandler({
      repository: {
        get: async () => customized,
        save: async (settings) => {
          writes += 1;
          return { ...customized, ...settings };
        },
      },
    });
    const basePayload = {
      validade_dias: 30,
      frete_padrao: '0.00',
      settings_version: customized.settings_version,
    };

    for (const empresa of [
      null,
      {},
      {
        schema_version: 1,
        identity: {
          legal_name: 'Empresa parcial LTDA',
          document: DEFAULT_QUOTATION_COMPANY_CONFIGURATION.identity.document,
        },
      },
    ]) {
      const result = await handler(event('PUT', { ...basePayload, empresa }));
      assert.equal(result.statusCode, 400);
      assert.equal(parse(result).error, 'Dados de configuração inválidos.');
      assert.match(parse(result).fields.empresa, /empresa|identidade|bancários/i);
    }

    assert.equal(writes, 0);
    const reloaded = await handler(event('GET'));
    assert.equal(parse(reloaded).empresa.identity.legal_name, 'Empresa já configurada LTDA');
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
        save: async (settings) => ({
          ...DEFAULT_SETTINGS,
          ...settings,
          entrega: settings.entrega ?? '',
        }),
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
