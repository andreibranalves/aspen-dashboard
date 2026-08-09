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
  lstatSync,
  realpathSync,
  statfsSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  readFileSync,
  chmodSync,
  closeSync,
  openSync,
  writeSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const PROJECT_ROOT = resolve(__dirname, '..');
const DEFAULT_BACKUPS_DIR = resolve(PROJECT_ROOT, 'backups');
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

function readServiceTarget(serviceName, serviceFile, expectedDatabase, label) {
  let active = false;
  const values = {};
  try {
    for (const rawLine of readFileSync(serviceFile, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      const section = line.match(/^\[([^\]]+)\]$/);
      if (section) {
        active = section[1].trim() === serviceName;
        continue;
      }
      if (!active || !line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator !== -1) values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  } catch {
    throw new Error('PGSERVICEFILE não pôde ser lido.');
  }
  const target = {
    host: values.host,
    port: values.port || '5432',
    database: values.dbname || values.database,
  };
  if (values.hostaddr && values.hostaddr !== target.host)
    throw new Error(`${label} não pode sobrescrever host com hostaddr.`);
  if (!target.host || !target.database) throw new Error(`${label} não informa host e database.`);
  if (expectedDatabase && target.database !== expectedDatabase)
    throw new Error(`Database esperado não corresponde a ${label}.`);
  return { name: serviceName, file: serviceFile, expectedDatabase, target };
}

function serviceEnvironment(service) {
  const serviceEnv = { ...process.env };
  for (const key of Object.keys(serviceEnv)) {
    if (key.startsWith('PG')) delete serviceEnv[key];
  }
  delete serviceEnv.DATABASE_URL;
  delete serviceEnv.RESTORE_DATABASE_URL;
  delete serviceEnv.TEST_DATABASE_URL;
  serviceEnv.PGSERVICEFILE = service.file;
  serviceEnv.PGSERVICE = service.name;
  if (process.env.PGPASSFILE) serviceEnv.PGPASSFILE = process.env.PGPASSFILE;
  return serviceEnv;
}

function readNamedServiceTarget() {
  const serviceName = process.env.RESTORE_PG_SERVICE?.trim();
  const serviceFile = process.env.PGSERVICEFILE?.trim();
  const passFile = process.env.PGPASSFILE?.trim();
  const expectedDatabase = process.env.RESTORE_EXPECTED_DATABASE?.trim();
  if (!serviceName && !expectedDatabase) return null;
  if (!serviceName || !serviceFile || !passFile || !expectedDatabase)
    throw new Error('RESTORE_PG_SERVICE, RESTORE_EXPECTED_DATABASE, PGSERVICEFILE e PGPASSFILE são obrigatórios.');
  return readServiceTarget(serviceName, serviceFile, expectedDatabase, 'RESTORE_PG_SERVICE');
}

function readCutoverServiceTarget() {
  const serviceName = process.env.CUTOVER_PG_SERVICE?.trim();
  const serviceFile = process.env.PGSERVICEFILE?.trim();
  const passFile = process.env.PGPASSFILE?.trim();
  const expectedDatabase = process.env.CUTOVER_EXPECTED_DATABASE?.trim();
  if (!serviceName && !expectedDatabase) return null;
  if (!serviceName || !serviceFile || !passFile || !expectedDatabase)
    throw new Error('CUTOVER_PG_SERVICE, CUTOVER_EXPECTED_DATABASE, PGSERVICEFILE e PGPASSFILE são obrigatórios.');
  return readServiceTarget(serviceName, serviceFile, expectedDatabase, 'CUTOVER_PG_SERVICE');
}

function assertNamedServiceDatabase(service, label) {
  const current = command(
    'psql',
    ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--dbname', service.name, '--command', 'SELECT current_database();'],
    { env: serviceEnvironment(service) }
  ).trim();
  if (current !== service.expectedDatabase) throw new Error(`${label} apontou para database inesperado.`);
}

function assertCutoverServiceTarget(connection) {
  const service = readCutoverServiceTarget();
  if (!service)
    throw new Error(
      'CUTOVER_PG_SERVICE, CUTOVER_EXPECTED_DATABASE, PGSERVICEFILE e PGPASSFILE são obrigatórios.'
    );
  if (
    service.target.host.toLowerCase() !== connection.host.toLowerCase() ||
    service.target.port !== connection.port ||
    service.target.database !== connection.database
  ) {
    throw new Error('DATABASE_URL e CUTOVER_PG_SERVICE não apontam para o mesmo destino.');
  }
  assertNamedServiceDatabase(service, 'CUTOVER_PG_SERVICE');
}

function assertRestoreServiceTarget(restore) {
  const service = readNamedServiceTarget();
  if (!service) return;
  if (
    service.target.host.toLowerCase() !== restore.host.toLowerCase() ||
    service.target.port !== restore.port ||
    service.target.database !== restore.database
  ) {
    throw new Error('RESTORE_DATABASE_URL e RESTORE_PG_SERVICE não apontam para o mesmo destino.');
  }
  assertNamedServiceDatabase(service, 'RESTORE_PG_SERVICE');
}

function assertRestoreTargetIsDistinct(source, restore) {
  if (connectionIdentity(source) === connectionIdentity(restore)) {
    throw new Error('RESTORE_DATABASE_URL deve apontar para um alvo isolado diferente de DATABASE_URL.');
  }
  const productionUrl = process.env.PRODUCTION_DATABASE_URL?.trim();
  if (productionUrl) {
    const production = parseConnectionUrl(productionUrl, 'PRODUCTION_DATABASE_URL');
    if (connectionIdentity(production) === connectionIdentity(restore))
      throw new Error('RESTORE_DATABASE_URL não pode apontar para a base ativa.');
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
  try {
    return execFileSync(file, args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: options.env || process.env,
      encoding: options.encoding || 'utf8',
      stdio: options.stdio || 'pipe',
      maxBuffer: options.maxBuffer || 256 * 1024 * 1024,
      timeout: options.timeout,
    });
  } catch {
    throw new Error(`Falha ao executar ${file}.`);
  }
}

export function resolveBackupDirectory(env = process.env) {
  const configured = env.CUTOVER_BACKUP_DIR || env.BACKUP_DIR;
  const directory = resolve(configured || DEFAULT_BACKUPS_DIR);
  if (configured) {
    if (directory === PROJECT_ROOT || directory.startsWith(`${PROJECT_ROOT}/`))
      throw new Error('BACKUP_DIR deve apontar para um diretório fora do checkout.');
    if (existsSync(directory)) {
      const stat = lstatSync(directory);
      if (stat.isSymbolicLink()) throw new Error('BACKUP_DIR não pode ser link simbólico.');
      const real = realpathSync(directory);
      if (real === PROJECT_ROOT || real.startsWith(`${PROJECT_ROOT}/`))
        throw new Error('BACKUP_DIR deve apontar para um diretório fora do checkout.');
    }
  }
  return directory;
}

function assertMode(filepath, expected, label) {
  const actual = statSync(filepath).mode & 0o777;
  if (actual !== expected) {
    throw new Error(`${label} deve ter permissão ${expected.toString(8)}.`);
  }
}

export function ensureBackupDirectory(env = process.env) {
  const directory = resolveBackupDirectory(env);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BACKUP_DIR deve ser um diretório regular.');
  const configured = env.CUTOVER_BACKUP_DIR || env.BACKUP_DIR;
  if (configured) {
    const real = realpathSync(directory);
    if (real === PROJECT_ROOT || real.startsWith(`${PROJECT_ROOT}/`))
      throw new Error('BACKUP_DIR deve apontar para um diretório fora do checkout.');
  }
  chmodSync(directory, 0o700);
  assertMode(directory, 0o700, 'Diretório de backup');
  return directory;
}

function writeExclusive(filepath, content) {
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(filepath, 'wx', 0o600);
    created = true;
    writeSync(descriptor, content);
  } catch {
    if (created) {
      try {
        unlinkSync(filepath);
      } catch {
        // Keep the original failure boundary sanitized.
      }
    }
    throw new Error('Arquivo de backup já existe ou não pôde ser criado com segurança.');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function runBackup() {
  const connection = parseConnectionUrl(connectionUrl('DATABASE_URL'));
  assertCutoverServiceTarget(connection);
  const backupsDir = ensureBackupDirectory();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${BACKUP_PREFIX}${timestamp}${BACKUP_SUFFIX}`;
  const filepath = join(backupsDir, filename);
  stdout(`Iniciando backup: ${filename}`);
  try {
    const output = command(
      'pg_dump',
      ['--no-owner', '--no-acl', '--clean', '--if-exists', '--format=plain'],
      { env: postgresEnv(connection) }
    );
    writeExclusive(filepath, output);
    chmodSync(filepath, 0o600);
    assertMode(filepath, 0o600, 'Arquivo de backup');
    const stat = statSync(filepath);
    stdout('Backup concluído com sucesso.');
    stdout(`  Arquivo: ${filepath}`);
    stdout(`  Tamanho: ${stat.size} bytes`);
    stdout(`  Timestamp: ${new Date().toISOString()}`);
    retentionCleanup(backupsDir);
  } catch (error) {
    throw new Error(
      `Falha ao executar pg_dump: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

function retentionCleanup(backupsDir = ensureBackupDirectory()) {
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
  const now = Date.now();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const resolvedDir = resolve(backupsDir);
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
    if (!filepath.startsWith(`${resolvedDir}/`)) continue;
    const fileStat = lstatSync(filepath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
    const stat = fileStat;
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
  assertRestoreServiceTarget(restore);
  const filepath = resolve(dumpFile);
  if (!existsSync(filepath)) throw new Error('Arquivo de dump não encontrado.');
  const dumpStat = lstatSync(filepath);
  if (!dumpStat.isFile() || dumpStat.isSymbolicLink())
    throw new Error('Arquivo de dump deve ser regular e não pode ser link simbólico.');
  const targetEnv = postgresEnv(restore);
  stdout('Validando dump explícito no alvo RESTORE_DATABASE_URL.');
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
  assertCutoverServiceTarget(connection);
  const backupDir = ensureBackupDirectory();
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
  const filesystem = statfsSync(backupDir);
  const freeBytes = filesystem.bavail * filesystem.bsize;
  const retainedBackups = readdirSync(backupDir).filter(
    (file) => file.startsWith(BACKUP_PREFIX) && file.endsWith(BACKUP_SUFFIX)
  ).length;
  const env = postgresEnv(connection);
  const maxDbSizeMb = parseInt(process.env.PREFLIGHT_MAX_DB_SIZE_MB || '512', 10);
  const maxBlobSizeMb = parseInt(process.env.PREFLIGHT_MAX_BLOB_SIZE_MB || '512', 10);
  const maxConnections = parseInt(process.env.PREFLIGHT_MAX_CONNECTIONS || '100', 10);
  let hasCritical = false;
  if (freeBytes <= 0) hasCritical = true;
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
  results.push({
    metric: 'Espaço livre no destino',
    value: `${(freeBytes / (1024 * 1024)).toFixed(2)} MB`,
    quota: 'N/A',
    status: freeBytes > 0 ? 'OK' : 'CRÍTICO',
  });
  results.push({
    metric: 'Inventário de backups',
    value: `${retainedBackups} arquivo(s)`,
    quota: `${retentionDays} dias`,
    status: 'OK',
  });
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
