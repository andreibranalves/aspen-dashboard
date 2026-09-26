import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import { clients } from '../../api/_infrastructure/db/schema.js';
import type { FunctionEvent } from '../../api/_http/types.js';
import { createCoreHandler } from '../../api/_modules/client-matches.js';
import {
  classifyClientMatch,
  normalizeClientMatchInput,
} from '../../api/_modules/client-matching.js';
import {
  createPostgresClientMatchRepository,
  searchClientMatchCandidates,
} from '../../api/_infrastructure/db/repositories/client-matching-repository.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);

const CLIENT_IDS = [
  'ff100000-0000-4000-8000-000000000001',
  'ff100000-0000-4000-8000-000000000002',
  'ff100000-0000-4000-8000-000000000003',
  'ff100000-0000-4000-8000-000000000004',
  'ff100000-0000-4000-8000-000000000005',
  'ff100000-0000-4000-8000-000000000006',
  'ff100000-0000-4000-8000-000000000007',
];

// Synthetic, check-digit valid documents. No real client data is used.
const DOC_CNPJ = '60701190000104';
const DOC_CNPJ_SECOND = '60701190000287';
const DOC_CPF = '39053344705';
const PHONE = '11987654321';
const PHONE_OTHER = '11912345678';
const EMAIL = 'acme.financeiro@example.com';

const FIXTURES = [
  {
    id: CLIENT_IDS[0],
    nome: 'Ácme  Industrial LTDA',
    empresa: 'Ácme Industrial',
    documento: DOC_CNPJ,
    email: EMAIL,
    telefone: PHONE,
    arquivado: false,
  },
  {
    id: CLIENT_IDS[1],
    nome: 'Homônimo',
    empresa: null,
    documento: null,
    email: null,
    telefone: null,
    arquivado: false,
  },
  {
    id: CLIENT_IDS[2],
    nome: 'Arquivada Antiga',
    empresa: null,
    documento: null,
    email: null,
    telefone: PHONE_OTHER,
    arquivado: true,
  },
  {
    id: CLIENT_IDS[3],
    nome: 'Literal 50% OFF',
    empresa: null,
    documento: null,
    email: null,
    telefone: null,
    arquivado: false,
  },
  {
    id: CLIENT_IDS[4],
    nome: 'Literal 5012 OFF',
    empresa: null,
    documento: null,
    email: null,
    telefone: null,
    arquivado: false,
  },
  {
    id: CLIENT_IDS[5],
    nome: 'Delta a_c Corp',
    empresa: null,
    documento: null,
    email: null,
    telefone: null,
    arquivado: false,
  },
  {
    id: CLIENT_IDS[6],
    nome: 'Delta abc Corp',
    empresa: null,
    documento: DOC_CPF,
    email: null,
    telefone: null,
    arquivado: false,
  },
];

let sql: Sql | undefined;
let db: PostgresJsDatabase<typeof schema>;

async function removeFixtures() {
  if (!db) return;
  await db.delete(clients).where(inArray(clients.id, CLIENT_IDS));
}

async function seedFixtures() {
  await db.insert(clients).values(
    FIXTURES.map((fixture) => ({
      ...fixture,
      notes: null,
      endereco: null,
      numero: null,
      bairro: null,
      complemento: null,
      municipio: null,
      uf: null,
      cep: null,
    }))
  );
}

function classifyAgainstDatabase(payload: unknown) {
  return classifyClientMatch(normalizeClientMatchInput(payload), []);
}

function functionEvent(payload: unknown): FunctionEvent {
  return {
    httpMethod: 'POST',
    body: JSON.stringify(payload),
    headers: {},
    queryStringParameters: {},
  } as unknown as FunctionEvent;
}

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  sql = postgres(TEST_DATABASE_URL, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder });
  await removeFixtures();
  await seedFixtures();
});

test.after(async () => {
  await removeFixtures();
  await sql?.end({ timeout: 5 });
});

test(
  'client-matches PostgreSQL: igualdade forte por documento, e-mail e telefone',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const input = normalizeClientMatchInput({
      cnpj: '60.701.190/0001-04',
      email: '  ACME.Financeiro@Example.COM ',
      telefone: '(11) 98765-4321',
    });
    const records = await searchClientMatchCandidates(db, input);
    const response = classifyClientMatch(input, records);
    assert.equal(response.status, 'matched');
    assert.equal(response.matched_client_id, CLIENT_IDS[0]);
    assert.deepEqual(response.candidates[0].matched_by, ['documento', 'email', 'telefone']);
    assert.equal(response.candidates[0].documento, '**.***.***/****-04');
  }
);

test(
  'client-matches PostgreSQL: telefone com 55 encontra o cadastro salvo sem 55',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const records = await searchClientMatchCandidates(db, normalizeClientMatchInput({ telefone: `+55 ${PHONE}` }));
    assert.ok(records.some((record) => record.id === CLIENT_IDS[0] && record.telefone === PHONE));
  }
);

test(
  'client-matches PostgreSQL: busca textual ignora caixa, acentos e espaços repetidos',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const byName = await searchClientMatchCandidates(
      db,
      normalizeClientMatchInput({ nome: 'acme   industrial ltda' })
    );
    assert.deepEqual(byName.map((record) => record.id), [CLIENT_IDS[0]]);

    const byCompany = await searchClientMatchCandidates(
      db,
      normalizeClientMatchInput({ empresa: 'ÁCME industrial' })
    );
    assert.deepEqual(byCompany.map((record) => record.id), [CLIENT_IDS[0]]);
  }
);

test(
  'client-matches PostgreSQL: sugestão por nome nunca vincula sozinha',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const input = normalizeClientMatchInput({ nome: 'Homonimo' });
    const response = classifyClientMatch(input, await searchClientMatchCandidates(db, input));
    assert.equal(response.status, 'review');
    assert.equal(response.reason, 'weak_matches_only');
    assert.equal(response.matched_client_id, null);
  }
);

test(
  'client-matches PostgreSQL: cliente arquivado é detectado e impede vínculo automático',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const input = normalizeClientMatchInput({ nome: 'Arquivada Antiga', telefone: PHONE_OTHER });
    const response = classifyClientMatch(input, await searchClientMatchCandidates(db, input));
    assert.equal(response.status, 'review');
    assert.equal(response.reason, 'archived_match');
    assert.equal(response.candidates[0].arquivado, true);
  }
);

test(
  'client-matches PostgreSQL: % e _ não expandem wildcard na busca textual',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const percent = await searchClientMatchCandidates(
      db,
      normalizeClientMatchInput({ nome: 'Literal 50% O' })
    );
    assert.deepEqual(
      percent.map((record) => record.id),
      [CLIENT_IDS[3]],
      'o % literal não pode casar com outros caracteres'
    );

    const underscore = await searchClientMatchCandidates(
      db,
      normalizeClientMatchInput({ nome: 'Delta a_c' })
    );
    assert.deepEqual(
      underscore.map((record) => record.id),
      [CLIENT_IDS[5]],
      'o _ literal não pode casar com qualquer caractere'
    );
  }
);

test(
  'client-matches PostgreSQL: campo vazio nunca corresponde a campo vazio',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const input = normalizeClientMatchInput({ nome: 'Homonimo' });
    const response = classifyClientMatch(input, await searchClientMatchCandidates(db, input));
    assert.equal(response.status, 'review');
    assert.equal(response.total_candidates, 1);
    assert.deepEqual(response.candidates[0].matched_by, ['nome']);
  }
);

test(
  'client-matches PostgreSQL: documento de CPF válido também é correspondência forte',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const input = normalizeClientMatchInput({ cnpj: '390.533.447-05' });
    const response = classifyClientMatch(input, await searchClientMatchCandidates(db, input));
    assert.equal(response.status, 'matched');
    assert.equal(response.matched_client_id, CLIENT_IDS[6]);
  }
);

test(
  'client-matches PostgreSQL: sem dado pesquisável a base não é varrida',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const response = classifyAgainstDatabase({ nome: 'Ab' });
    assert.equal(response.status, 'insufficient');
    assert.equal(response.total_candidates, 0);
  }
);

test(
  'client-matches PostgreSQL: o handler responde com o contrato sobre o banco real',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const handler = createCoreHandler({
      repository: createPostgresClientMatchRepository(() => db),
    });

    const created = await handler(functionEvent({ nome: 'Acme Industrial', telefone: '11987654321' }));
    assert.equal(created.statusCode, 200);
    const body = JSON.parse(created.body || '{}') as Record<string, unknown>;
    assert.equal(body.status, 'matched');
    assert.equal(body.matched_client_id, CLIENT_IDS[0]);
    const candidates = body.candidates as Array<Record<string, unknown>>;
    assert.equal(candidates[0].documento, '**.***.***/****-04');
    assert.ok(!created.body?.includes(DOC_CNPJ));

    const invalid = await handler(functionEvent({ cnpj: '60.701.190/0001-99' }));
    assert.equal(invalid.statusCode, 400);
  }
);

test(
  'client-matches PostgreSQL: identificador isolado em outro cadastro pede escolha ou confirmação',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const extraIds = [
      'ff100000-0000-4000-8000-0000000000fe',
      'ff100000-0000-4000-8000-0000000000fd',
    ];
    const base = {
      empresa: null,
      email: null,
      arquivado: false,
      notes: null,
      endereco: null,
      numero: null,
      bairro: null,
      complemento: null,
      municipio: null,
      uf: null,
      cep: null,
    };
    await db.insert(clients).values([
      { ...base, id: extraIds[0], nome: 'Outro Telefone', telefone: '11955554444' },
      { ...base, id: extraIds[1], nome: 'Mesmo Telefone', documento: DOC_CNPJ_SECOND, telefone: PHONE },
    ]);
    try {
      const samePhone = normalizeClientMatchInput({ telefone: PHONE });
      const repeated = classifyClientMatch(samePhone, await searchClientMatchCandidates(db, samePhone));
      assert.equal(repeated.status, 'review');
      assert.equal(repeated.reason, 'identifier_in_use');
      assert.equal(repeated.total_candidates, 2);
      assert.equal(repeated.matched_client_id, null);

      const crossed = normalizeClientMatchInput({ email: EMAIL, telefone: '11955554444' });
      const conflict = classifyClientMatch(crossed, await searchClientMatchCandidates(db, crossed));
      assert.equal(conflict.status, 'review');
      assert.equal(conflict.reason, 'identifier_in_use');
      assert.equal(conflict.matched_client_id, null);
      assert.equal(conflict.total_candidates, 2);
    } finally {
      await db.delete(clients).where(inArray(clients.id, extraIds));
    }
  }
);
