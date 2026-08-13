import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { createHandler as createBoundary } from '../../api/_functions/quotations.js';
import { createCoreHandler } from '../../api/_functions/quotations-core.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/_db/quotation-lifecycle-repository.ts';
import {
  QuoteManagementConflictError,
  QuoteManagementInputError,
} from '../../api/_db/quote-draft-management-repository.js';

function event(method: string, query: Record<string, string> = {}, body = '') {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: query,
    body,
  } as const;
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, unknown>;
}

const detail = {
  id: 'ORC-20260001',
  quotation_id: 'ORC-20260001',
  quotation_uuid: '11111111-1111-4111-8111-111111111111',
  revision_id: '22222222-2222-4222-8222-222222222222',
  revision: 1,
  status: 'Draft' as const,
  status_canonical: 'rascunho' as const,
  cliente: 'Cliente teste',
  client_id: '33333333-3333-4333-8333-333333333333',
  validade_dias: 15,
  pagamento: 'À vista',
  entrega: '10 dias',
  frete_padrao: '0.00',
  frete: '0.00',
  observacoes: '',
  prazo_producao: '',
  template_padrao: 'padrao',
  subtotal: '90.00',
  total: '90.00',
  items: [],
  concurrency_token: '2026-07-01T12:00:00.000Z',
  updated_at: '2026-07-01T12:00:00.000Z',
};

test('quotations core lists and opens persisted local drafts', async () => {
  const calls: string[] = [];
  const handler = createCoreHandler({
    repository: {
      list: async (options) => {
        calls.push(`list:${options.search || ''}`);
        return {
          rows: [{ ...detail, valor: detail.total }],
          total: 1,
          page: options.page || 1,
          limit: options.limit || 50,
          statusSummary: { Draft: 1, Open: 0 },
        };
      },
      get: async (id) => {
        calls.push(`get:${id}`);
        return id === detail.id ? detail : null;
      },
      update: async () => detail,
    } as any,
  });

  const list = await handler(event('GET', { search: 'teste', page: '2', limit: '10' }));
  assert.equal(list.statusCode, 200);
  assert.equal(Object.keys(parse(list)).some((key) => key.endsWith('_mode')), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parse(list), 'source'), false);
  assert.equal((parse(list).pagination as Record<string, unknown>).page, 2);
  assert.deepEqual(calls, ['list:teste']);

  const opened = await handler(event('GET', { id: detail.id }));
  assert.equal(opened.statusCode, 200);
  assert.equal(parse(opened).quotation_uuid, detail.quotation_uuid);
  assert.equal(parse(opened).concurrency_token, detail.concurrency_token);
  assert.deepEqual(calls, ['list:teste', `get:${detail.id}`]);
});

test('quotations core strips internal metadata from repository details before public output', async () => {
  const detailWithInternalMetadata = {
    ...detail,
    local_mode: true,
    origin: 'local',
  };
  const handler = createCoreHandler({
    repository: {
      list: async () => ({ rows: [], total: 0, page: 1, limit: 50, statusSummary: {} }),
      get: async () => detailWithInternalMetadata,
      update: async () => detailWithInternalMetadata,
    } as any,
  });

  const opened = await handler(event('GET', { id: detail.id }));
  assert.equal(opened.statusCode, 200);
  const payload = parse(opened);
  assert.equal(payload.quotation_uuid, detail.quotation_uuid);
  assert.equal(payload.concurrency_token, detail.concurrency_token);
  assert.equal('local_mode' in payload, false);
  assert.equal('origin' in payload, false);

  const updated = await handler(event('PUT', { id: detail.id }, '{}'));
  assert.equal(updated.statusCode, 200);
  const updatedPayload = parse(updated);
  assert.equal(updatedPayload.quotation_uuid, detail.quotation_uuid);
  assert.equal('local_mode' in updatedPayload, false);
  assert.equal('origin' in updatedPayload, false);
});

test('quotations boundary always invokes PostgreSQL core', async () => {
  const calls: string[] = [];
  const handler = createBoundary({
    core: async (request) => {
      calls.push(request.httpMethod);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    },
  });
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal((await handler(event(method, { id: 'Q-1' }))).statusCode, 200);
  }
  assert.deepEqual(calls, ['GET', 'PUT', 'DELETE']);
});

test('quotations core accepts and forwards the legacy quotation ordering vocabulary', async () => {
  const orders: string[] = [];
  const handler = createCoreHandler({
    repository: {
      list: async (options) => {
        orders.push(options.orderBy || '');
        return { rows: [], total: 0, page: 1, limit: 50, statusSummary: {} };
      },
      get: async () => null,
      update: async () => detail,
    } as any,
  });
  for (const orderBy of [
    'creation desc',
    'creation asc',
    'transaction_date desc',
    'transaction_date asc',
    'valid_till desc',
    'valid_till asc',
    'name desc',
    'name asc',
    'grand_total desc',
    'grand_total asc',
    'updated_at desc',
    'updated_at asc',
  ]) {
    const response = await handler(event('GET', { order_by: orderBy }));
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(orders, [
    'creation desc',
    'creation asc',
    'transaction_date desc',
    'transaction_date asc',
    'valid_till desc',
    'valid_till asc',
    'name desc',
    'name asc',
    'grand_total desc',
    'grand_total asc',
    'updated_at desc',
    'updated_at asc',
  ]);
});

test('quotations core forwards complete update input and maps stale/non-editable conflicts', async () => {
  let received: Record<string, unknown> | undefined;
  const handler = createCoreHandler({
    repository: {
      list: async () => ({ rows: [], total: 0, page: 1, limit: 50, statusSummary: {} }),
      get: async () => detail,
      update: async (_id, input) => {
        received = input as Record<string, unknown>;
        return detail;
      },
    } as any,
  });
  const payload = {
    concurrency_token: detail.concurrency_token,
    client_id: detail.client_id,
    items: [{ item_code: 'SKU-1', qty: '30.000', rate: '4.00', manual_rate: true }],
    validade_dias: 30,
    pagamento: '30 dias',
    entrega: '15 dias',
    frete: '3.50',
    observacoes: 'Atualizado',
    prazo_producao: '5 dias',
  };
  const updated = await handler(event('PUT', { id: detail.id }, JSON.stringify(payload)));
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(received, payload);

  const conflictHandler = createCoreHandler({
    repository: {
      list: async () => ({ rows: [], total: 0, page: 1, limit: 50, statusSummary: {} }),
      get: async () => detail,
      update: async () => { throw new QuoteManagementConflictError('O orçamento foi alterado por outro usuário.'); },
    } as any,
  });
  const conflict = await conflictHandler(event('PUT', { id: detail.id }, JSON.stringify(payload)));
  assert.equal(conflict.statusCode, 409);
  assert.equal(parse(conflict).error, 'O orçamento foi alterado por outro usuário.');
  assert.equal(Object.keys(parse(conflict)).some((key) => key.endsWith('_mode')), false);
});

test('actual lifecycle repository status transition returns no issuance artifacts', async () => {
  const lifecycleSource = await readFile(new URL('../../api/_db/quotation-lifecycle-repository.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(lifecycleSource, new RegExp('quotation-pdf|quotation-document-storage|@vercel/blob|issued_documents'));
  const quotation = {
    id: detail.quotation_uuid,
    businessNumber: detail.id,
    status: 'enviado',
    updatedAt: new Date(detail.concurrency_token),
  };
  const revision = { id: detail.revision_id, quotationId: quotation.id, status: 'enviado' };
  let selectCount = 0;
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({ limit: async () => (++selectCount === 1 ? [quotation] : [revision]) }),
          orderBy: () => ({ limit: async () => [revision] }),
          limit: async () => (++selectCount === 1 ? [quotation] : [revision]),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{
      id: '44444444-4444-4444-8444-444444444444',
      eventType: 'quotation.updated',
      provider: 'crm',
      aggregateType: 'quotation',
      aggregateId: quotation.id,
      payloadReference: {
        quotationId: quotation.id,
        revisionId: revision.id,
        businessNumber: quotation.businessNumber,
      },
      idempotencyKey: 'quotation.updated:crm:test',
      status: 'pending',
      attempts: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: quotation.updatedAt,
      lastErrorClass: null,
      providerMessageId: null,
      createdAt: quotation.updatedAt,
      updatedAt: quotation.updatedAt,
      deliveredAt: null,
    }] }) }) }),
  };
  const lifecycle = createPostgresQuotationLifecycleRepository(
    () => ({ transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as any),
    {
      acquireWriteLock: async () => undefined,
      readDetail: async () => ({
        ...detail,
        status: 'Approved',
        status_canonical: 'aprovado',
        revision_history: [{ revision_id: detail.revision_id, status_canonical: 'aprovado' }],
      } as any),
    },
  );
  const payload = await lifecycle.setStatus(detail.id, {
    status: 'aprovado',
    concurrency_token: detail.concurrency_token,
  }) as unknown as Record<string, unknown>;
  assert.equal(payload.status_canonical, 'aprovado');
  for (const key of ['pdf_url', 'document_url', 'issued_document', 'issued_document_id']) {
    assert.equal(key in payload, false, `lifecycle response must not expose ${key}`);
  }
  assert.deepEqual(payload.revision_history, [{ revision_id: detail.revision_id, status_canonical: 'aprovado' }]);
});

test('quotations core validates JSON/status and never exposes unknown repository failures', async () => {
  const handler = createCoreHandler({
    repository: {
      list: async () => { throw new Error('postgres://secret'); },
      get: async () => null,
      update: async () => { throw new QuoteManagementInputError('Items deve ser um array.'); },
    } as any,
  });
  const badJson = await handler(event('PUT', { id: detail.id }, '{'));
  assert.equal(badJson.statusCode, 400);
  assert.equal(parse(badJson).error, 'JSON inválido.');
  const badStatus = await handler(event('GET', { status: 'invalid' }));
  assert.equal(badStatus.statusCode, 400);
  const hidden = await handler(event('GET'));
  assert.equal(hidden.statusCode, 503);
  assert.equal(String(hidden.body).includes('secret'), false);
});
