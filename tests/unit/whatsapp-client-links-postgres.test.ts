import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { createWhatsappClientLinksRepository, LinkConflict } from '../../api/_infrastructure/db/repositories/whatsapp-client-links.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../api/_infrastructure/db/schema.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';
import { parsePostgresUrl, postgresIdentity } from '../../scripts/postgres-target.mjs';

const temporary = process.env.CLIENT_CONSOLIDATION_TEMP_DATABASE_URL;
if (temporary) {
  const identity = (value: string) => postgresIdentity(parsePostgresUrl(value));
  if (!process.env.RESTORE_DATABASE_URL || !process.env.PRODUCTION_DATABASE_URL ||
      identity(temporary) !== identity(process.env.RESTORE_DATABASE_URL) || identity(temporary) === identity(process.env.PRODUCTION_DATABASE_URL)) {
    throw new Error('Teste temporário exige restauração isolada de produção.');
  }
}
const url = temporary || resolveDisposableTestDatabaseUrl();

test('client links enforce scope, compare-and-swap, FK and deletion cleanup in PostgreSQL', { skip: !url }, async () => {
  const connection = postgres(url!, { max: 1, prepare: false });
  try {
    await connection.unsafe('CREATE TEMP TABLE clients (id uuid PRIMARY KEY, nome text, telefone text, email text, arquivado boolean DEFAULT false)');
    await connection.unsafe('SET search_path = pg_temp');
    const migration = await readFile(new URL('../../drizzle/0034_whatsapp_client_links.sql', import.meta.url), 'utf8');
    for (const statement of migration.replace('CREATE TABLE', 'CREATE TEMP TABLE').split('--> statement-breakpoint')) await connection.unsafe(statement);
    const id = randomUUID();
    await connection.unsafe('INSERT INTO clients (id,nome,telefone) VALUES ($1,$2,$3)', [id, 'Cliente exemplo', '41999701234']);
    const repo = createWhatsappClientLinksRepository(() => drizzle(connection, { schema }));
    const scope = { accountId: '5511988881234@s.whatsapp.net', conversationId: '123456789@lid' };
    const input = { clientId: id, expectedClientPhone: '41999701234', expectedClientName: 'Cliente exemplo', observedPhone: '554199701234', expectedVersion: null };
    const results = await Promise.allSettled([repo.save(scope, input), repo.save(scope, input)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const first = await repo.get(scope);
    assert.ok(first);
    assert.equal(await repo.get({ ...scope, accountId: '5511977771234@s.whatsapp.net' }), null);
    const next = await repo.save(scope, { ...input, expectedVersion: first.version });
    await connection.unsafe('UPDATE clients SET telefone=$1 WHERE id=$2', ['41988881234', id]);
    await assert.rejects(repo.save(scope, { ...input, expectedVersion: next.version }), LinkConflict);
    await connection.unsafe('UPDATE clients SET telefone=$1 WHERE id=$2', ['41999701234', id]);
    await assert.rejects(repo.remove(scope, first.version), LinkConflict);
    await assert.rejects(repo.save(scope, { ...input, clientId: randomUUID(), expectedVersion: next.version }), LinkConflict);
    assert.equal((await repo.get(scope))?.version, next.version);
    await repo.remove(scope, next.version);
    assert.equal(await repo.get(scope), null);
    await repo.save(scope, input);
    assert.equal((await repo.search('exemplo')).length, 1);
    assert.equal((await repo.search('%')).length, 0);
    await connection.unsafe('DELETE FROM clients WHERE id=$1', [id]);
    assert.equal(await repo.get(scope), null);
  } finally { await connection.end({ timeout: 5 }); }
});
