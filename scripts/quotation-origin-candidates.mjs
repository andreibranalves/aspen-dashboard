#!/usr/bin/env node
import { closeDatabase, getDatabase } from '../api/_infrastructure/db/client.js';
import { listQuotationOriginCandidates } from '../api/_infrastructure/db/repositories/quotation-origin-repository.js';

const SAFE_INFRASTRUCTURE_ERROR = 'Falha ao gerar relatório.';

export class QuotationOriginCandidateUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotationOriginCandidateUsageError';
  }
}

export function parseQuotationOriginCandidateArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') values.set(arg, true);
    else if (arg === '--from' || arg === '--to' || arg === '--window-days') values.set(arg, argv[++index]);
    else throw new QuotationOriginCandidateUsageError('Argumento inválido.');
  }
  if (!values.get('--dry-run')) throw new QuotationOriginCandidateUsageError('Use --dry-run; este relatório nunca aplica vínculos.');
  const from = new Date(String(values.get('--from') || ''));
  const to = new Date(String(values.get('--to') || ''));
  const windowDays = Number(values.get('--window-days') || 7);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new QuotationOriginCandidateUsageError('Informe --from e --to válidos, com início anterior ao fim.');
  }
  if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 90) {
    throw new QuotationOriginCandidateUsageError('--window-days deve estar entre 0 e 90.');
  }
  return { from, to, windowDays };
}

export async function runQuotationOriginCandidates({
  argv = process.argv.slice(2),
  getDatabase: getDatabaseFn = getDatabase,
  listCandidates = listQuotationOriginCandidates,
  closeDatabase: closeDatabaseFn = closeDatabase,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let failure = null;
  try {
    const input = parseQuotationOriginCandidateArgs(argv);
    const candidates = await listCandidates(getDatabaseFn(), input);
    stdout.write(`${JSON.stringify({ dryRun: true, count: candidates.length, candidates }, null, 2)}\n`);
  } catch (error) {
    failure = error;
  }

  try {
    await closeDatabaseFn();
  } catch (error) {
    if (!(failure instanceof QuotationOriginCandidateUsageError)) failure = error;
  }

  if (failure) {
    const message = failure instanceof QuotationOriginCandidateUsageError
      ? failure.message
      : SAFE_INFRASTRUCTURE_ERROR;
    stderr.write(`${message}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runQuotationOriginCandidates()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write(`${SAFE_INFRASTRUCTURE_ERROR}\n`);
      process.exitCode = 1;
    });
}
