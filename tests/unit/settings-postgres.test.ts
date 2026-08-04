import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { createPostgresSettingsRepository } from '../../api/_db/settings-repository.js';
import {
  createPostgresProductsRepository,
  ProductRepositoryError,
} from '../../api/_db/products-repository.js';
import { createPostgresClientRepository } from '../../api/_db/client-repository.js';
import * as schema from '../../api/_db/schema.js';
import { createHandler } from '../../api/_functions/settings.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);

function event(method: string, body?: unknown) {
  return {
    httpMethod: method,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
  };
}

function parse(result: { body?: string }): any {
  return JSON.parse(result.body || '{}');
}

test(
  'PostgreSQL settings/products/clients migration and persistence vertical slice',
  { skip: !TEST_DATABASE_URL },
  async () => {
    assert.ok(
      TEST_DATABASE_URL,
      'TEST_DATABASE_URL é obrigatório; use o container dedicado postgres:16.'
    );
    const client = postgres(TEST_DATABASE_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
    const db = drizzle(client, { schema });

    try {
      // TEST_DATABASE_URL is intentionally a dedicated integration database.
      // Resetting both schemas proves that the committed migration starts from
      // an empty PostgreSQL database on every run.
      await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
      await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
      await client.unsafe('CREATE SCHEMA public');
      await migrate(db, { migrationsFolder });

      const [moneyColumn] = await client`
        SELECT data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'app_settings'
          AND column_name = 'frete_padrao'
      `;
      assert.equal(moneyColumn.data_type, 'numeric');
      assert.equal(moneyColumn.numeric_precision, 14);
      assert.equal(moneyColumn.numeric_scale, 2);

      const handler = createHandler({
        repository: createPostgresSettingsRepository(() => db),
      });

      const defaults = await handler(event('GET'));
      assert.equal(defaults.statusCode, 200);
      assert.deepEqual(parse(defaults), {
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
      });

      const saved = await handler(
        event('PUT', {
          validade_dias: 45,
          pagamento: 'Pix em 30 dias',
          entrega: '15 dias úteis',
          frete_padrao: '000129.9',
          observacoes: 'Enviar prova digital para aprovação.',
          template_padrao: 'comercial-2026',
        })
      );
      assert.equal(saved.statusCode, 200);
      assert.deepEqual(parse(saved), {
        validade_dias: 45,
        pagamento: 'Pix em 30 dias',
        entrega: '15 dias úteis',
        frete_padrao: '129.90',
        observacoes: 'Enviar prova digital para aprovação.',
        template_padrao: 'comercial-2026',
      });

      const reloaded = await handler(event('GET'));
      assert.equal(reloaded.statusCode, 200);
      assert.deepEqual(parse(reloaded), parse(saved));

      const invalid = await handler(
        event('PUT', {
          validade_dias: 45,
          pagamento: '',
          entrega: '',
          frete_padrao: '129.999',
          observacoes: '',
          template_padrao: 'comercial-2026',
        })
      );
      assert.equal(invalid.statusCode, 400);
      assert.match(parse(invalid).fields.frete_padrao, /duas casas decimais/);

      await assert.rejects(
        () =>
          client`
            INSERT INTO app_settings (
              singleton_id, validade_dias, pagamento, entrega,
              frete_padrao, observacoes, template_padrao
            ) VALUES (${2}, ${15}, ${''}, ${''}, ${'0.00'}, ${''}, ${'padrao'})
          `,
        /app_settings_singleton_id_check/
      );
      await assert.rejects(
        () => client`UPDATE app_settings SET frete_padrao = ${'-0.01'} WHERE singleton_id = ${1}`,
        /app_settings_frete_padrao_check/
      );

      const productsRepository = createPostgresProductsRepository(() => db);
      const created = await productsRepository.create({
        sku: ' CORE-001 ',
        nome: 'Produto principal',
        descricao: 'Descrição',
        categoria: 'Categoria',
      });
      // The repository boundary owns trimming and defaults.
      assert.equal(created.sku, 'CORE-001');
      assert.equal(created.unidade, 'Und');
      assert.equal(created.ativo, true);
      assert.equal(created.arquivado_em, null);

      await assert.rejects(
        () => productsRepository.create({ sku: 'CORE-001', nome: 'Duplicado' }),
        (error: unknown) => error instanceof ProductRepositoryError && error.statusCode === 409
      );

      const active = await productsRepository.list({
        status: 'active',
        search: 'core',
        page: 1,
        limit: 10,
      });
      assert.equal(active.total, 1);
      assert.equal(active.rows[0]?.sku, 'CORE-001');

      const archived = await productsRepository.archive('CORE-001');
      assert.equal(archived?.ativo, false);
      assert.equal((await productsRepository.list({ status: 'active' })).total, 0);
      assert.equal((await productsRepository.list({ status: 'archived' })).total, 1);

      const restored = await productsRepository.update('CORE-001', {
        ativo: true,
        nome: 'Atualizado',
      });
      assert.equal(restored?.ativo, true);
      assert.equal(restored?.nome, 'Atualizado');
      assert.equal((await productsRepository.list({ status: 'active' })).total, 1);

      const clientsRepository = createPostgresClientRepository(() => db);
      const createdClient = await clientsRepository.create({
        nome: 'Maria Cliente',
        documento: '123.456.789-01',
        email: 'MARIA@EXAMPLE.COM',
        telefone: '(11) 99999-0000',
        notes: 'Preferência por e-mail',
        address: {
          endereco: 'Rua das Flores',
          numero: '123',
          bairro: 'Centro',
          complemento: 'Sala 4',
          municipio: 'São Paulo',
          uf: 'sp',
          cep: '01001-000',
        },
      });
      assert.match(createdClient.id, /^[0-9a-f-]{36}$/i);
      assert.equal(createdClient.documento, '12345678901');
      assert.equal(createdClient.email, 'maria@example.com');
      assert.equal(createdClient.telefone, '11999990000');
      assert.equal(createdClient.notes, 'Preferência por e-mail');
      assert.equal(createdClient.address?.uf, 'SP');

      const [storedClient] =
        await client`SELECT id, documento FROM clients WHERE id = ${createdClient.id}::uuid`;
      assert.equal(storedClient.id, createdClient.id);
      assert.equal(storedClient.documento, '12345678901');

      for (const search of [
        'Maria',
        '123.456.789-01',
        'maria@example.com',
        '11999990000',
        '(11) 99999-0000',
      ]) {
        const result = await clientsRepository.list({ search, status: 'all' });
        assert.equal(result.total, 1, `busca literal por ${search}`);
      }
      assert.equal((await clientsRepository.list({ search: '%', status: 'all' })).total, 0);
      assert.equal((await clientsRepository.list({ search: '11%', status: 'all' })).total, 0);
      assert.equal((await clientsRepository.list({ search: '11_', status: 'all' })).total, 0);

      await assert.rejects(
        () => clientsRepository.create({ nome: 'Duplicada', documento: '12345678901' }),
        (error: unknown) => (error as { statusCode?: number }).statusCode === 409
      );
      const withoutDocument = await clientsRepository.create({ nome: 'Sem documento' });
      assert.equal(withoutDocument.documento, null);
      const withoutDocumentAgain = await clientsRepository.create({ nome: 'Sem documento 2' });
      assert.equal(withoutDocumentAgain.documento, null);

      const patchedClient = await clientsRepository.update(createdClient.id, {
        email: null,
        notes: null,
        address: { bairro: 'Vila Nova' } as any,
      });
      assert.equal(patchedClient.email, null);
      assert.equal(patchedClient.notes, null);
      assert.equal(patchedClient.address?.endereco, 'Rua das Flores');
      assert.equal(patchedClient.address?.bairro, 'Vila Nova');

      const clearedAddress = await clientsRepository.update(createdClient.id, {
        address: { bairro: null } as any,
      });
      assert.equal(clearedAddress.address?.bairro, null);
      await clientsRepository.update(createdClient.id, { address: null });
      assert.equal((await clientsRepository.get(createdClient.id))?.address, null);

      const archivedClient = await clientsRepository.archive(createdClient.id);
      assert.equal(archivedClient.arquivado, true);
      const archivedAgain = await clientsRepository.archive(createdClient.id);
      assert.equal(archivedAgain.archivedAt, archivedClient.archivedAt);
      assert.equal(
        (await clientsRepository.list({ status: 'active' })).data.some(
          (row) => row.id === createdClient.id
        ),
        false
      );
      assert.equal(
        (await clientsRepository.list({ status: 'archived' })).data.some(
          (row) => row.id === createdClient.id
        ),
        true
      );
      const restoredClient = await clientsRepository.update(createdClient.id, { arquivado: false });
      assert.equal(restoredClient.arquivado, false);
      assert.equal(restoredClient.archivedAt, null);

      await assert.rejects(
        () => clientsRepository.update(createdClient.id, { arquivado: 'false' as any }),
        (error: unknown) => (error as { statusCode?: number }).statusCode === 400
      );
      await assert.rejects(
        () => clientsRepository.create({ nome: 'Inválida', email: 'not-an-email' }),
        (error: unknown) => (error as { statusCode?: number }).statusCode === 400
      );

      await assert.rejects(
        () => client`INSERT INTO clients (id, nome) VALUES (${randomUUID()}::uuid, ${''})`,
        /clients_nome_not_blank_check/
      );
      await assert.rejects(
        () =>
          client`INSERT INTO clients (id, nome, documento) VALUES (${randomUUID()}::uuid, ${'Documento curto'}, ${'123'})`,
        /clients_documento_length_check/
      );
      await assert.rejects(
        () =>
          client`INSERT INTO clients (id, nome, email) VALUES (${randomUUID()}::uuid, ${'E-mail maiúsculo'}, ${'UPPER@EXAMPLE.COM'})`,
        /clients_email_lowercase_check/
      );
      await assert.rejects(
        () =>
          client`INSERT INTO clients (id, nome, uf) VALUES (${randomUUID()}::uuid, ${'UF inválida'}, ${'sp'})`,
        /clients_uf_uppercase_check/
      );

      const [physicalTable] = await client`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'products'
      `;
      assert.equal(physicalTable.table_name, 'products');
    } finally {
      await client.end({ timeout: 5 });
    }
  }
);
