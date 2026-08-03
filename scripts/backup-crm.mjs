#!/usr/bin/env node

/**
 * scripts/backup-crm.mjs
 *
 * Backup, restore validation, and capacity preflight for the CRM database.
 *
 * Modes:
 *   (no flags)        Backup: pg_dump → backups/backup-{ISO-date}.sql + retention
 *   --validate        Restore dump to temp DB/schema, run migrations, validate counts
 *   --preflight       Check DB size, connection count, blob usage → OK / AVISO / CRÍTICO
 *   --file <path>     Override dump file for --validate
 */

import { execSync } from 'node:child_process';
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
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const PROJECT_ROOT = resolve(__dirname, '..');
const BACKUPS_DIR = resolve(PROJECT_ROOT, 'backups');
const BACKUP_PREFIX = 'backup-';
const BACKUP_SUFFIX = '.sql';

// ── Helpers ──────────────────────────────────────────────────────────────

function stderr(msg) {
  process.stderr.write(`${msg}\n`);
}

function stdout(msg) {
  process.stdout.write(`${msg}\n`);
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

function parseArgs(argv) {
  const args = { mode: 'backup', file: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--validate') {
      args.mode = 'validate';
    } else if (argv[i] === '--preflight') {
      args.mode = 'preflight';
    } else if (argv[i] === '--file') {
      args.file = argv[++i];
    } else {
      stderr(`Opção desconhecida: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

function ensureBackupsDir() {
  if (!existsSync(BACKUPS_DIR)) {
    mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    stderr('DATABASE_URL não configurada. Defina a variável de ambiente.');
    process.exit(1);
  }
  return url;
}

// ── Backup mode ──────────────────────────────────────────────────────────

function runBackup() {
  const databaseUrl = getDatabaseUrl();
  ensureBackupsDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.sql`;
  const filepath = join(BACKUPS_DIR, filename);

  stdout(`Iniciando backup: ${filename}`);

  try {
    const dumpCmd = [
      'pg_dump',
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
      '--format=plain',
      databaseUrl,
    ].join(' ');

    const output = execSync(dumpCmd, {
      maxBuffer: 256 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    writeFileSync(filepath, output);

    const stat = statSync(filepath);
    stdout(`Backup concluído com sucesso.`);
    stdout(`  Arquivo: ${filepath}`);
    stdout(`  Tamanho: ${stat.size} bytes`);
    stdout(`  Timestamp: ${new Date().toISOString()}`);

    retentionCleanup();
    return true;
  } catch (err) {
    stderr(`Falha ao executar pg_dump: ${err.message}`);
    return false;
  }
}

// ── Retention policy ─────────────────────────────────────────────────────

function retentionCleanup() {
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const cutoff = now - retentionDays * msPerDay;
  const resolvedDir = resolve(BACKUPS_DIR);

  stdout(`Retenção: ${retentionDays} dias. Verificando arquivos antigos...`);

  let files;
  try {
    files = readdirSync(resolvedDir);
  } catch {
    stderr('Não foi possível listar o diretório de backups.');
    return;
  }

  let deleted = 0;
  for (const file of files) {
    if (!file.startsWith(BACKUP_PREFIX) || !file.endsWith(BACKUP_SUFFIX)) continue;

    const filepath = resolve(resolvedDir, file);
    // Safety: ensure the resolved path is within the backups directory
    const realResolvedDir = resolve(BACKUPS_DIR);
    if (!filepath.startsWith(realResolvedDir + '/') && filepath !== realResolvedDir) {
      continue;
    }

    const st = statSync(filepath);
    if (st.mtimeMs < cutoff) {
      const ageDays = Math.floor((now - st.mtimeMs) / msPerDay);
      stdout(`  Removendo: ${file} (${ageDays} dias)`);
      unlinkSync(filepath);
      deleted += 1;
    }
  }

  stdout(`${deleted} arquivo(s) antigo(s) removido(s).`);
}

// ── Restore validation ───────────────────────────────────────────────────

function runValidate(dumpFile) {
  const databaseUrl = getDatabaseUrl();
  const resolvedDir = resolve(BACKUPS_DIR);

  // Determine dump file
  let filepath;
  if (dumpFile) {
    filepath = resolve(dumpFile);
  } else {
    let files;
    try {
      files = readdirSync(resolvedDir);
    } catch {
      stderr('Diretório de backups não encontrado.');
      process.exit(1);
    }
    const backups = files
      .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_SUFFIX))
      .sort()
      .reverse();
    if (backups.length === 0) {
      stderr('Nenhum backup encontrado em backups/.');
      process.exit(1);
    }
    filepath = join(resolvedDir, backups[0]);
  }

  stdout(`Validando dump: ${filepath}`);

  if (!existsSync(filepath)) {
    stderr(`Arquivo de dump não encontrado: ${filepath}`);
    process.exit(1);
  }

  // Parse connection info from DATABASE_URL
  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    stderr('DATABASE_URL inválida.');
    process.exit(1);
  }
  const host = parsedUrl.hostname;
  const port = parsedUrl.port || '5432';
  const user = parsedUrl.username;
  const dbName = parsedUrl.pathname.replace(/^\//, '');
  const password = parsedUrl.password;

  const envVars = {
    ...process.env,
    PGPASSWORD: password,
  };

  // Try creating a temporary database first
  const tempDbName = `restore_validate_${Date.now()}`;
  let useTempDb = true;
  let createdSchema = false;

  try {
    stdout(`Tentando criar banco temporário: ${tempDbName}`);
    execSync(`createdb -h ${host} -p ${port} -U ${user} ${tempDbName}`, {
      env: envVars,
      stdio: 'pipe',
    });
    stdout('Banco temporário criado com sucesso.');
  } catch {
    // Fallback: create schema in existing database
    useTempDb = false;
    stdout('createdb indisponível. Usando schema restaurado dentro do banco atual.');
    try {
      execSync(
        `psql -h ${host} -p ${port} -U ${user} -d ${dbName} --no-psqlrc -c "DROP SCHEMA IF EXISTS restore_validate CASCADE; CREATE SCHEMA restore_validate;"`,
        { env: envVars, stdio: 'pipe' }
      );
      createdSchema = true;
    } catch (schemaErr) {
      stderr(`Não foi possível criar schema de validação: ${schemaErr.message}`);
      process.exit(1);
    }
  }

  const targetDb = useTempDb ? tempDbName : dbName;

  try {
    // Restore dump
    stdout('Restaurando dump...');
    const restoreCmd = [
      'psql',
      '--no-psqlrc',
      '--quiet',
      '-h',
      host,
      '-p',
      port,
      '-U',
      user,
      '-d',
      targetDb,
      ...(!useTempDb ? ['-c', 'SET search_path TO restore_validate;'] : []),
      '-f',
      filepath,
    ].join(' ');
    execSync(restoreCmd, { env: envVars, stdio: 'pipe', maxBuffer: 256 * 1024 * 1024 });
    stdout('Dump restaurado com sucesso.');

    // Run migrations
    stdout('Executando migrações...');
    try {
      execSync('npx drizzle-kit migrate', {
        cwd: PROJECT_ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 60_000,
      });
      stdout('Migrações concluídas.');
    } catch (migErr) {
      stderr(`Falha nas migrações: ${migErr.message}`);
      cleanupTarget(targetDb, useTempDb, databaseUrl, tempDbName, createdSchema);
      process.exit(1);
    }

    // Validate table counts
    const tables = [
      'products',
      'clients',
      'quotations',
      'quote_revisions',
      'quote_revision_items',
      'issued_documents',
      'frappe_import_lineage',
    ];

    const searchPath = useTempDb ? '' : 'SET search_path TO restore_validate; ';

    stdout('\nValidação de integridade:');
    let allPass = true;
    for (const table of tables) {
      try {
        const result = execSync(
          `psql -h ${host} -p ${port} -U ${user} -d ${targetDb} --no-psqlrc -t -A -c "${searchPath}SELECT count(*) FROM ${table};"`,
          { env: envVars, encoding: 'utf8', stdio: 'pipe' }
        );
        const count = parseInt(result.trim(), 10);
        stdout(`  ${table}: ${count} registros - tabela acessível ✓`);
      } catch {
        stdout(`  ${table}: tabela ausente ✗`);
        allPass = false;
      }
    }

    if (allPass) {
      stdout('\nValidação concluída com sucesso. Estrutura íntegra.');
    } else {
      stderr('\nValidação falhou. Estrutura comprometida.');
      cleanupTarget(targetDb, useTempDb, databaseUrl, tempDbName, createdSchema);
      process.exit(1);
    }
  } finally {
    cleanupTarget(targetDb, useTempDb, databaseUrl, tempDbName, createdSchema);
  }
}

function cleanupTarget(targetDb, useTempDb, databaseUrl, tempDbName, createdSchema) {
  const parsedUrl = new URL(databaseUrl);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port || '5432';
  const user = parsedUrl.username;
  const dbName = parsedUrl.pathname.replace(/^\//, '');
  const password = parsedUrl.password;
  const envVars = { ...process.env, PGPASSWORD: password };

  if (useTempDb) {
    try {
      execSync(`dropdb -h ${host} -p ${port} -U ${user} ${tempDbName}`, {
        env: envVars,
        stdio: 'pipe',
      });
      stdout(`Banco temporário ${tempDbName} removido.`);
    } catch {
      stderr(`Não foi possível remover banco temporário ${tempDbName}.`);
    }
  } else if (createdSchema) {
    try {
      execSync(
        `psql -h ${host} -p ${port} -U ${user} -d ${dbName} --no-psqlrc -c "DROP SCHEMA IF EXISTS restore_validate CASCADE;"`,
        { env: envVars, stdio: 'pipe' }
      );
      stdout('Schema restore_validate removido.');
    } catch {
      stderr('Não foi possível remover schema restore_validate.');
    }
  }
}

// ── Capacity preflight ───────────────────────────────────────────────────

async function runPreflight() {
  const databaseUrl = getDatabaseUrl();
  const maxDbSizeMb = parseInt(process.env.PREFLIGHT_MAX_DB_SIZE_MB || '512', 10);
  const maxBlobSizeMb = parseInt(process.env.PREFLIGHT_MAX_BLOB_SIZE_MB || '512', 10);
  const maxConnections = parseInt(process.env.PREFLIGHT_MAX_CONNECTIONS || '100', 10);

  const parsedUrl = new URL(databaseUrl);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port || '5432';
  const user = parsedUrl.username;
  const dbName = parsedUrl.pathname.replace(/^\//, '');
  const password = parsedUrl.password;

  const envVars = { ...process.env, PGPASSWORD: password };

  let hasCritical = false;
  const results = [];

  // 1. Database size
  try {
    const sizeResult = execSync(
      `psql -h ${host} -p ${port} -U ${user} -d ${dbName} --no-psqlrc -t -A -c "SELECT pg_database_size(current_database());"`,
      { env: envVars, encoding: 'utf8', stdio: 'pipe' }
    );
    const sizeBytes = parseInt(sizeResult.trim(), 10);
    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
    let status = 'OK';
    if (parseFloat(sizeMb) > maxDbSizeMb) {
      status = 'CRÍTICO';
      hasCritical = true;
    }
    results.push({
      metric: 'Tamanho do banco',
      value: `${sizeMb} MB`,
      quota: `${maxDbSizeMb} MB`,
      status,
    });
  } catch {
    results.push({
      metric: 'Tamanho do banco',
      value: 'ERRO',
      quota: `${maxDbSizeMb} MB`,
      status: 'CRÍTICO',
    });
    hasCritical = true;
  }

  // 2. Active connections
  try {
    const connResult = execSync(
      `psql -h ${host} -p ${port} -U ${user} -d ${dbName} --no-psqlrc -t -A -c "SELECT count(*) FROM pg_stat_activity;"`,
      { env: envVars, encoding: 'utf8', stdio: 'pipe' }
    );
    const connCount = parseInt(connResult.trim(), 10);
    let status = 'OK';
    if (connCount > maxConnections) {
      status = 'CRÍTICO';
      hasCritical = true;
    }
    results.push({
      metric: 'Conexões ativas',
      value: String(connCount),
      quota: String(maxConnections),
      status,
    });
  } catch {
    results.push({
      metric: 'Conexões ativas',
      value: 'ERRO',
      quota: String(maxConnections),
      status: 'CRÍTICO',
    });
    hasCritical = true;
  }

  // 3. Blob store usage
  const blobToken =
    process.env.BLOB_READ_WRITE_TOKEN || process.env.QUOTATION_BLOB_READ_WRITE_TOKEN;

  if (!blobToken) {
    results.push({
      metric: 'Armazenamento de blobs',
      value: 'N/A',
      quota: `${maxBlobSizeMb} MB`,
      status: 'AVISO',
    });
  } else {
    try {
      const { list } = await import('@vercel/blob');
      let totalBytes = 0;
      let cursor = undefined;
      do {
        const opts = { limit: 1000 };
        if (cursor) opts.cursor = cursor;
        if (blobToken === process.env.QUOTATION_BLOB_READ_WRITE_TOKEN) {
          opts.token = blobToken;
          const storeId = process.env.QUOTATION_BLOB_STORE_ID?.trim();
          if (storeId) opts.storeId = storeId;
        } else {
          opts.token = blobToken;
        }
        const page = await list(opts);
        for (const blob of page.blobs) {
          totalBytes += blob.size || 0;
        }
        cursor = page.cursor;
      } while (cursor);

      const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
      let status = 'OK';
      if (parseFloat(totalMb) > maxBlobSizeMb) {
        status = 'CRÍTICO';
        hasCritical = true;
      }
      results.push({
        metric: 'Armazenamento de blobs',
        value: `${totalMb} MB`,
        quota: `${maxBlobSizeMb} MB`,
        status,
      });
    } catch {
      results.push({
        metric: 'Armazenamento de blobs',
        value: 'ERRO',
        quota: `${maxBlobSizeMb} MB`,
        status: 'AVISO',
      });
    }
  }

  // 4. Transfer estimation
  results.push({
    metric: 'Transferência mensal',
    value: 'N/A',
    quota: '1000 MB',
    status: 'AVISO — não mensurável antes de operação',
  });

  // Print report
  stdout('\n══════════════════════════════════════════════');
  stdout('  PREFLIGHT DE CAPACIDADE');
  stdout('══════════════════════════════════════════════\n');

  for (const r of results) {
    const marker = r.status === 'OK' ? '✓' : r.status.startsWith('AVISO') ? '⚠' : '✗';
    stdout(`  ${marker} ${r.metric}: ${r.value} / ${r.quota}`);
    stdout(`    Status: ${r.status}\n`);
  }

  if (hasCritical) {
    stderr('CAPACIDADE INSUFICIENTE. Go-live bloqueado.');
    process.exit(1);
  }

  stdout('Resultado: CAPACIDADE SUFICIENTE. Go-live permitido.');
}

// ── Main ─────────────────────────────────────────────────────────────────

loadDotEnv();
const args = parseArgs(process.argv.slice(2));

switch (args.mode) {
  case 'backup': {
    const ok = runBackup();
    process.exit(ok ? 0 : 1);
    break;
  }
  case 'validate': {
    runValidate(args.file);
    break;
  }
  case 'preflight': {
    runPreflight().catch((err) => {
      stderr(`Falha no preflight: ${err.message}`);
      process.exit(1);
    });
    break;
  }
}
