import assert from 'node:assert/strict';
import test from 'node:test';

import type { FunctionEvent } from '../../api/_http/types.js';
import { createCrmPipelineStagesHandler } from '../../api/_modules/crm-pipeline-stages.js';
import type {
  CrmPipelineStage,
  CrmPipelineStageRepository,
} from '../../api/_infrastructure/db/repositories/crm-pipeline-stages-repository.js';

function event(
  httpMethod: string,
  body?: unknown,
  queryStringParameters: Record<string, string> = {}
): FunctionEvent {
  return {
    httpMethod,
    headers: {},
    body: body === undefined ? '' : JSON.stringify(body),
    queryStringParameters,
  };
}

function memoryRepository(): CrmPipelineStageRepository & { rows: CrmPipelineStage[] } {
  const rows: CrmPipelineStage[] = [
    { key: 'Novo Lead', name: 'Novo lead', position: 0, role: 'new', dealCount: 2 },
    { key: 'Contato Feito', name: 'Contato feito', position: 1, role: null, dealCount: 0 },
    { key: 'Perdido', name: 'Perdido', position: 2, role: 'lost', dealCount: 1 },
  ];
  return {
    rows,
    async list() {
      return rows.map((row) => ({ ...row }));
    },
    async create(name) {
      const stage = {
        key: 'custom_stage',
        name,
        position: rows.length,
        role: null,
        dealCount: 0,
      };
      rows.push(stage);
      return { ...stage };
    },
    async rename(key, name) {
      const stage = rows.find((row) => row.key === key);
      if (!stage) return null;
      stage.name = name;
      return { ...stage };
    },
    async reorder(keys) {
      keys.forEach((key, position) => {
        const stage = rows.find((row) => row.key === key);
        if (stage) stage.position = position;
      });
      rows.sort((left, right) => left.position - right.position);
      return rows.map((row) => ({ ...row }));
    },
    async remove(key) {
      const index = rows.findIndex((row) => row.key === key);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

test('lists, creates and renames CRM pipeline stages', async () => {
  const repository = memoryRepository();
  const handler = createCrmPipelineStagesHandler({ repository });

  const listed = await handler(event('GET'));
  assert.equal(listed.statusCode, 200);
  assert.equal(JSON.parse(listed.body || '').stages.length, 3);

  const created = await handler(event('POST', { name: 'Qualificação' }));
  assert.equal(created.statusCode, 201);
  assert.equal(JSON.parse(created.body || '').stage.name, 'Qualificação');

  const renamed = await handler(
    event('PATCH', { key: 'Contato Feito', name: 'Contato realizado' })
  );
  assert.equal(renamed.statusCode, 200);
  assert.equal(JSON.parse(renamed.body || '').stage.name, 'Contato realizado');
});

test('reorders the complete pipeline and rejects incomplete stage lists', async () => {
  const repository = memoryRepository();
  const handler = createCrmPipelineStagesHandler({ repository });

  const reordered = await handler(
    event('PATCH', { ordered_keys: ['Perdido', 'Novo Lead', 'Contato Feito'] })
  );
  assert.equal(reordered.statusCode, 200);
  assert.deepEqual(
    JSON.parse(reordered.body || '').stages.map((stage: CrmPipelineStage) => stage.key),
    ['Perdido', 'Novo Lead', 'Contato Feito']
  );

  const incomplete = await handler(event('PATCH', { ordered_keys: ['Novo Lead'] }));
  assert.equal(incomplete.statusCode, 400);
  assert.equal(JSON.parse(incomplete.body || '').error, 'Informe todas as etapas uma única vez.');
});

test('validates names and protects required or non-empty stages from removal', async () => {
  const repository = memoryRepository();
  const handler = createCrmPipelineStagesHandler({ repository });

  const blank = await handler(event('POST', { name: '   ' }));
  assert.equal(blank.statusCode, 400);
  assert.equal(JSON.parse(blank.body || '').error, 'Nome da etapa é obrigatório.');

  const required = await handler(event('DELETE', undefined, { key: 'Novo Lead' }));
  assert.equal(required.statusCode, 409);
  assert.equal(
    JSON.parse(required.body || '').error,
    'Esta etapa é obrigatória para o funcionamento do CRM.'
  );

  repository.rows[1].dealCount = 1;
  const occupied = await handler(event('DELETE', undefined, { key: 'Contato Feito' }));
  assert.equal(occupied.statusCode, 409);
  assert.equal(
    JSON.parse(occupied.body || '').error,
    'Mova os negócios desta etapa antes de removê-la.'
  );

  repository.rows[1].dealCount = 0;
  const removed = await handler(event('DELETE', undefined, { key: 'Contato Feito' }));
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(JSON.parse(removed.body || ''), { success: true, key: 'Contato Feito' });
});

test('rejects unsupported methods before parsing their body', async () => {
  const handler = createCrmPipelineStagesHandler({ repository: memoryRepository() });
  const result = await handler({ ...event('PUT'), body: '{invalid' });

  assert.equal(result.statusCode, 405);
  assert.equal(JSON.parse(result.body || '').error, 'Método não permitido.');
});
