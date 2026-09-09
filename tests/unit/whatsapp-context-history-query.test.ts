import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { AppDatabase } from '../../api/_infrastructure/db/client.js';
import { createPostgresWhatsappCrmRepository } from '../../api/_modules/whatsapp-crm-match.js';

test('context history exposes unambiguous SQL columns and maps the latest quotation', async () => {
  let queryChecked = false;
  const db = drizzle(async (query, params) => {
    // PostgreSQL rejects references to duplicate output names in a derived table.
    // Inspect the SQL emitted by the real Drizzle builder, not a mocked query chain.
    const projection = query.match(/from \(select distinct on \([^)]*\) (.*?) from /i)?.[1];
    assert.ok(projection, 'expected the latest-revision derived table');
    const names = projection.split(',').map((field) => {
      const identifiers = [...field.matchAll(/"([^"]+)"/g)];
      return identifiers.at(-1)?.[1];
    });
    assert.equal(new Set(names).size, names.length, 'derived table has ambiguous column names');
    assert.deepEqual(params, ['00000000-0000-4000-8000-000000000001', 6]);
    queryChecked = true;
    return { rows: [[
      '00000000-0000-4000-8000-000000000002', 'ORC-20990001', 'emitido',
      '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z', '150.00',
    ]] };
  });
  const repository = createPostgresWhatsappCrmRepository(() => db as unknown as AppDatabase);
  const history = await repository.listQuotationsByClientId!(
    '00000000-0000-4000-8000-000000000001', 6,
  );
  assert.equal(queryChecked, true);
  assert.deepEqual(history, [{
    id: '00000000-0000-4000-8000-000000000002', businessNumber: 'ORC-20990001',
    status: 'Enviado', date: '2099-01-02', total: '150.00', url: '/#/quotations/ORC-20990001',
  }]);
});
