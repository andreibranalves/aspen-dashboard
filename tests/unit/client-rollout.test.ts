import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  createHandler as createListBoundary,
  createCoreHandler as createListCore,
} from '../../api/_functions/leads-clients.js';
import { createCoreHandler as createDetailCore } from '../../api/_functions/client-detail.js';
import { clients } from '../../api/_db/schema.js';
import { createMemoryClientRepository } from '../../api/_functions/client-repository.js';
import { ClientInputError } from '../../api/_functions/client-schema.js';
import { createPostgresClientRepository } from '../../api/_db/client-repository.js';

function event(method: string, body?: unknown, query: Record<string, string> = {}) {
  return {
    httpMethod: method,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
    queryStringParameters: query,
  } as any;
}

function parse(result: { body?: string }): any {
  return JSON.parse(result.body || '{}');
}

const previousFlag = process.env.CRM_CORE_CLIENTS_ENABLED;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
afterEach(() => {
  if (previousFlag === undefined) delete process.env.CRM_CORE_CLIENTS_ENABLED;
  else process.env.CRM_CORE_CLIENTS_ENABLED = previousFlag;
  // Always disable operational mode for rollout tests - they test individual flag behavior
  delete process.env.CRM_OPERATIONAL_MODE;
});

describe('clients rollout boundary', () => {
  it('keeps legacy explicit when unset/false and never falls back after a core failure', async () => {
    let legacyCalls = 0;
    let coreCalls = 0;
    const legacy = async () => {
      legacyCalls += 1;
      return { statusCode: 200, body: JSON.stringify({ data: [] }) };
    };
    const core = async () => {
      coreCalls += 1;
      throw new Error('core unavailable');
    };
    const handler = createListBoundary({ legacy, core });

    delete process.env.CRM_CORE_CLIENTS_ENABLED;
    const legacyResult = await handler(event('GET'));
    assert.equal(parse(legacyResult).core_mode, false);
    assert.equal(parse(legacyResult).source, 'frappe');
    assert.equal(legacyCalls, 1);

    process.env.CRM_CORE_CLIENTS_ENABLED = 'true';
    await assert.rejects(() => handler(event('GET')), /core unavailable/);
    assert.equal(coreCalls, 1);
    assert.equal(legacyCalls, 1);
  });
});

describe('core clients handlers', () => {
  it('normalizes, searches, paginates, archives idempotently, restores and preserves patches', async () => {
    const repository = createMemoryClientRepository({
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      idFactory: () => '00000000-0000-4000-8000-000000000001',
    });
    const list = createListCore({ repository });
    const detail = createDetailCore({ repository });

    const created = await list(
      event('POST', {
        nome: '  Maria  ',
        documento: '12.345.678/9012-34',
        email: 'MARIA@EXAMPLE.COM',
        telefone: '(11) 99999-0000',
        address: { street: 'Rua A', city: 'São Paulo', uf: 'sp', cep: '01001-000' },
      })
    );
    assert.equal(created.statusCode, 201);
    const id = parse(created).id;
    assert.equal(parse(created).tipo, 'cliente');
    assert.equal(parse(created).core_mode, true);
    const createdDetail = parse(await detail(event('GET', undefined, { name: id })));
    for (const forbiddenKey of ['empresa', 'origem', 'contribuinte', 'inscricao_estadual']) {
      assert.equal(
        Object.hasOwn(createdDetail, forbiddenKey),
        false,
        `${forbiddenKey} não pertence ao detalhe core`
      );
    }

    const listed = parse(
      await list(event('GET', undefined, { search: 'maria', page: '1', limit: '1' }))
    );
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].email, 'maria@example.com');

    const patched = await detail(
      event('PATCH', { email: null, address: { bairro: 'Centro' } }, { name: id })
    );
    assert.equal(patched.statusCode, 200);
    assert.equal(parse(patched).email, null);
    assert.equal(parse(patched).address.endereco, 'Rua A');
    assert.equal(parse(patched).address.bairro, 'Centro');

    const archived = await list(event('DELETE', undefined, { id }));
    assert.equal(archived.statusCode, 200);
    assert.equal(parse(archived).archived, true);
    assert.equal(parse(await detail(event('GET', undefined, { name: id }))).status, 'archived');
    assert.equal((await list(event('DELETE', undefined, { id }))).statusCode, 200);
    assert.equal(parse(await list(event('GET'))).data.length, 0);
    assert.equal(parse(await list(event('GET', undefined, { status: 'archived' }))).data.length, 1);

    const restored = await detail(event('PATCH', { arquivado: false }, { name: id }));
    assert.equal(restored.statusCode, 200);
    assert.equal(parse(restored).arquivado, false);
    assert.equal(parse(await list(event('GET'))).data.length, 1);
  });

  it('rejects conflicting/invalid documents and duplicate normalized values', async () => {
    const repository = createMemoryClientRepository();
    const list = createListCore({ repository });
    const first = await list(event('POST', { nome: 'A', documento: '12345678901' }));
    assert.equal(first.statusCode, 201);
    assert.equal(
      (await list(event('POST', { nome: 'B', documento: '123.456.789-01' }))).statusCode,
      409
    );
    assert.equal((await list(event('POST', { nome: 'C', documento: '123' }))).statusCode, 400);
    assert.equal(
      (await list(event('POST', { nome: 'D', documento: '12345678901', cpf: '12345678901234' })))
        .statusCode,
      400
    );
  });

  it('supports the public document aliases and observacoes contract without accepting conflicting values', async () => {
    const repository = createMemoryClientRepository();
    const list = createListCore({ repository });
    const detail = createDetailCore({ repository });
    const created = await list(
      event('POST', {
        nome: 'Observações',
        tax_id: '98765432100',
        observacoes: 'Contato somente pela manhã',
        unknown_legacy_field: 'ignored',
      })
    );
    assert.equal(created.statusCode, 201);
    const id = parse(created).id;
    const detailBody = parse(
      await detail(event('GET', undefined, { name: id, doctype: 'Customer' }))
    );
    assert.equal(detailBody.notes, 'Contato somente pela manhã');
    assert.equal(detailBody.observacoes, 'Contato somente pela manhã');
    assert.equal(parse(await list(event('GET'))).data[0].observacoes, 'Contato somente pela manhã');

    assert.equal(
      (await detail(event('PATCH', { cnpj: '98765432100', tax_id: '98765432100' }, { name: id })))
        .statusCode,
      200
    );
    assert.equal(
      (await detail(event('PATCH', { cnpj: null, tax_id: '98765432100' }, { name: id })))
        .statusCode,
      400
    );
    assert.equal(
      (await detail(event('PATCH', { cnpj: '98765432100', tax_id: '12345678901' }, { name: id })))
        .statusCode,
      400
    );
    assert.equal(
      (await detail(event('PATCH', { observacoes: null }, { name: id }))).statusCode,
      200
    );
    assert.equal(parse(await detail(event('GET', undefined, { name: id }))).observacoes, null);

    const directAlias = await repository.create({
      nome: 'Alias direto',
      observacoes: 'Nota direta',
    });
    assert.equal(directAlias.notes, 'Nota direta');
    const directCleared = await repository.update(directAlias.id, { observacoes: null });
    assert.equal(directCleared.notes, null);
  });

  it('returns 400 for invalid archived status and query/type/doctype values', async () => {
    const repository = createMemoryClientRepository();
    const list = createListCore({ repository });
    const detail = createDetailCore({ repository });
    assert.equal(
      (await list(event('POST', { nome: 'Cliente', arquivado: 'false' }))).statusCode,
      400
    );
    assert.equal(
      (await detail(event('PATCH', { arquivado: 'false' }, { name: 'missing' }))).statusCode,
      400
    );
    assert.equal((await list(event('GET', undefined, { status: 'broken' }))).statusCode, 400);
    assert.equal((await list(event('GET', undefined, { tipo: 'broken' }))).statusCode, 400);
    assert.equal(
      (await detail(event('GET', undefined, { name: 'missing', doctype: 'Broken' }))).statusCode,
      400
    );
  });

  it('treats wildcard search characters literally and supports partial/clear address patches', async () => {
    const repository = createMemoryClientRepository();
    const list = createListCore({ repository });
    const detail = createDetailCore({ repository });
    const created = await list(
      event('POST', {
        nome: 'Nome 100 literal',
        email: 'literal@example.com',
        telefone: '11999990000',
        address: { street: 'Rua A', city: 'São Paulo', uf: 'sp', cep: '01001000' },
      })
    );
    const id = parse(created).id;
    assert.equal(parse(await list(event('GET', undefined, { search: '%' }))).data.length, 0);
    assert.equal(parse(await list(event('GET', undefined, { search: '11%' }))).data.length, 0);
    assert.equal(parse(await list(event('GET', undefined, { search: '11_' }))).data.length, 0);
    assert.equal(
      parse(await list(event('GET', undefined, { search: '(11) 99999-0000' }))).data.length,
      1
    );
    const partial = parse(
      await detail(event('PATCH', { address: { bairro: 'Centro' } }, { name: id }))
    );
    assert.equal(partial.address.street, 'Rua A');
    assert.equal(partial.address.bairro, 'Centro');
    const cleared = parse(
      await detail(event('PATCH', { address: { bairro: null } }, { name: id }))
    );
    assert.equal(cleared.address.bairro, null);
    const wholeClear = parse(await detail(event('PATCH', { address: null }, { name: id })));
    assert.equal(wholeClear.address, null);
  });

  it('finds observations and every persisted address field in the memory repository seam', async () => {
    const repository = createMemoryClientRepository();
    await repository.create({
      nome: 'Cliente pesquisável',
      notes: 'Observação exclusiva para pesquisa',
      address: {
        endereco: 'Rua das Acácias',
        numero: '42-B',
        bairro: 'Jardim das Pedras',
        complemento: 'Fundos',
        municipio: 'Cidade Coberta',
        uf: 'MG',
        cep: '30123456',
      },
    });

    for (const search of [
      'observação exclusiva',
      'Rua das Acácias',
      '42-B',
      'Jardim das Pedras',
      'Fundos',
      'Cidade Coberta',
      'MG',
      '30123456',
    ]) {
      const result = await repository.list({ search, status: 'all' });
      assert.equal(result.total, 1, `busca em memória por ${search}`);
    }
  });

  it('maps an unexpected repository failure to a safe 500 response', async () => {
    const list = createListCore({
      repository: {
        list: async () => {
          throw new Error('driver password leaked');
        },
        get: async () => null,
        create: async () => {
          throw new Error('driver password leaked');
        },
        update: async () => {
          throw new Error('driver password leaked');
        },
        archive: async () => {
          throw new Error('driver password leaked');
        },
      },
    });
    const response = await list(event('GET'));
    assert.equal(response.statusCode, 500);
    assert.doesNotMatch(parse(response).error, /password|driver/i);
  });

  it('maps a nested PostgreSQL duplicate constraint and cycles without leaking driver details', async () => {
    const duplicate = Object.assign(new Error('outer driver error'), {
      cause: Object.assign(new Error('inner driver error'), {
        code: '23505',
        constraint: 'clients_documento_unique',
      }),
    });
    (duplicate.cause as any).cause = duplicate;
    const repository = createPostgresClientRepository(
      () =>
        ({
          insert: () => ({
            values: () => ({
              returning: async () => {
                throw duplicate;
              },
            }),
          }),
        }) as any
    );
    await assert.rejects(
      () => repository.create({ nome: 'Duplicada', documento: '12345678901' }),
      (error: any) => error.statusCode === 409 && /Documento/.test(error.message)
    );
  });

  it('preserves invalid status as ClientInputError in the memory repository seam', async () => {
    const repository = createMemoryClientRepository();
    await assert.rejects(
      () => repository.create({ nome: 'Cliente', arquivado: 'no' as any }),
      ClientInputError
    );
    const created = await repository.create({ nome: 'Cliente' });
    await assert.rejects(
      () => repository.update(created.id, { arquivado: 'no' as any }),
      ClientInputError
    );
  });
});

describe('PostgreSQL client search seam', () => {
  const postgresIt = TEST_DATABASE_URL ? it : it.skip;

  postgresIt('finds observations and address fields with literal wildcards preserved', async () => {
    assert.ok(TEST_DATABASE_URL, 'TEST_DATABASE_URL é obrigatório para a integração PostgreSQL.');
    const connection = postgres(TEST_DATABASE_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const db = drizzle(connection, { schema: { clients } });
    const repository = createPostgresClientRepository(() => db);
    const marker = randomUUID();
    let id: string | undefined;

    try {
      const created = await repository.create({
        nome: `Cliente PostgreSQL ${marker}`,
        telefone: '(31) 98888-1234',
        notes: `Observação PostgreSQL ${marker}`,
        address: {
          endereco: `Rua PostgreSQL ${marker}`,
          numero: '501',
          bairro: `Bairro PostgreSQL ${marker}`,
          complemento: `Complemento PostgreSQL ${marker}`,
          municipio: `Cidade PostgreSQL ${marker}`,
          uf: 'MG',
          cep: '30123456',
        },
      });
      id = created.id;

      for (const search of [
        `Observação PostgreSQL ${marker}`,
        `Rua PostgreSQL ${marker}`,
        '501',
        `Bairro PostgreSQL ${marker}`,
        `Complemento PostgreSQL ${marker}`,
        `Cidade PostgreSQL ${marker}`,
        'MG',
        '30123456',
        '(31) 98888-1234',
      ]) {
        const result = await repository.list({ search, status: 'all' });
        assert.equal(
          result.data.some((row) => row.id === id),
          true,
          `busca PostgreSQL por ${search}`
        );
      }
      assert.equal(
        (await repository.list({ search: '%', status: 'all' })).data.some((row) => row.id === id),
        false
      );
      assert.equal(
        (await repository.list({ search: '31_', status: 'all' })).data.some((row) => row.id === id),
        false
      );
    } finally {
      if (id) await connection`DELETE FROM clients WHERE id = ${id}::uuid`;
      await connection.end({ timeout: 5 });
    }
  });
});
