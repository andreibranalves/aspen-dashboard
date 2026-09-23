import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq, inArray } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  appSettings,
  clients,
  productPricingTiers,
  products,
  quoteRevisions,
  quoteSequences,
  quotations,
} from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresQuoteDraftRepository,
  QuoteDraftConflictError,
  QuoteDraftInputError,
  QuoteDraftNotFoundError,
} from '../../api/_infrastructure/db/repositories/quote-repository.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env, [
  'TEST_QUOTE_DATABASE_URL',
  'TEST_DATABASE_URL',
]);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);

// Synthetic, check-digit valid documents. No real client data is used.
const CONCURRENT_DOCUMENT = '60701190000368';
const REPEATED_DOCUMENT = '60701190000449';
const EXISTING_DOCUMENT = '60701190000600';
const CANONICAL_DOCUMENT = '60701190000791';
const STRONG_DOCUMENT = '60701190000520';
const INVALID_DOCUMENT = '60701190000300';
const CANONICAL_EMAIL = 'canonica@example.com';
const CANONICAL_PHONE = '11955550002';
const ARCHIVED_PHONE = '11955550003';
const MULTIPLE_PHONE = '11955550004';
const SHARED_PHONE = '11955550005';
const UNKNOWN_SKU = 'QUOTE-RESOLUTION-MISSING';
const YEAR = 2027;
const SUFFIX = 'resolution';
const DOCUMENT_FIXTURES = [CONCURRENT_DOCUMENT, REPEATED_DOCUMENT, EXISTING_DOCUMENT, CANONICAL_DOCUMENT, STRONG_DOCUMENT];

let sql: Sql | undefined;
let db: PostgresJsDatabase<typeof schema>;
let sku = '';
let fixtureClientIds: string[] = [];

const now = () => new Date(`${YEAR}-03-10T12:00:00.000Z`);
const repository = () => createPostgresQuoteDraftRepository(() => db, { now });

const baseClient = {
  empresa: null,
  documento: null,
  email: null,
  telefone: null,
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

function clientId(index: number): string {
  return `ff200000-0000-4000-8000-00000000000${index}`;
}

async function addClient(
  index: number,
  overrides: Partial<typeof clients.$inferInsert> & { nome: string }
): Promise<string> {
  const id = clientId(index);
  await db.insert(clients).values({ ...baseClient, id, ...overrides });
  fixtureClientIds.push(id);
  return id;
}

async function clientCountFor(documento: string): Promise<number> {
  const rows = await db.select({ id: clients.id }).from(clients).where(eq(clients.documento, documento));
  return rows.length;
}

async function quotationCountFor(clientIdValue: string): Promise<number> {
  const rows = await db
    .select({ id: quotations.id })
    .from(quotations)
    .where(eq(quotations.clientId, clientIdValue));
  return rows.length;
}

function items() {
  return [{ item_code: sku, qty: '1.000' }];
}

test.before(async () => {
  if (!TEST_DATABASE_URL) return;
  sql = postgres(TEST_DATABASE_URL, {
    max: 12,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder });
  sku = `QUOTE-${SUFFIX}-${Date.now()}`;
  await db
    .update(appSettings)
    .set({ templatePadrao: 'padrao' })
    .where(eq(appSettings.singletonId, 1));
  await db
    .insert(products)
    .values({
      sku,
      nome: 'Produto resolução de cliente',
      descricao: 'Produto de teste',
      unidade: 'Und',
      categoria: 'Teste',
      marca: 'Teste',
      precoBase: '10.00',
      ativo: true,
    })
    .onConflictDoNothing();
  await db
    .insert(productPricingTiers)
    .values([{ productSku: sku, minimumQuantity: '30.000', unitPrice: '9.00' }])
    .onConflictDoNothing();
});

test.after(async () => {
  if (db) {
    const rows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(inArray(clients.documento, DOCUMENT_FIXTURES));
    const ids = [...new Set([...rows.map((row) => row.id), ...fixtureClientIds])];
    if (ids.length) await db.delete(quotations).where(inArray(quotations.clientId, ids));
    await db.delete(clients).where(inArray(clients.id, ids));
    await db.delete(quoteSequences).where(eq(quoteSequences.year, YEAR));
    // The product row stays: product activity events reference it, and the
    // disposable database is rebuilt from migrations for every run.
  }
  await sql?.end({ timeout: 5 });
});

test(
  'duas criações concorrentes da mesma identidade produzem um cliente e dois orçamentos',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const [left, right] = await Promise.all([
      repo.createDraft({
        nome: 'Concorrente A',
        documento: CONCURRENT_DOCUMENT,
        creation_request_id: '11111111-1111-4111-8111-111111111111',
        items: items(),
      }),
      repo.createDraft({
        nome: 'Concorrente B',
        documento: CONCURRENT_DOCUMENT,
        creation_request_id: '22222222-2222-4222-8222-222222222222',
        items: items(),
      }),
    ]);

    fixtureClientIds.push(left.cliente_id);
    assert.equal(left.cliente_id, right.cliente_id, 'as duas requisições devem usar o mesmo cliente');
    assert.equal(await clientCountFor(CONCURRENT_DOCUMENT), 1);
    assert.equal(await quotationCountFor(left.cliente_id), 2);
    assert.equal(new Set([left.quotation_name, right.quotation_name]).size, 2);
  }
);

test(
  'repetição da mesma chave e mesmo conteúdo recupera o resultado sem novos efeitos',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const payload = {
      nome: 'Repetido',
      documento: REPEATED_DOCUMENT,
      creation_request_id: '33333333-3333-4333-8333-333333333333',
      items: items(),
    };
    const first = await repo.createDraft({ ...payload });
    fixtureClientIds.push(first.cliente_id);
    const repeated = await repo.createDraft({ ...payload });

    assert.equal(repeated.quotation_id, first.quotation_id);
    assert.equal(repeated.revision_id, first.revision_id);
    assert.equal(await clientCountFor(REPEATED_DOCUMENT), 1);
    assert.equal(await quotationCountFor(first.cliente_id), 1);

    await assert.rejects(
      () => repo.createDraft({ ...payload, nome: 'Repetido com outro conteúdo' }),
      (error: unknown) =>
        error instanceof QuoteDraftConflictError && error.statusCode === 409 && !error.code
    );
    assert.equal(await quotationCountFor(first.cliente_id), 1);
  }
);

test(
  'a confirmação de novo cliente entra no conteúdo da idempotência sem quebrar a repetição',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const key = '44444444-4444-4444-8444-444444444444';
    const payload = { nome: 'Confirmacao', creation_request_id: key, items: items() };

    await assert.rejects(
      () => repo.createDraft({ ...payload }),
      (error: unknown) =>
        error instanceof QuoteDraftConflictError && error.code === 'CLIENT_SELECTION_REQUIRED'
    );

    const confirmed = await repo.createDraft({ ...payload, confirm_new_client: true });
    fixtureClientIds.push(confirmed.cliente_id);
    const replay = await repo.createDraft({ ...payload, confirm_new_client: true });
    assert.equal(replay.quotation_id, confirmed.quotation_id);

    await assert.rejects(
      () => repo.createDraft({ ...payload, confirm_new_client: false }),
      (error: unknown) =>
        error instanceof QuoteDraftConflictError && error.statusCode === 409 && !error.code
    );
  }
);

test(
  'a confirmação explícita não contorna correspondência forte',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const created = await repo.createDraft({
      nome: 'Forte',
      documento: STRONG_DOCUMENT,
      creation_request_id: '55555555-5555-4555-8555-555555555555',
      items: items(),
    });
    fixtureClientIds.push(created.cliente_id);
    const again = await repo.createDraft({
      nome: 'Forte',
      documento: STRONG_DOCUMENT,
      confirm_new_client: true,
      creation_request_id: '66666666-6666-4666-8666-666666666666',
      items: items(),
    });

    assert.equal(again.cliente_id, created.cliente_id, 'a flag não autoriza um segundo cadastro');
    assert.equal(await clientCountFor(STRONG_DOCUMENT), 1);
  }
);

test(
  'cliente criado antes do salvamento é reutilizado e só o orçamento é criado',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const clientIdValue = await addClient(0, {
      nome: 'Já existente',
      documento: EXISTING_DOCUMENT,
    });

    const draft = await repo.createDraft({
      nome: 'Já existente',
      documento: EXISTING_DOCUMENT,
      creation_request_id: '77777777-7777-4777-8777-777777777777',
      items: items(),
    });

    assert.equal(draft.cliente_id, clientIdValue);
    assert.equal(await clientCountFor(EXISTING_DOCUMENT), 1);
    assert.equal(await quotationCountFor(clientIdValue), 1);
  }
);

test(
  'cliente arquivado entre as tentativas responde CLIENT_ARCHIVED e não cria substituto',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const clientIdValue = await addClient(1, { nome: 'Arquivada', telefone: ARCHIVED_PHONE });
    await db.update(clients).set({ arquivado: true }).where(eq(clients.id, clientIdValue));

    await assert.rejects(
      () =>
        repo.createDraft({
          nome: 'Arquivada',
          telefone: ARCHIVED_PHONE,
          confirm_new_client: true,
          creation_request_id: '88888888-8888-4888-8888-888888888888',
          items: items(),
        }),
      (error: unknown) =>
        error instanceof QuoteDraftConflictError && error.code === 'CLIENT_ARCHIVED'
    );
    assert.equal(await quotationCountFor(clientIdValue), 0);
  }
);

test(
  'client_id inexistente responde CLIENT_NOT_FOUND e id arquivado responde CLIENT_ARCHIVED',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const missing = 'ff200000-0000-4000-8000-0000000000aa';
    await assert.rejects(
      () => repo.createDraft({ client_id: missing, items: items(), nome: 'Sem cadastro' }),
      (error: unknown) =>
        error instanceof QuoteDraftNotFoundError && error.code === 'CLIENT_NOT_FOUND'
    );

    const archivedId = await addClient(2, { nome: 'Arquivada vinculada', arquivado: true });
    await assert.rejects(
      () => repo.createDraft({ client_id: archivedId, items: items(), nome: 'Arquivada vinculada' }),
      (error: unknown) =>
        error instanceof QuoteDraftConflictError && error.code === 'CLIENT_ARCHIVED'
    );
    assert.equal(await quotationCountFor(archivedId), 0);
  }
);

test(
  'documento divergente do cadastro vinculado bloqueia; e-mail e telefone adotam o canônico',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const canonicalId = await addClient(3, {
      nome: 'Cadastro canônico',
      documento: CANONICAL_DOCUMENT,
      email: CANONICAL_EMAIL,
      telefone: CANONICAL_PHONE,
    });

    await assert.rejects(
      () =>
        repo.createDraft({
          client_id: canonicalId,
          nome: 'Divergente',
          documento: REPEATED_DOCUMENT,
          items: items(),
        }),
      (error: unknown) =>
        error instanceof QuoteDraftConflictError && error.code === 'CLIENT_IDENTITY_CONFLICT'
    );

    const linked = await repo.createDraft({
      client_id: canonicalId,
      nome: 'Divergente',
      email: 'outro@example.com',
      telefone: '11955559999',
      creation_request_id: '99999999-9999-4999-8999-999999999999',
      items: items(),
    });
    const [revision] = await db
      .select()
      .from(quoteRevisions)
      .where(eq(quoteRevisions.id, linked.revision_id));
    assert.equal(revision?.clienteEmail, CANONICAL_EMAIL);
    assert.equal(revision?.clienteTelefone, CANONICAL_PHONE);
    const [stored] = await db.select().from(clients).where(eq(clients.id, canonicalId));
    assert.equal(stored?.email, CANONICAL_EMAIL);
    assert.equal(stored?.telefone, CANONICAL_PHONE);
  }
);

test(
  'documento com dígito verificador inválido é rejeitado com 400 e não é gravado',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    await assert.rejects(
      () => repo.createDraft({ nome: 'Inválido', documento: INVALID_DOCUMENT, items: items() }),
      (error: unknown) => error instanceof QuoteDraftInputError && error.statusCode === 400
    );
    assert.equal(await clientCountFor(INVALID_DOCUMENT), 0);
  }
);

test(
  'falha depois da resolução não deixa cliente nem efeitos órfãos',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const before = (await db.select({ id: clients.id }).from(clients)).length;
    await assert.rejects(
      () =>
        repo.createDraft({
          nome: 'Órfão',
          documento: STRONG_DOCUMENT,
          creation_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          items: [{ item_code: UNKNOWN_SKU, qty: '1.000' }],
        }),
      (error: unknown) => error instanceof QuoteDraftNotFoundError
    );
    assert.equal((await db.select({ id: clients.id }).from(clients)).length, before);
    assert.equal(await clientCountFor(STRONG_DOCUMENT), 1, 'nenhum cadastro novo é deixado para trás');
  }
);

test(
  'mais de um cadastro com o mesmo identificador exige escolha no salvamento',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    await addClient(4, { nome: 'Telefone A', telefone: MULTIPLE_PHONE });
    await addClient(5, { nome: 'Telefone B', telefone: MULTIPLE_PHONE });

    await assert.rejects(
      () =>
        repo.createDraft({
          nome: 'Telefone compartilhado',
          telefone: MULTIPLE_PHONE,
          items: items(),
        }),
      (error: unknown) =>
        error instanceof QuoteDraftConflictError && error.code === 'CLIENT_SELECTION_REQUIRED'
    );
  }
);

test(
  'telefone de outro nome só cria novo cadastro com confirmação explícita',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const repo = repository();
    const existing = await addClient(6, { nome: 'Carla Souza', telefone: SHARED_PHONE });
    const payload = { nome: 'Carla Lima', telefone: SHARED_PHONE, items: items() };

    await assert.rejects(
      () =>
        repo.createDraft({ ...payload, creation_request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      (error: unknown) =>
        error instanceof QuoteDraftConflictError && error.code === 'CLIENT_SELECTION_REQUIRED'
    );

    const created = await repo.createDraft({
      ...payload,
      confirm_new_client: true,
      creation_request_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    fixtureClientIds.push(created.cliente_id);
    assert.notEqual(created.cliente_id, existing);
  }
);
