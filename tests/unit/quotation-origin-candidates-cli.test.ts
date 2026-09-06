import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseQuotationOriginCandidateArgs,
  runQuotationOriginCandidates,
} from '../../scripts/quotation-origin-candidates.mjs';

test('candidate report requires explicit read-only mode and a bounded period', () => {
  assert.throws(
    () => parseQuotationOriginCandidateArgs(['--from', '2026-01-01', '--to', '2026-02-01']),
    /--dry-run/,
  );
  const parsed = parseQuotationOriginCandidateArgs([
    '--from', '2026-01-01T00:00:00Z',
    '--to', '2026-02-01T00:00:00Z',
    '--window-days', '3',
    '--dry-run',
  ]);
  assert.equal(parsed.windowDays, 3);
  assert.equal(parsed.from.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(parsed.to.toISOString(), '2026-02-01T00:00:00.000Z');
});

test('candidate report keeps candidate and invalid-evidence totals separate', async () => {
  let stdout = '';
  const exitCode = await runQuotationOriginCandidates({
    argv: [
      '--from', '2026-01-01T00:00:00Z',
      '--to', '2026-01-02T00:00:00Z',
      '--dry-run',
    ],
    getDatabase: () => ({}),
    listCandidates: async () => ({
      candidates: [{
        quotationId: 'quotation-synthetic',
        quotationNumber: 'ORC-20329999',
        quoteLeadId: 'lead-synthetic',
        reasons: ['email_normalized'],
        distanceSeconds: 0,
      }],
      invalidEvidence: { missing: 2, invalid: 3 },
    }),
    closeDatabase: async () => undefined,
    stdout: { write: (value) => { stdout += value; return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stdout), {
    dryRun: true,
    count: 1,
    invalidEvidence: { missing: 2, invalid: 3 },
    candidates: [{
      quotationId: 'quotation-synthetic',
      quotationNumber: 'ORC-20329999',
      quoteLeadId: 'lead-synthetic',
      reasons: ['email_normalized'],
      distanceSeconds: 0,
    }],
  });
});

test('candidate report sanitizes infrastructure and close failures', async () => {
  const secret = 'synthetic-secret-bearing-db-error';
  let stdout = '';
  let stderr = '';
  const exitCode = await runQuotationOriginCandidates({
    argv: [
      '--from', '2026-01-01T00:00:00Z',
      '--to', '2026-01-02T00:00:00Z',
      '--dry-run',
    ],
    getDatabase: () => ({}),
    listCandidates: async () => { throw new Error(`database password=${secret}`); },
    closeDatabase: async () => { throw new Error(`close password=${secret}`); },
    stdout: { write: (value) => { stdout += value; return true; } },
    stderr: { write: (value) => { stderr += value; return true; } },
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout, '');
  assert.equal(stderr, 'Falha ao gerar relatório.\n');
  assert.equal(stderr.includes(secret), false);

  stdout = '';
  stderr = '';
  const closeOnlyExitCode = await runQuotationOriginCandidates({
    argv: [
      '--from', '2026-01-01T00:00:00Z',
      '--to', '2026-01-02T00:00:00Z',
      '--dry-run',
    ],
    getDatabase: () => ({}),
    listCandidates: async () => ({
      candidates: [],
      invalidEvidence: { missing: 0, invalid: 0 },
    }),
    closeDatabase: async () => { throw new Error(`close password=${secret}`); },
    stdout: { write: (value) => { stdout += value; return true; } },
    stderr: { write: (value) => { stderr += value; return true; } },
  });

  assert.equal(closeOnlyExitCode, 1);
  assert.match(stdout, /"dryRun": true/);
  assert.equal(stderr, 'Falha ao gerar relatório.\n');
  assert.equal(stderr.includes(secret), false);
});

test('candidate report does not echo arbitrary invalid arguments', async () => {
  const secret = 'synthetic-argv-secret';
  let stderr = '';
  const exitCode = await runQuotationOriginCandidates({
    argv: ['--unknown', secret],
    getDatabase: () => { throw new Error('database should not open'); },
    closeDatabase: async () => undefined,
    stdout: { write: () => true },
    stderr: { write: (value) => { stderr += value; return true; } },
  });

  assert.equal(exitCode, 1);
  assert.equal(stderr, 'Argumento inválido.\n');
  assert.equal(stderr.includes(secret), false);
});
