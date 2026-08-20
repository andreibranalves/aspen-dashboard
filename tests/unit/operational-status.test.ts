import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../../api/_modules/operational-status.js';

test('reports PostgreSQL and local settings readiness without deployment metadata', async () => {
  const response = await handler({ httpMethod: 'GET' } as any);
  const body = JSON.parse(response.body || '{}');
  assert.equal(response.statusCode, 200);
  assert.equal(typeof body.ready, 'boolean');
  assert.equal(typeof body.checks.database_connected, 'boolean');
  assert.equal(typeof body.checks.mandatory_settings, 'boolean');
  assert.deepEqual(Object.keys(body.checks).sort(), ['database_connected', 'mandatory_settings']);
  assert.equal(
    Object.prototype.hasOwnProperty.call(body, 'details') &&
      Object.prototype.hasOwnProperty.call(body.details, 'settings_missing'),
    true
  );
});

test('rejects non-GET readiness requests in Portuguese', async () => {
  const response = await handler({ httpMethod: 'POST' } as any);
  assert.equal(response.statusCode, 405);
  assert.match(response.body || '', /Método não permitido/);
});
