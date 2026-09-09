#!/usr/bin/env node
import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fillFromExternalConfig } from './lib/operation-env.mjs';
import { parsePostgresUrl, postgresIdentity } from './postgres-target.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function consolidationSummary(result) {
  return {
    applied: result.applied,
    groups: result.groups.length,
    removed: result.groups.reduce((total, group) => total + group.removed.length, 0),
    documentConflicts: result.conflicts.length,
    transferred: result.transferred,
  };
}

export function writeConsolidationBackup(filepath, snapshot) {
  const destination = resolve(filepath);
  const inside = relative(root, destination);
  if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error('O backup deve ficar fora do checkout.');
  const content = JSON.stringify(snapshot);
  const fd = openSync(destination, 'wx', 0o600);
  try {
    if (process.platform === 'win32') {
      const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-5-[0-9-]+/)?.[0];
      if (!sid) throw new Error('Não foi possível proteger o backup.');
      // Apply an explicit ACL before writing any personal data; POSIX mode
      // alone does not restrict inherited Windows permissions.
      execFileSync('icacls', [destination, '/inheritance:r', '/grant:r', `*${sid}:F`, '*S-1-5-18:F'], { stdio: 'pipe', windowsHide: true });
    }
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  if (readFileSync(destination, 'utf8') !== content) throw new Error('Falha na verificação do backup.');
}

export async function main(argv = process.argv.slice(2)) {
  fillFromExternalConfig();
  const apply = argv.includes('--apply');
  const backupIndex = argv.indexOf('--backup');
  const backup = backupIndex >= 0 ? argv[backupIndex + 1] : undefined;
  const allowed = new Set(['--apply', '--backup', backup]);
  if (argv.some(arg => !allowed.has(arg)) || (apply && !backup)) throw new Error('Use --apply --backup <arquivo externo> para aplicar. Sem --apply, somente consulta.');
  // The operator explicitly selects production; a staging/local DATABASE_URL
  // cannot silently become the cleanup target.
  if (!process.env.PRODUCTION_DATABASE_URL ||
      postgresIdentity(parsePostgresUrl(process.env.DATABASE_URL)) !== postgresIdentity(parsePostgresUrl(process.env.PRODUCTION_DATABASE_URL))) {
    throw new Error('A conexão não corresponde ao alvo de produção configurado.');
  }
  const { createDatabaseConnection } = await import('../api/_infrastructure/db/client.js');
  const { createClientConsolidationRepository } = await import('../api/_infrastructure/db/repositories/client-consolidation-repository.js');
  const connection = createDatabaseConnection(process.env.DATABASE_URL);
  try {
    const result = await createClientConsolidationRepository(() => connection.db).run(
      apply ? { backup: async snapshot => writeConsolidationBackup(backup, snapshot) } : {},
    );
    console.log(JSON.stringify(consolidationSummary(result)));
  } finally { await connection.client.end({ timeout: 5 }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Consolidação não concluída. Nenhuma transação parcial foi aplicada. Verifique o alvo, o backup e os vínculos.');
    process.exitCode = 1;
  });
}
