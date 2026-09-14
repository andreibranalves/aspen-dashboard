import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBetaCleanupCandidates } from '../../api/_infrastructure/db/repositories/beta-cleanup-repository.js';
import { createWhatsappContextHandler } from '../../api/_modules/whatsapp-context.js';
import { sendQuotationEmailViaResend } from '../../api/_infrastructure/integrations/resend/client.js';
import { assertCleanupRecoveryEvidence } from '../../scripts/beta-cleanup.mjs';
import { parseBaselineArgs as parseLiteBaselineArgs } from '../../scripts/lite-baseline.mjs';
import { runPreviewPreflight } from '../../scripts/preview-preflight.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';

function event(query = {}, headers = {}) {
  return { httpMethod: 'GET', queryStringParameters: query, headers };
}

function body(response) {
  return JSON.parse(response.body || '{}');
}

test('Preview preflight fails closed for coincident databases and external writes', () => {
  const valid = {
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    DATABASE_URL: 'postgres://user:pass@preview.example/db_preview',
    PRODUCTION_DATABASE_URL: 'postgres://user:pass@prod.example/db_prod',
  };
  assert.equal(runPreviewPreflight(valid).checks.length, 3);
  assert.throws(() => runPreviewPreflight({ ...valid, EXTERNAL_WRITES_ENABLED: '1' }), /EXTERNAL_WRITES_ENABLED=0/);
  assert.throws(() => runPreviewPreflight({ ...valid, PRODUCTION_DATABASE_URL: valid.DATABASE_URL }), /não pode apontar/);
});

test('Preview blocks external email writes before transport', async () => {
  let calls = 0;
  await assert.rejects(
    sendQuotationEmailViaResend({
      recipient: 'cliente@example.com', businessNumber: 'ORC-20260821', attachmentUrl: 'https://aspen.example/api/public-quotation?format=pdf', attemptId: id, subject: 'Orçamento', html: '<p>ok</p>', text: 'ok',
    }, { env: { APP_ENV: 'preview', EXTERNAL_WRITES_ENABLED: '0', RESEND_API_KEY: 'secret', RESEND_FROM_EMAIL: 'from@example.com' }, fetchFn: async () => { calls += 1; throw new Error('must not call'); } }),
    /Integrações externas desativadas/,
  );
  assert.equal(calls, 0);
});

test('baseline and cleanup inputs require explicit typed stable IDs', () => {
  assert.deepEqual(parseLiteBaselineArgs(['--tag', 'aspen-lite-baseline-20260821']), {
    tag: 'aspen-lite-baseline-20260821', push: false, evidence: '', backup: '', restore: '',
  });
  const candidates = parseBetaCleanupCandidates({ candidates: [
    { type: 'quotation', id },
    { type: 'quotation', id },
    { type: 'client', id: id2 },
  ] });
  assert.deepEqual(candidates, [{ type: 'quotation', id }, { type: 'client', id: id2 }]);
  assert.throws(() => parseBetaCleanupCandidates({ ids: [id] }), /type e id/);
  assert.throws(() => assertCleanupRecoveryEvidence({ LITE_BASELINE_TAG: 'aspen-lite-baseline-20260821', LITE_BASELINE_RESTORE_CONFIRMED: '1' }), /Baseline #41/);
});

test('WhatsApp context never matches by name and projects safe empty history', async () => {
  const handler = createWhatsappContextHandler({
    env: { WHATSAPP_CONTEXT_EXTENSION_ORIGIN: 'chrome-extension://test-extension' },
    findCandidatesByPhone: async () => [{ id, tipo: 'cliente', nome: 'Cliente', telefone: '5511999999999', email: 'cliente@example.com' }],
    getClient: async () => ({ id, nome: 'Cliente', telefone: '5511999999999', email: 'cliente@example.com', arquivado: false }),
  });
  const matched = await handler(event({ phone: '5511999999999', conversationId: '5511999999999@s.whatsapp.net' }, { origin: 'chrome-extension://test-extension' }));
  assert.equal(matched.statusCode, 200);
  assert.equal(body(matched).match, 'matched');
  assert.equal(body(matched).quotations.length, 0);
  assert.equal(body(matched).contact.tipo, 'cliente');
  assert.match(body(matched).actions.createContact, /search=/);

  const notFound = createWhatsappContextHandler({ findCandidatesByPhone: async () => [] });
  assert.match(body(await notFound(event({ phone: '5511999999999' }))).actions.createContact, /5511999999999/);

  const ambiguous = createWhatsappContextHandler({
    findCandidatesByPhone: async () => [
      { id, tipo: 'cliente', nome: 'A', telefone: '5511999999999', email: null },
      { id: id2, tipo: 'lead', nome: 'B', telefone: '5511999999999', email: null },
    ],
  });
  const ambiguousResult = body(await ambiguous(event({ phone: '5511999999999' })));
  assert.equal(ambiguousResult.match, 'ambiguous');
  assert.match(ambiguousResult.actions.search, /5511999999999/);
});
