import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseQuotationOriginCandidateArgs,
  runQuotationOriginCandidates,
} from '../../scripts/quotation-origin-candidates.mjs';
import { listQuotationOriginCandidates } from '../../api/_infrastructure/db/repositories/quotation-origin-repository.js';

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

test('candidate report does not silently truncate rows before the final candidate', async () => {
  const rowCount = 10_001;
  const quotationRows = Array.from({ length: rowCount }, (_, index) => ({
    id: `quotation-${index}`,
    businessNumber: `ORC-${String(index).padStart(8, '0')}`,
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    revisionEmail: `candidate-${index}@example.test`,
    revisionPhone: null,
    revisionVersion: 1,
  }));
  const leadRows = [{
    id: `lead-${rowCount - 1}`,
    email: `candidate-${rowCount - 1}@example.test`,
    telefone: null,
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
  }];

  const createQuery = (rows) => {
    let offset = 0;
    let pageSize = rows.length;
    const query = {
      innerJoin: () => query,
      where: () => query,
      orderBy: () => query,
      limit: (value) => {
        pageSize = value;
        return query;
      },
      offset: (value) => {
        offset = value;
        return query;
      },
      then: (resolve, reject) => Promise.resolve(rows.slice(offset, offset + pageSize)).then(resolve, reject),
    };
    return query;
  };
  const database = {
    select: (projection) => ({
      from: () => createQuery('revisionEmail' in projection ? quotationRows : leadRows),
    }),
  };

  const candidates = await listQuotationOriginCandidates(database, {
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-01-02T00:00:00.000Z'),
    windowDays: 1,
  });

  assert.deepEqual(candidates, [{
    quotationId: `quotation-${rowCount - 1}`,
    quotationNumber: `ORC-${String(rowCount - 1).padStart(8, '0')}`,
    quoteLeadId: `lead-${rowCount - 1}`,
    reasons: ['email_normalized'],
    distanceSeconds: 0,
  }]);
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
    listCandidates: async () => [],
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
