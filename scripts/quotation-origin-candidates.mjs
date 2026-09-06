#!/usr/bin/env node
import { closeDatabase, getDatabase } from '../api/_infrastructure/db/client.js';
import { listQuotationOriginCandidates } from '../api/_infrastructure/db/repositories/quotation-origin-repository.js';

export function parseQuotationOriginCandidateArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') values.set(arg, true);
    else if (arg === '--from' || arg === '--to' || arg === '--window-days') values.set(arg, argv[++index]);
    else throw new Error(`Argumento inválido: ${arg}`);
  }
  if (!values.get('--dry-run')) throw new Error('Use --dry-run; este relatório nunca aplica vínculos.');
  const from = new Date(String(values.get('--from') || ''));
  const to = new Date(String(values.get('--to') || ''));
  const windowDays = Number(values.get('--window-days') || 7);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error('Informe --from e --to válidos, com início anterior ao fim.');
  }
  if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 90) {
    throw new Error('--window-days deve estar entre 0 e 90.');
  }
  return { from, to, windowDays };
}

async function main() {
  const input = parseQuotationOriginCandidateArgs(process.argv.slice(2));
  const candidates = await listQuotationOriginCandidates(getDatabase(), input);
  process.stdout.write(`${JSON.stringify({ dryRun: true, count: candidates.length, candidates }, null, 2)}\n`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main()
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Falha ao gerar relatório.'}\n`);
      process.exitCode = 1;
    })
    .finally(closeDatabase);
}
