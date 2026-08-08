#!/usr/bin/env node

/**
 * Backup, restore validation and capacity preflight for the CRM database.
 *
 * Modes:
 *   (no flags)        Backup: pg_dump -> backups/backup-{ISO-date}.sql + retention
 *   --validate        Restore an explicitly named dump into RESTORE_DATABASE_URL
 *   --preflight       Check DB size, connection count and blob usage
 *   --file <path>     Required with --validate
 */

import { execFileSync } from 'node:child_process';
import {
  readdirSync,
  statSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const PROJECT_ROOT = resolve(__dirname, '..');
const BACKUPS_DIR = resolve(PROJECT_ROOT, 'backups');
const BACKUP_PREFIX = 'backup-';
const BACKUP_SUFFIX = '.sql';

function stderr(message) {
  process.stderr.write(`${message}\n`);
}

function stdout(message) {
  process.stdout.write(`${message}\n`);
}

function loadDotEnv() {
  const envPath = resolve(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function parseArgs(argv) {
  const args = { mode: 'backup', file: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--validate') {
      if (args.mode !== 'backup') throw new Error('Informe apenas um modo de execução.');
      args.mode = 'validate';
    } else if (arg === '--preflight') {
      if (args.mode !== 'backup') throw new Error('Informe apenas um modo de execução.');
      args.mode = 'preflight';
    } else if (arg === '--file') {
      const file = argv[index + 1];
      if (!file || file.startsWith('--')) throw new Error('Informe um arquivo após --file.');
      args.file = file;
      index += 1;
    } else {
      throw new Error(`Opção desconhecida: ${arg}`);
    }
  }
  if (args.mode === 'validate' && !args.file) {
    throw new Error('--validate exige --file; seleção automática de backup está desativada.');
  }
  if (args.mode !== 'validate' && args.file) {
    throw new Error('--file só pode ser usado com --validate.');
  }
  return args;
}

function connectionUrl(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não configurada. Defina a variável pelo gerenciador de segredos.`);
  return value;
}

export function parseConnectionUrl(raw, name = 'DATABASE_URL') {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} inválida.`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${name} deve usar o esquema PostgreSQL.`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database || !parsed.hostname) throw new Error(`${name} precisa informar host e database.`);
  return {
    raw,
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslmode: parsed.searchParams.get('sslmode') || undefined,
  };
}

export function connectionIdentity(connection) {
  return [connection.host, connection.port, connection.database]
    .map((value) => value.toLowerCase())
    .join('|');
}

function assertRestoreTargetIsDistinct(source, restore) {
  if (connectionIdentity(source) === connectionIdentity(restore)) {
    throw new Error('RESTORE_DATABASE_URL deve apontar para um alvo isolado diferente de DATABASE_URL.');
  }
}

export function postgresEnv(connection, database = connection.database, inheritedEnv = process.env) {
  const env = { ...inheritedEnv };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PG')) delete env[key];
  }
  delete env.DATABASE_URL;
  delete env.RESTORE_DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  env.PGHOST = connection.host;
  env.PGPORT = connection.port;
  env.PGUSER = connection.user;
  env.PGDATABASE = database;
  if (connection.password) env.PGPASSWORD = connection.password;
  else delete env.PGPASSWORD;
  if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
  return env;
}

function connectionUrlForDatabase(connection, database) {
  const parsed = new URL(connection.raw);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

function command(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: options.cwd || PROJECT_ROOT,
    env: options.env || process.env,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || 'pipe',
    maxBuffer: options.maxBuffer || 256 * 1024 * 1024,
    timeout: options.timeout,
  });
}

function ensureBackupsDir() {
  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
}

function runBackup() {
  const connection = parseConnectionUrl(connectionUrl('DATABASE_URL'));
  ensureBackupsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.sql`;
  const filepath = join(BACKUPS_DIR, filename);
  stdout(`Iniciando backup: ${filename}`);
  try {
    const output = command(
      'pg_dump',
      ['--no-owner', '--no-acl', '--clean', '--if-exists', '--format=plain'],
      { env: postgresEnv(connection) }
    );
    writeFileSync(filepath, output);
    const stat = statSync(filepath);
    stdout('Backup concluído com sucesso.');
    stdout(`  Arquivo: ${filepath}`);
    stdout(`  Tamanho: ${stat.size} bytes`);
    stdout(`  Timestamp: ${new Date().toISOString()}`);
    retentionCleanup();
  } catch (error) {
    throw new Error(
      `Falha ao executar pg_dump: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

function retentionCleanup() {
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
  const now = Date.now();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const resolvedDir = resolve(BACKUPS_DIR);
  stdout(`Retenção: ${retentionDays} dias. Verificando arquivos antigos...`);
  let files;
  try {
    files = readdirSync(resolvedDir);
  } catch {
    throw new Error('Não foi possível listar o diretório de backups.');
  }
  let deleted = 0;
  for (const file of files) {
    if (!file.startsWith(BACKUP_PREFIX) || !file.endsWith(BACKUP_SUFFIX)) continue;
    const filepath = resolve(resolvedDir, file);
    if (!filepath.startsWith(`${resolvedDir}/`) || !statSync(filepath).isFile()) continue;
    const stat = statSync(filepath);
    if (stat.mtimeMs < cutoff) {
      unlinkSync(filepath);
      deleted += 1;
    }
  }
  stdout(`${deleted} arquivo(s) antigo(s) removido(s).`);
}

function runValidate(dumpFile) {
  const source = parseConnectionUrl(connectionUrl('DATABASE_URL'), 'DATABASE_URL');
  const restore = parseConnectionUrl(connectionUrl('RESTORE_DATABASE_URL'), 'RESTORE_DATABASE_URL');
  assertRestoreTargetIsDistinct(source, restore);
  const filepath = resolve(dumpFile);
  if (!existsSync(filepath) || !statSync(filepath).isFile()) {
    throw new Error(`Arquivo de dump não encontrado: ${filepath}`);
  }
  const targetEnv = postgresEnv(restore);
  stdout(`Validando dump explícito no alvo RESTORE_DATABASE_URL: ${filepath}`);
  command(
    'psql',
    ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--dbname', restore.database, '--file', filepath],
    { env: targetEnv }
  );
  stdout('Dump restaurado no alvo isolado.');
  command('npx', ['drizzle-kit', 'migrate'], {
    cwd: PROJECT_ROOT,
    env: {
      ...targetEnv,
      DATABASE_URL: connectionUrlForDatabase(restore, restore.database),
      TEST_DATABASE_URL: '',
    },
    timeout: 60_000,
  });
  stdout('Migrações concluídas no alvo isolado.');
  const tables = [
    'products',
    'clients',
    'quotations',
    'quote_revisions',
    'quote_revision_items',
    'frappe_import_lineage',
  ];
  let allPass = true;
  stdout('\nValidação de integridade:');
  for (const table of tables) {
    try {
      const result = command(
        'psql',
        [
          '--no-psqlrc',
          '--set=ON_ERROR_STOP=1',
          '--tuples-only',
          '--no-align',
          '--dbname',
          restore.database,
          '--command',
          `SELECT count(*) FROM ${table};`,
        ],
        { env: targetEnv }
      );
      stdout(`  ${table}: ${parseInt(result.trim(), 10)} registros - tabela acessível`);
    } catch {
      stdout(`  ${table}: tabela ausente`);
      allPass = false;
    }
  }
  if (!allPass) throw new Error('Validação falhou. Estrutura comprometida.');
  stdout('\nValidação concluída com sucesso. Estrutura íntegra.');
}

export function exceedsMegabyteQuota(bytes, maxMegabytes) {
  return bytes > maxMegabytes * 1024 * 1024;
}

async function runPreflight() {
  const connection = parseConnectionUrl(connectionUrl('DATABASE_URL'));
  const env = postgresEnv(connection);
  const maxDbSizeMb = parseInt(process.env.PREFLIGHT_MAX_DB_SIZE_MB || '512', 10);
  const maxBlobSizeMb = parseInt(process.env.PREFLIGHT_MAX_BLOB_SIZE_MB || '512', 10);
  const maxConnections = parseInt(process.env.PREFLIGHT_MAX_CONNECTIONS || '100', 10);
  let hasCritical = false;
  const results = [];
  for (const [metric, query, quota, criticalWhen] of [
    ['Tamanho do banco', 'SELECT pg_database_size(current_database());', maxDbSizeMb, (value) => exceedsMegabyteQuota(value, maxDbSizeMb)],
    ['Conexões ativas', 'SELECT count(*) FROM pg_stat_activity;', maxConnections, (value) => value > maxConnections],
  ]) {
    try {
      const value = parseInt(
        command('psql', ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--dbname', connection.database, '--command', query], { env }).trim(),
        10
      );
      const normalized = metric === 'Tamanho do banco' ? `${(value / (1024 * 1024)).toFixed(2)} MB` : String(value);
      const limit = metric === 'Tamanho do banco' ? `${quota} MB` : String(quota);
      const status = criticalWhen(value) ? 'CRÍTICO' : 'OK';
      if (status === 'CRÍTICO') hasCritical = true;
      results.push({ metric, value: normalized, quota: limit, status });
    } catch {
      results.push({ metric, value: 'ERRO', quota: String(quota), status: 'CRÍTICO' });
      hasCritical = true;
    }
  }
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.QUOTATION_BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    results.push({ metric: 'Armazenamento de blobs', value: 'N/A', quota: `${maxBlobSizeMb} MB`, status: 'AVISO' });
  } else {
    try {
      const { list } = await import('@vercel/blob');
      let totalBytes = 0;
      let cursor;
      do {
        const opts = { limit: 1000, ...(cursor ? { cursor } : {}) };
        opts.token = blobToken;
        if (blobToken === process.env.QUOTATION_BLOB_READ_WRITE_TOKEN) {
          const storeId = process.env.QUOTATION_BLOB_STORE_ID?.trim();
          if (storeId) opts.storeId = storeId;
        }
        const page = await list(opts);
        for (const blob of page.blobs) totalBytes += blob.size || 0;
        cursor = page.cursor;
      } while (cursor);
      const totalMb = totalBytes / (1024 * 1024);
      const status = totalMb > maxBlobSizeMb ? 'CRÍTICO' : 'OK';
      if (status === 'CRÍTICO') hasCritical = true;
      results.push({ metric: 'Armazenamento de blobs', value: `${totalMb.toFixed(2)} MB`, quota: `${maxBlobSizeMb} MB`, status });
    } catch {
      results.push({ metric: 'Armazenamento de blobs', value: 'ERRO', quota: `${maxBlobSizeMb} MB`, status: 'AVISO' });
    }
  }
  results.push({ metric: 'Transferência mensal', value: 'N/A', quota: '1000 MB', status: 'AVISO - não mensurável antes de operação' });
  stdout('\nPREFLIGHT DE CAPACIDADE\n');
  for (const result of results) stdout(`${result.status} ${result.metric}: ${result.value} / ${result.quota}`);
  if (hasCritical) throw new Error('CAPACIDADE INSUFICIENTE. Go-live bloqueado.');
  stdout('Resultado: CAPACIDADE SUFICIENTE. Go-live permitido.');
}

async function main(args) {
  if (args.mode === 'backup') runBackup();
  else if (args.mode === 'validate') runValidate(args.file);
  else await runPreflight();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  loadDotEnv();
  try {
    await main(parseArgs(process.argv.slice(2)));
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
