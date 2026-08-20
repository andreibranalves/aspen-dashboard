import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotationIssuesHandler } from '../../api/_modules/quotation-issues.js';

const event = (httpMethod: string, headers: Record<string, string> = {}, body = '{}', queryStringParameters: Record<string, string> = {}) => ({
  httpMethod,
  headers,
  body,
  queryStringParameters,
});

test('POST requires Idempotency-Key', async () => {
  const response = await createQuotationIssuesHandler()(event('POST'));
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body || '{}').error, /Idempotency-Key/);
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

test('POST maps fingerprint or price conflict to 409', async () => {
  const response = await createQuotationIssuesHandler({
    issue: async () => { throw new (await import('../../api/_infrastructure/db/repositories/quotation-issue-repository.js')).QuotationIssueConflictError('conteúdo diferente'); },
  })(event('POST', { 'Idempotency-Key': '00000000-0000-4000-8000-000000000001' }, JSON.stringify({ draft: {} })));
  assert.equal(response.statusCode, 409);
  assert.match(JSON.parse(response.body || '{}').error, /conteúdo diferente/i);
});

test('POST maps PDF failure to safe Portuguese 503', async () => {
  const response = await createQuotationIssuesHandler({
    issue: async () => { throw new (await import('../../api/_infrastructure/db/repositories/quotation-issue-repository.js')).QuotationIssueRepositoryError('Não foi possível gerar o PDF do orçamento. Tente novamente.'); },
  })(event('POST', { 'Idempotency-Key': '00000000-0000-4000-8000-000000000001' }, JSON.stringify({ draft: {} })));
  assert.equal(response.statusCode, 503);
  assert.match(JSON.parse(response.body || '{}').error, /PDF/i);
});

test('unsupported methods return Portuguese method error', async () => {
  const response = await createQuotationIssuesHandler()(event('PUT'));
  assert.equal(response.statusCode, 405);
  assert.match(JSON.parse(response.body || '{}').error, /Método não permitido/);
});
