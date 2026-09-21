import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCoreHandler } from '../../api/_modules/client-matches.js';
import type {
  ClientMatchRecord,
  NormalizedClientMatchInput,
} from '../../api/_modules/client-matching.js';
import type { ClientMatchRepository } from '../../api/_infrastructure/db/repositories/client-matching-repository.js';

const CNPJ = '11222333000181';

function event(body: unknown, method = 'POST') {
  return {
    httpMethod: method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
  } as const;
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, unknown>;
}

function repositoryOf(records: ClientMatchRecord[]) {
  const calls: NormalizedClientMatchInput[] = [];
  return {
    calls,
    repository: {
      search: async (input: NormalizedClientMatchInput) => {
        calls.push(input);
        return records;
      },
    } satisfies ClientMatchRepository,
  };
}

test('client-matches: método não permitido', async () => {
  const { repository } = repositoryOf([]);
  const handler = createCoreHandler({ repository });
  const result = await handler(event({}, 'GET'));
  assert.equal(result.statusCode, 405);
  assert.equal(parse(result).error, 'Método não permitido.');
});

test('client-matches: JSON inválido', async () => {
  const { repository } = repositoryOf([]);
  const handler = createCoreHandler({ repository });
  const result = await handler(event('{'));
  assert.equal(result.statusCode, 400);
  assert.equal(parse(result).error, 'JSON inválido.');
});

test('client-matches: payload não é objeto', async () => {
  const { repository } = repositoryOf([]);
  const handler = createCoreHandler({ repository });
  const result = await handler(event([]));
  assert.equal(result.statusCode, 400);
  assert.equal(parse(result).error, 'Envie os dados do cliente em um objeto válido.');
});

test('client-matches: documento inválido é entrada inválida, nunca "não encontrado"', async () => {
  const { repository, calls } = repositoryOf([]);
  const handler = createCoreHandler({ repository });
  const result = await handler(event({ cnpj: '11.222.333/0001-99' }));
  assert.equal(result.statusCode, 400);
  assert.equal(parse(result).error, 'O CNPJ/CPF informado é inválido.');
  assert.equal(calls.length, 0, 'uma entrada inválida não consulta o banco');
});

test('client-matches: sem dado pesquisável não lê a base e responde insufficient', async () => {
  const { repository, calls } = repositoryOf([
    { id: 'a', nome: 'Ab', empresa: null, documento: null, email: null, telefone: null, arquivado: false },
  ]);
  const handler = createCoreHandler({ repository });
  const result = await handler(event({ nome: 'Ab' }));
  assert.equal(result.statusCode, 200);
  assert.equal(parse(result).status, 'insufficient');
  assert.equal(parse(result).candidates instanceof Array, true);
  assert.equal(calls.length, 0, 'nenhuma leitura irrestrita da tabela');
});

test('client-matches: responda com a classificação do conjunto completo', async () => {
  const { repository, calls } = repositoryOf([
    { id: 'a', nome: 'Ana', empresa: null, documento: CNPJ, email: null, telefone: null, arquivado: false },
    { id: 'b', nome: 'Beto', empresa: null, documento: CNPJ, email: null, telefone: null, arquivado: false },
  ]);
  const handler = createCoreHandler({ repository });
  const result = await handler(event({ cnpj: CNPJ }));
  assert.equal(result.statusCode, 200);
  const body = parse(result);
  assert.equal(body.status, 'review');
  assert.equal(body.reason, 'multiple_matches');
  assert.equal(body.total_candidates, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].documento, CNPJ);
});

test('client-matches: page repassado ao contrato de resposta', async () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    id: `id-${index}`,
    nome: `Cliente ${index}`,
    empresa: null,
    documento: null,
    email: null,
    telefone: '11987654321',
    arquivado: false,
  }));
  const { repository } = repositoryOf(records);
  const handler = createCoreHandler({ repository });
  const body = parse(await handler(event({ telefone: '11987654321', page: 2 })));
  assert.equal(body.page, 2);
  assert.equal(body.total_candidates, 12);
  assert.equal((body.candidates as unknown[]).length, 2);
  assert.equal(body.has_more, false);
});

test('client-matches: falha do banco responde 503 sem texto de driver', async () => {
  const secret = 'relation "clients" does not exist at character 42';
  const repository: ClientMatchRepository = {
    search: async () => {
      throw new Error(secret);
    },
  };
  const handler = createCoreHandler({ repository });
  const result = await handler(event({ cnpj: CNPJ }));
  assert.equal(result.statusCode, 503);
  const body = parse(result);
  assert.equal(body.error, 'Não foi possível verificar o cliente. Tente novamente.');
  assert.ok(!JSON.stringify(body).includes('clients'));
  assert.ok(!JSON.stringify(body).includes('character 42'));
});

test('client-matches: erro de repositório não vira sucesso vazio', async () => {
  const repository: ClientMatchRepository = {
    search: async () => {
      throw new TypeError('falha inesperada');
    },
  };
  const handler = createCoreHandler({ repository });
  const result = await handler(event({ email: 'ana@example.com' }));
  assert.equal(result.statusCode, 503);
  assert.equal(parse(result).status, undefined);
});

test('client-matches: cadastro único sem conflito é vinculado', async () => {
  const { repository } = repositoryOf([
    {
      id: 'a',
      nome: 'Ana Souza',
      empresa: 'Acme',
      documento: CNPJ,
      email: 'ana@example.com',
      telefone: '11987654321',
      arquivado: false,
    },
  ]);
  const handler = createCoreHandler({ repository });
  const body = parse(await handler(event({ telefone: '(11) 98765-4321' })));
  assert.equal(body.status, 'matched');
  assert.equal(body.matched_client_id, 'a');
  const candidates = body.candidates as Array<Record<string, unknown>>;
  assert.equal(candidates[0].nome, 'Ana Souza');
  assert.deepEqual(candidates[0].matched_by, ['telefone']);
  assert.equal(candidates[0].documento, '**.***.***/****-81');
});
