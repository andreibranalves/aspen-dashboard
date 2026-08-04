import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuotationTemplatesHandler } from '../../api/_functions/quotation-templates.js';

const repository = {
  list: async (active?: boolean) => ({ templates: active ? [] : [{ id: 'template-id', key: 'padrao', name: 'Padrão', archived: false, is_default: true, current_version_id: 'version-id', current_version: 1, current_hash: 'a'.repeat(64), updated_at: '2026-08-04T00:00:00.000Z', usage_count: 0 }], default_key: 'padrao' }),
  get: async (id: string) => id ? ({ id: 'template-id', key: 'padrao', name: 'Padrão', archived: false, is_default: true, current_version_id: 'version-id', current_version: 1, current_hash: 'a'.repeat(64), updated_at: '2026-08-04T00:00:00.000Z', usage_count: 0, current_source: '<!doctype html>', versions: [{ id: 'version-id', version: 1, source_hash: 'a'.repeat(64), created_at: '2026-08-04T00:00:00.000Z' }] }) : null,
  create: async () => ({ id: 'template-id' }),
  saveVersion: async () => ({ id: 'version-id' }),
  archive: async () => ({ archived: true as const }),
  setDefault: async () => ({ default_key: 'padrao' }),
  validate: async () => ({ valid: true, warnings: [], preview: '<!doctype html>' }),
};

function event(method: string, path: string, query: Record<string, string> = {}, payload?: object) {
  return { httpMethod: method, headers: {}, queryStringParameters: query, body: payload ? JSON.stringify(payload) : '', url: path };
}

test('template library handler routes metadata, details, validation and mutations through repository seam', async () => {
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  process.env.CRM_CORE_QUOTES_ENABLED = 'true';
  try {
    const handler = createQuotationTemplatesHandler({ repository });
    let response = await handler(event('GET', '/api/quotation-templates'));
    let payload = JSON.parse(response.body!);
    assert.equal(response.statusCode, 200);
    assert.equal('current_source' in payload.data[0], false);

    response = await handler(event('GET', '/api/quotation-templates', { id: 'template-id' }));
    payload = JSON.parse(response.body!);
    assert.equal(payload.data.current_source, '<!doctype html>');
    assert.equal(payload.data.versions.length, 1);

    response = await handler(event('GET', '/api/quotation-templates', { active: 'true' }));
    assert.deepEqual(JSON.parse(response.body!).templates, []);

    response = await handler(event('POST', '/api/quotation-templates', {}, { key: 'novo', name: 'Novo', source: '<!doctype html>' }));
    assert.equal(response.statusCode, 201);
    response = await handler(event('POST', '/api/quotation-templates/validate', {}, { key: 'novo', source: '<!doctype html>' }));
    assert.equal(response.statusCode, 200);
    response = await handler(event('PUT', '/api/quotation-templates', { id: 'template-id' }, { action: 'save_version', source: '<!doctype html>' }));
    assert.equal(response.statusCode, 200);
    response = await handler(event('PUT', '/api/quotation-templates', { id: 'template-id' }, { action: 'archive' }));
    assert.equal(response.statusCode, 200);
    response = await handler(event('PUT', '/api/quotation-templates', { id: 'template-id' }, { action: 'set_default' }));
    assert.equal(response.statusCode, 200);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
  }
});

test('template library handler rejects malformed JSON and unsupported methods', async () => {
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  process.env.CRM_CORE_QUOTES_ENABLED = 'true';
  try {
    const handler = createQuotationTemplatesHandler({ repository });
    assert.equal((await handler({ ...event('POST', '/api/quotation-templates'), body: '{' })).statusCode, 400);
    assert.equal((await handler(event('DELETE', '/api/quotation-templates'))).statusCode, 405);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
  }
});
