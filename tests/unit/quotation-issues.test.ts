import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotationIssuesHandler } from '../../api/_modules/quotation-issues.js';

const event = (httpMethod: string, headers: Record<string, string> = {}, body = '{}', queryStringParameters: Record<string, string> = {}) => ({
  httpMethod,
  headers,
  body,
  queryStringParameters,
});
const KEY = '00000000-0000-4000-8000-000000000001';
const REVISION_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '2026-08-10T12:00:00.000Z';
const referenceBody = JSON.stringify({ revision_id: REVISION_ID, concurrency_token: TOKEN });

test('POST requires Idempotency-Key', async () => {
  const response = await createQuotationIssuesHandler()(event('POST'));
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body || '{}').error, /Idempotency-Key/);
});

test('POST requires revision identity and concurrency token', async () => {
  const missingRevision = await createQuotationIssuesHandler()(
    event('POST', { 'Idempotency-Key': KEY }, JSON.stringify({ concurrency_token: TOKEN }))
  );
  assert.equal(missingRevision.statusCode, 400);
  assert.match(JSON.parse(missingRevision.body || '{}').error, /revisão/i);

  const missingToken = await createQuotationIssuesHandler()(
    event('POST', { 'Idempotency-Key': KEY }, JSON.stringify({ revision_id: REVISION_ID }))
  );
  assert.equal(missingToken.statusCode, 400);
  assert.match(JSON.parse(missingToken.body || '{}').error, /concorrência/i);
});

test('POST forwards only revision reference fields to the repository', async () => {
  let captured: unknown;
  const response = await createQuotationIssuesHandler({
    issue: async (input) => {
      captured = input;
      return {
        quotationId: 'q', businessNumber: 'ORC-1', revisionId: input.revisionId, revisionNumber: 1,
        status: 'emitido' as const, issuedAt: TOKEN, validUntil: '2026-08-25', pdfUrl: '/pdf',
      };
    },
  })(
    event(
      'POST',
      { 'Idempotency-Key': KEY },
      JSON.stringify({
        draft: { extracted: { nome: 'Campo do navegador', items: [{ sku: 'X' }] } },
        revision_id: REVISION_ID,
        concurrency_token: TOKEN,
        sourceLeadId: 'também-ignorado',
        sourceQuotationId: 'ignorado',
        sourceRevisionId: 'ignorado',
      })
    )
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(captured, { idempotencyKey: KEY, revisionId: REVISION_ID, concurrencyToken: TOKEN });
});

test('GET is read-only and returns injected status without issue calls', async () => {
  let issueCalls = 0;
  let readCalls = 0;
  const response = await createQuotationIssuesHandler({
    issue: async () => { issueCalls += 1; throw new Error('issue must not run'); },
    read: async () => { readCalls += 1; return { state: 'processing', retryAfterMs: 1000 }; },
  })(event('GET', {}, '{}', { idempotency_key: '00000000-0000-4000-8000-000000000001' }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body || '{}'), { state: 'processing', retryAfterMs: 1000 });
  assert.equal(readCalls, 1);
  assert.equal(issueCalls, 0);
});

test('POST maps stale token or already-issued conflicts to safe Portuguese 409', async () => {
  const response = await createQuotationIssuesHandler({
    issue: async () => { throw new (await import('../../api/_infrastructure/db/repositories/quotation-issue-repository.js')).QuotationIssueConflictError('O orçamento foi alterado por outro usuário. Recarregue antes de emitir.'); },
  })(event('POST', { 'Idempotency-Key': KEY }, referenceBody));
  assert.equal(response.statusCode, 409);
  assert.match(JSON.parse(response.body || '{}').error, /alterado por outro usuário/i);
});

test('POST maps PDF failure to safe Portuguese 503', async () => {
  const response = await createQuotationIssuesHandler({
    issue: async () => { throw new (await import('../../api/_infrastructure/db/repositories/quotation-issue-repository.js')).QuotationIssueRepositoryError('Não foi possível gerar o PDF do orçamento. Tente novamente.'); },
  })(event('POST', { 'Idempotency-Key': KEY }, referenceBody));
  assert.equal(response.statusCode, 503);
  assert.match(JSON.parse(response.body || '{}').error, /PDF/i);
});

test('unsupported methods return Portuguese method error', async () => {
  const response = await createQuotationIssuesHandler()(event('PUT'));
  assert.equal(response.statusCode, 405);
  assert.match(JSON.parse(response.body || '{}').error, /Método não permitido/);
});
