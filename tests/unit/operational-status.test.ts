import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../../api/_modules/operational-status.js';

test('reports PostgreSQL and local settings readiness', async () => {
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

test('exposes non-sensitive deployment identity for staging E2E proof (#118)', async () => {
  const previewEnv = { APP_ENV: 'Preview', EXTERNAL_WRITES_ENABLED: '0' } as NodeJS.ProcessEnv;
  const body = JSON.parse((await handler({ httpMethod: 'GET' }, previewEnv)).body || '{}');
  // Ticket #118: o deployment remoto comprova ambiente e writes-off.
  assert.deepEqual(body.deployment_identity, {
    app_env: 'preview',
    external_writes_enabled: false,
    persistence: 'postgres',
  });

  const productionEnv = {
    APP_ENV: 'production',
    EXTERNAL_WRITES_ENABLED: '1',
  } as NodeJS.ProcessEnv;
  const productionBody = JSON.parse((await handler({ httpMethod: 'GET' }, productionEnv)).body || '{}');
  assert.deepEqual(productionBody.deployment_identity, {
    app_env: 'production',
    external_writes_enabled: true,
    persistence: 'postgres',
  });
});

test('deployment identity is missing-safe when environment is absent', async () => {
  const body = JSON.parse((await handler({ httpMethod: 'GET' }, {} as NodeJS.ProcessEnv)).body || '{}');
  assert.deepEqual(body.deployment_identity, {
    app_env: '',
    external_writes_enabled: false,
    persistence: 'postgres',
  });
});

test('rejects non-GET readiness requests in Portuguese', async () => {
  const response = await handler({ httpMethod: 'POST' } as any);
  assert.equal(response.statusCode, 405);
  assert.match(response.body || '', /Método não permitido/);
});
