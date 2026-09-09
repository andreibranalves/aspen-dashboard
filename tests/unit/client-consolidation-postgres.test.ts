import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { createClientConsolidationRepository } from '../../api/_infrastructure/db/repositories/client-consolidation-repository.js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';
import { parsePostgresUrl, postgresIdentity } from '../../scripts/postgres-target.mjs';

// Explicit operational opt-in for the temporary-table-only test when local
// Docker is unavailable. Never widen the shared disposable database resolver.
const remoteTemporary = process.env.CLIENT_CONSOLIDATION_TEMP_DATABASE_URL;
if (remoteTemporary) {
  const identity = (value: string) => postgresIdentity(parsePostgresUrl(value));
  if (!process.env.RESTORE_DATABASE_URL || !process.env.PRODUCTION_DATABASE_URL ||
      identity(remoteTemporary) !== identity(process.env.RESTORE_DATABASE_URL) ||
      identity(remoteTemporary) === identity(process.env.PRODUCTION_DATABASE_URL)) {
    throw new Error('Teste temporário exige alvo de restauração isolado da produção.');
  }
}
const url = remoteTemporary || resolveDisposableTestDatabaseUrl();

test('consolidation transfers history, preserves identity, backs up and rolls back atomically', { skip: !url }, async () => {
  const connection = postgres(url!, { max: 1, prepare: false });
  const observer = postgres(url!, { max: 1, prepare: false });
  const db = drizzle(connection, { schema });
  try {
    // All fixtures live in this connection's temporary schema. No durable rows
    // or migration state are created, updated or removed by this test.
    await connection`CREATE TEMP TABLE clients (
      id uuid PRIMARY KEY, nome text NOT NULL, documento text UNIQUE, email text,
      telefone text, notes text, endereco text, numero text, bairro text,
      complemento text, municipio text, uf text, cep text,
      arquivado boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz)`;
    await connection`SET search_path = pg_temp`;
    for (const table of ['quotations', 'crm_deals', 'sales_orders']) {
      await connection.unsafe(`CREATE TEMP TABLE ${table} (id uuid PRIMARY KEY, client_id uuid REFERENCES pg_temp.clients(id), created_at timestamptz DEFAULT now())`);
    }
    const old = randomUUID(); const winner = randomUUID();
    await connection`INSERT INTO clients (id,nome,telefone,documento,notes) VALUES
      (${old},'Teste antigo','21999998888','11111111111','Primeiro atendimento'),
      (${winner},'Teste recente','5521999998888',null,'Último atendimento')`;
    await connection`UPDATE clients SET endereco='Rua antiga',numero='10' WHERE id=${old}`;
    await connection`UPDATE clients SET endereco='Rua atual' WHERE id=${winner}`;
    await connection`INSERT INTO quotations VALUES (${randomUUID()},${old},'2026-01-01'),(${randomUUID()},${winner},'2026-02-01')`;
    await connection`INSERT INTO crm_deals (id,client_id) VALUES (${randomUUID()},${old})`;
    await connection`INSERT INTO sales_orders (id,client_id) VALUES (${randomUUID()},${old})`;
    const repository = createClientConsolidationRepository(() => db);
    assert.equal((await repository.run()).groups[0].survivor, winner);
    assert.equal((await connection`SELECT * FROM clients`).length, 2);
    await assert.rejects(repository.run({ backup: async () => { throw new Error('disk full'); } }));
    assert.equal((await connection`SELECT * FROM clients`).length, 2);
    // An unknown FK must fail closed after the updates and restore those updates.
    await connection`CREATE TEMP TABLE unexpected_link (client_id uuid REFERENCES pg_temp.clients(id))`;
    await connection`INSERT INTO unexpected_link VALUES (${old})`;
    await assert.rejects(repository.run({ backup: async () => {} }));
    assert.equal((await connection`SELECT client_id FROM sales_orders`)[0].client_id, old);
    await connection`DELETE FROM unexpected_link`;
    let snapshot: Record<string, unknown> | undefined;
    const [{ pid }] = await connection`SELECT pg_backend_pid() AS pid`;
    const result = await repository.run({ backup: async value => {
      const [{ locks }] = await observer`SELECT count(*)::int AS locks FROM pg_locks WHERE pid=${pid} AND mode='ShareRowExclusiveLock' AND granted`;
      assert.equal(locks, 4, 'all four tables remain locked before the backup and writes');
      snapshot = JSON.parse(JSON.stringify(value));
    } });
    assert.deepEqual(result.transferred, { quotations: 1, deals: 1, orders: 1 });
    const rows = await connection`SELECT * FROM clients`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, winner);
    assert.equal(rows[0].documento, '11111111111');
    assert.equal(rows[0].endereco, 'Rua atual');
    assert.equal(rows[0].numero, null, 'never combine different addresses');
    assert.match(rows[0].notes, /Primeiro atendimento/);
    assert.match(rows[0].notes, /Último atendimento/);
    for (const table of ['quotations', 'crm_deals', 'sales_orders']) {
      const links = await connection.unsafe(`SELECT client_id FROM ${table}`);
      assert.ok(links.every(row => row.client_id === winner));
    }
    assert.equal((snapshot?.clients as unknown[]).length, 2);
    assert.equal((await repository.run()).groups.length, 0);
    // Restore the exact pre-consolidation client records and reference owners
    // from the serialized backup, including the unique document's old owner.
    const savedClients = snapshot!.clients as Array<typeof schema.clients.$inferSelect>;
    await db.transaction(async tx => {
      await tx.update(schema.clients).set({ documento: null }).where(inArray(schema.clients.id, savedClients.map(row => row.id)));
      for (const row of savedClients) {
        const restored = { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), archivedAt: row.archivedAt ? new Date(row.archivedAt) : null };
        await tx.insert(schema.clients).values(restored).onConflictDoUpdate({ target: schema.clients.id, set: restored });
      }
      for (const [key, table] of [['quotations', schema.quotations], ['deals', schema.crmDeals], ['orders', schema.salesOrders]] as const) {
        for (const link of snapshot![key] as Array<{ id: string; clientId: string }>) {
          await tx.update(table).set({ clientId: link.clientId }).where(eq(table.id, link.id));
        }
      }
    });
    assert.equal((await connection`SELECT * FROM clients`).length, 2);
    assert.equal((await connection`SELECT client_id FROM sales_orders`)[0].client_id, old);
    assert.equal((await connection`SELECT documento FROM clients WHERE id = ${old}`)[0].documento, '11111111111');
  } finally { await Promise.all([connection.end({ timeout: 5 }), observer.end({ timeout: 5 })]); }
});
